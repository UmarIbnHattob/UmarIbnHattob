"""Chat: suhbatlar ro'yxati va oqimli (SSE) xabar yuborish.

Tarix butun suhbat bo'yicha yagona: tanlangan model avvalgi barcha xabarlarni
(boshqa model yozganlarini ham) kontekst sifatida oladi.
"""
import base64
import binascii
import json
import logging
import re
import threading
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.orm import Session

from app.catalog import catalog, charge, resolve
from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.models import Conversation, MediaItem, Message, Provider, Role, User
from app.personalize import system_prompt
from app.providers import gemini_image
from app.providers.base import EmptyReply, ProviderError, merge_history, trim_history
from app.providers.router_auto import REASONS, choose, classify
from app.quota import refund, refund_on_error, resolve_key_info
from app.schemas import ConversationOut, MessageOut, SendMessageIn
from app.usage_log import record

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
def list_conversations(
    limit: int = Query(100, ge=1, le=200),
    before: datetime | None = None,
    before_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Oxirgi o'zgargan bo'yicha. Keyingi sahifa: ?before=<oxirgi elementning updated_at>&before_id=<uning id si>;
    qidiruv: ?q=sarlavha."""
    stmt = select(Conversation).where(Conversation.user_id == user.id)
    if before is not None:
        if before_id is not None:
            # (vaqt, id) juftligi bo'yicha: vaqti bir xil suhbatlar sahifa chegarasida tushib qolmaydi
            stmt = stmt.where(tuple_(Conversation.updated_at, Conversation.id) < tuple_(before, before_id))
        else:  # eski mijozlar: faqat vaqt bo'yicha
            stmt = stmt.where(Conversation.updated_at < before)
    elif before_id is not None:
        raise HTTPException(422, "before_id faqat before bilan birga ishlatiladi.")
    if q and q.strip():
        pattern = "%" + re.sub(r"([\\%_])", r"\\\1", q.strip()) + "%"
        stmt = stmt.where(Conversation.title.ilike(pattern, escape="\\"))
    rows = db.scalars(stmt.order_by(Conversation.updated_at.desc(), Conversation.id.desc()).limit(limit))
    return [_conv_out(c) for c in rows]


class ConversationPatch(BaseModel):
    title: str = Field(min_length=1, max_length=200)


@router.patch("/conversations/{conv_id}", response_model=ConversationOut)
def rename_conversation(
    conv_id: uuid.UUID, body: ConversationPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "Sarlavha bo'sh bo'lmasligi kerak.")
    conv = _own_conversation(db, user, conv_id)
    # Nomini o'zgartirish suhbatni ro'yxat boshiga ko'tarmasin: updated_at o'zgarmaydi
    db.execute(
        update(Conversation).where(Conversation.id == conv.id).values(title=title, updated_at=Conversation.updated_at)
    )
    db.commit()
    db.refresh(conv)
    return _conv_out(conv)


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


def _image_alt(prompt: str) -> str:
    """Markdown rasm alt matni: ']' , '\\', qator ko'chishi va h.k. rasmni buzmasin."""
    return re.sub(r"[\[\]\\`<>\s]+", " ", prompt).strip()[:80].strip() or "rasm"


class ConversationGone(Exception):
    """Javob oqimi davomida suhbat o'chirib yuborildi."""


@router.post("/conversations/{conv_id}/messages")
async def send_message(
    conv_id: uuid.UUID,
    body: SendMessageIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Foydalanuvchi xabarini saqlaydi va tanlangan (yoki Auto tanlagan) modelning javobini SSE orqali oqimlaydi.

    Model hech narsa qaytarmasa (xato, bo'sh javob, birinchi so'zdan oldin bekor qilish) foydalanuvchi xabari
    tarixdan olib tashlanadi (keyingi savolga qo'shilib ketmasin). Bepul limit faqat provayder so'rovni bajarmagan
    bo'lsa (ProviderError birinchi so'zdan oldin) qaytariladi: bekor qilish va bo'sh javob provayderda hisoblangan.
    """
    if not body.content.strip():
        raise HTTPException(422, "Xabar bo'sh bo'lmasligi kerak.")
    if body.image:
        try:
            if not base64.b64decode(body.image, validate=True).startswith(b"\x89PNG"):
                raise ValueError
        except (binascii.Error, ValueError):
            raise HTTPException(400, "Canvas rasmi noto'g'ri formatda (PNG kerak).")

    conv = _own_conversation(db, user, conv_id)
    route = None  # Auto rejimda: {"model", "label", "reason", "kind"}
    image_job = False
    ref = body.model
    if ref == "auto":
        kind = classify(body.content, bool(body.image))
        items = catalog(db, user)
        gemini_ok = any(m["provider"] == "gemini" and m["available"] for m in items)
        if kind == "image" and gemini_ok:
            image_job = True
            img = gemini_image.IMAGE_MODELS[0]
            route = {"model": img["id"], "label": img["label"], "reason": REASONS[kind], "kind": kind}
        else:
            picked = choose(kind if kind != "image" else "general", items, need_vision=bool(body.image))
            if picked is None:
                if body.image:
                    raise HTTPException(400, "Rasmni ko'ra oladigan model topilmadi. Claude yoki Gemini kalitini kiriting yoki canvasni ilova qilmang.")
                raise HTTPException(400, "Hech qaysi model uchun kalit yo'q (yoki bepul limit tugagan). Settings sahifasida kalit kiriting yoki provayder qo'shing.")
            ref = picked["id"]
            route = {"model": ref, "label": picked["label"], "reason": REASONS[kind], "kind": kind}

    # Avval hamma tekshiruv, keyin bepul limitdan so'rov band qilinadi (rad etilgan so'rov limitni yemasin)
    if image_job:
        api_key, platform = resolve_key_info(db, user, Provider.gemini)
        model_ref = model_id = route["model"]
        provider_name, usage_kind = "gemini", "image"
        resolved = None
    else:
        resolved = await resolve(db, user, ref, reserve=False)
        if body.image and not resolved.vision:
            raise HTTPException(400, f"{resolved.label} rasmni ko'ra olmaydi. Claude yoki Gemini ni tanlang yoki canvasni ilova qilmang.")
        charge(db, user, resolved)
        model_ref, model_id, provider_name, platform = resolved.ref, resolved.id, resolved.provider, resolved.platform
        usage_kind = "chat"

    conv_uuid, user_id = conv.id, user.id
    with refund_on_error(user_id, platform):
        system = system_prompt(user)
        user_msg = Message(
            conversation_id=conv.id,
            role=Role.user,
            content=body.content,
            attachments={"canvas": True} if body.image else None,
        )
        db.add(user_msg)
        new_title = None
        if conv.title == "New chat":
            new_title = conv.title = body.content.strip().replace("\n", " ")[:60]
        db.commit()
        user_msg_id = user_msg.id
        history = trim_history(merge_history([{"role": m.role.value, "content": m.content} for m in conv.messages]))
        # Rasm faqat joriy (oxirgi) xabarga biriktiriladi: eski rasmlarni qayta yuborish token sarflaydi
        if body.image:
            history[-1]["image"] = body.image
    # Ulanishni pool'ga qaytaramiz: oqim 1-2 daqiqa davom etishi mumkin,
    # shu vaqt band tursa ko'p foydalanuvchida ulanishlar tugab qoladi
    db.close()

    once = threading.Lock()  # navbat faqat bir marta yakunlanadi (oqim oxirida YOKI bekor qilinganda)

    def finish(parts: list[str], refund_quota: bool) -> str | None:
        """Navbatni yakunlaydi (sinxron, alohida sessiyada). Ikkinchi chaqiruv hech narsa qilmaydi.

        Javob bo'lsa: statistikaga yozadi va javobni saqlaydi (id qaytaradi; suhbat o'chirilgan bo'lsa ConversationGone).
        Javob bo'lmasa: foydalanuvchi xabarini o'chiradi, yangi sarlavhani bekor qiladi va `refund_quota` bo'lsa
        bepul limitni qaytaradi.
        """
        if not once.acquire(blocking=False):
            return None
        if not parts:
            if platform and refund_quota:
                refund(user_id)
            with SessionLocal() as s:
                s.execute(delete(Message).where(Message.id == user_msg_id))
                if new_title is not None:
                    s.execute(
                        update(Conversation)
                        .where(Conversation.id == conv_uuid, Conversation.title == new_title)
                        .values(title="New chat", updated_at=Conversation.updated_at)
                    )
                s.commit()
            return None
        record(user_id, usage_kind, provider_name, model_id, platform)
        with SessionLocal() as s:
            # Qator qulflanadi (FOR NO KEY UPDATE): shu orada suhbat o'chirilsa ham FK xatosi bo'lmaydi
            c = s.get(Conversation, conv_uuid, with_for_update={"key_share": True})
            if c is None:
                raise ConversationGone
            msg = Message(conversation_id=conv_uuid, role=Role.assistant, content="".join(parts), model=model_ref)
            s.add(msg)
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
            yield f"![{_image_alt(body.content)}](omni-media://{media_id})"
            return
        async for chunk in resolved.stream(history, system):
            yield chunk

    async def event_stream():
        parts: list[str] = []
        refundable = False  # provayder so'rovni bajarmadi (xato, ulanish yo'q) — bepul limit qaytariladi
        try:
            if route:
                yield _sse({"type": "route", **route})
            error = None
            try:
                async for chunk in chunks():
                    parts.append(chunk)
                    yield _sse({"type": "delta", "text": chunk})
                if not parts:  # provayder javob berdi, lekin matn yo'q (so'rov hisoblangan)
                    error = "Model bo'sh javob qaytardi."
            except ProviderError as exc:
                error = str(exc)
                refundable = not parts and not isinstance(exc, EmptyReply)
            except Exception:  # kutilmagan xato oqimni sindirmasin
                log.exception("Chat oqimida kutilmagan xato")
                error = "Kutilmagan xato yuz berdi."

            # Qisman javob bo'lsa ham saqlaymiz (xato bilan tugagan bo'lsa ham)
            try:
                message_id = await run_in_threadpool(finish, parts, refundable)
            except ConversationGone:
                yield _sse({"type": "error", "message": "Suhbat o'chirilgan: javob saqlanmadi."})
                return
            except Exception:
                log.exception("Javobni saqlab bo'lmadi")
                yield _sse({"type": "error", "message": error or "Javobni saqlab bo'lmadi."})
                return
            if not parts:
                # UI yozilgan matnni kiritish maydoniga qaytaradi
                yield _sse({"type": "error", "message": error, "user_message_removed": True})
            elif error:
                yield _sse({"type": "error", "message": error})
            else:
                yield _sse({"type": "done", "message_id": message_id, "model": model_ref})
        finally:
            # Foydalanuvchi "To'xtatish" ni bossa yoki boshqa suhbatga o'tsa, oqim bekor qilinadi (yakunlash uchun
            # bo'sh oqim navbatini kutayotganda ham): ekranda ko'rgan qisman javobi yo'qolmasin; hech narsa kelmagan
            # bo'lsa savol tarixdan olinadi. Bekor qilishning o'zi bepul limitni qaytarmaydi (provayder so'rovni
            # allaqachon hisoblagan). finish() ikkinchi marta hech narsa qilmaydi (oqim navbatida boshlangan bo'lsa ham).
            try:
                finish(parts, refundable)
            except Exception:
                log.exception("Bekor qilingan javobni yakunlab bo'lmadi")

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
