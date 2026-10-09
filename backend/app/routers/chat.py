"""Chat: suhbatlar ro'yxati va oqimli (SSE) xabar yuborish.

Tarix butun suhbat bo'yicha yagona: tanlangan model avvalgi barcha xabarlarni
(boshqa model yozganlarini ham) kontekst sifatida oladi.
"""
import base64
import binascii
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.models import Conversation, Message, Provider, Role, User
from app.providers.base import ProviderError, merge_history, trim_history
from app.personalize import system_prompt
from app.usage_log import record
from app.catalog import catalog, resolve
from app.models import MediaItem
from app.providers import gemini_image
from app.providers.router_auto import REASONS, choose, classify
from app.quota import resolve_key_info
from app.schemas import ConversationOut, MessageOut, SendMessageIn

router = APIRouter(tags=["chat"])
log = logging.getLogger(__name__)


def _own_conversation(db: Session, user: User, conv_id: uuid.UUID) -> Conversation:
    conv = db.scalar(select(Conversation).where(Conversation.id == conv_id, Conversation.user_id == user.id))
    if conv is None:
        raise HTTPException(404, "Suhbat topilmadi")
    return conv


def _conv_out(c: Conversation) -> ConversationOut:
    return ConversationOut(id=str(c.id), title=c.title, updated_at=c.updated_at)


@router.get("/models")
def list_models(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """O'rnatilgan + foydalanuvchi qo'shgan modellar (kaliti bor-yo'qligi bilan)."""
    return catalog(db, user)


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.updated_at.desc()).limit(100)
    )
    return [_conv_out(c) for c in rows]


@router.post("/conversations", response_model=ConversationOut, status_code=201)
def create_conversation(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = Conversation(user_id=user.id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _conv_out(conv)


@router.get("/conversations/{conv_id}/messages", response_model=list[MessageOut])
def list_messages(conv_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = _own_conversation(db, user, conv_id)
    return [
        MessageOut(
            id=str(m.id),
            role=m.role.value,
            content=m.content,
            model=m.model,
            has_canvas=bool(m.attachments and m.attachments.get("canvas")),
            created_at=m.created_at,
        )
        for m in conv.messages
    ]


@router.delete("/conversations/{conv_id}", status_code=204)
def delete_conversation(conv_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(_own_conversation(db, user, conv_id))
    db.commit()


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/conversations/{conv_id}/messages")
async def send_message(
    conv_id: uuid.UUID,
    body: SendMessageIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Foydalanuvchi xabarini saqlaydi va tanlangan (yoki Auto tanlagan) modelning javobini SSE orqali oqimlaydi."""
    if body.image:
        try:
            if not base64.b64decode(body.image, validate=True).startswith(b"\x89PNG"):
                raise ValueError
        except (binascii.Error, ValueError):
            raise HTTPException(400, "Canvas rasmi noto'g'ri formatda (PNG kerak).")

    conv = _own_conversation(db, user, conv_id)
    route = None  # Auto rejimda: {"model", "label", "reason"}
    image_job = False
    ref = body.model
    if ref == "auto":
        kind = classify(body.content, bool(body.image))
        items = catalog(db, user)
        gemini_ok = any(m["provider"] == "gemini" and m["available"] for m in items)
        if kind == "image" and gemini_ok:
            image_job = True
            route = {"model": gemini_image.IMAGE_MODELS[0]["id"], "label": gemini_image.IMAGE_MODELS[0]["label"], "reason": REASONS[kind]}
        else:
            picked = choose(kind if kind != "image" else "general", items)
            if picked is None:
                raise HTTPException(400, "Hech qaysi model uchun kalit yo'q. Settings sahifasida kalit kiriting yoki provayder qo'shing.")
            ref = picked["id"]
            route = {"model": ref, "label": picked["label"], "reason": REASONS[kind]}

    if image_job:
        api_key, platform = resolve_key_info(db, user, Provider.gemini)
        model_ref, provider_name, model_label = route["model"], "gemini", route["label"]
        resolved = None
    else:
        resolved = resolve(db, user, ref)
        if body.image and not resolved.vision:
            raise HTTPException(400, f"{resolved.label} rasmni ko'ra olmaydi. Claude yoki Gemini ni tanlang yoki canvasni ilova qilmang.")
        model_ref, provider_name, platform = resolved.ref, resolved.provider, resolved.platform

    system = system_prompt(user)
    record(user.id, "image" if image_job else "chat", provider_name, model_ref.split(":")[-1], platform)
    db.add(
        Message(
            conversation_id=conv.id,
            role=Role.user,
            content=body.content,
            attachments={"canvas": True} if body.image else None,
        )
    )
    if conv.title == "New chat":
        conv.title = body.content.strip().replace("\n", " ")[:60]
    db.commit()
    history = trim_history(merge_history([{"role": m.role.value, "content": m.content} for m in conv.messages]))
    # Rasm faqat joriy (oxirgi) xabarga biriktiriladi: eski rasmlarni qayta yuborish token sarflaydi
    if body.image:
        history[-1]["image"] = body.image
    conv_uuid, user_id = conv.id, user.id
    # Ulanishni pool'ga qaytaramiz: oqim 1-2 daqiqa davom etishi mumkin,
    # shu vaqt band tursa ko'p foydalanuvchida ulanishlar tugab qoladi
    db.close()

    def save_reply(content: str) -> str:
        with SessionLocal() as s:
            msg = Message(conversation_id=conv_uuid, role=Role.assistant, content=content, model=model_ref)
            s.add(msg)
            c = s.get(Conversation, conv_uuid)
            if c:
                c.updated_at = func.now()
            s.commit()
            return str(msg.id)

    def save_image(mime: str, data: bytes) -> str:
        with SessionLocal() as s:
            item = MediaItem(user_id=user_id, prompt=body.content[:4000], model=model_ref, mime_type=mime, data=data)
            s.add(item)
            s.commit()
            return str(item.id)

    async def chunks():
        if image_job:
            # Rasm Media Studio'ga ham saqlanadi; chatda maxsus havola orqali ko'rsatiladi
            mime, data = await gemini_image.generate_image(api_key, model_ref, body.content)
            media_id = await run_in_threadpool(save_image, mime, data)
            yield f"![{body.content[:80]}](omni-media://{media_id})"
            return
        async for chunk in resolved.stream(history, system):
            yield chunk

    async def event_stream():
        parts: list[str] = []
        saved = False
        try:
            if route:
                yield _sse({"type": "route", **route})
            error = None
            try:
                async for chunk in chunks():
                    parts.append(chunk)
                    yield _sse({"type": "delta", "text": chunk})
                if not parts:
                    raise ProviderError("Model bo'sh javob qaytardi.")
            except ProviderError as exc:
                error = str(exc)
            except Exception:  # kutilmagan xato oqimni sindirmasin
                log.exception("Chat oqimida kutilmagan xato")
                error = "Kutilmagan xato yuz berdi."

            # Qisman javob bo'lsa ham saqlaymiz (xato bilan tugagan bo'lsa ham)
            message_id = await run_in_threadpool(save_reply, "".join(parts)) if parts else None
            saved = True
            yield _sse({"type": "error", "message": error} if error else {"type": "done", "message_id": message_id, "model": model_ref})
        finally:
            # Foydalanuvchi "To'xtatish" ni bossa yoki boshqa suhbatga o'tsa, oqim bekor qilinadi:
            # ekranda ko'rgan qisman javobi yo'qolmasin
            if parts and not saved:
                try:
                    save_reply("".join(parts))
                except Exception:
                    log.exception("Qisman javobni saqlab bo'lmadi")

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
