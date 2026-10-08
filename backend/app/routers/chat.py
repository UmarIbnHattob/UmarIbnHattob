"""Chat: suhbatlar ro'yxati va oqimli (SSE) xabar yuborish.

Tarix butun suhbat bo'yicha yagona: tanlangan model avvalgi barcha xabarlarni
(boshqa model yozganlarini ham) kontekst sifatida oladi.
"""
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crypto import decrypt
from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.models import ApiKey, Conversation, Message, Role, User
from app.providers.base import ProviderError, merge_history
from app.providers.registry import MODELS, STREAMERS, find_model
from app.schemas import ConversationOut, MessageOut, ModelOut, SendMessageIn

router = APIRouter(tags=["chat"])


def _own_conversation(db: Session, user: User, conv_id: uuid.UUID) -> Conversation:
    conv = db.scalar(select(Conversation).where(Conversation.id == conv_id, Conversation.user_id == user.id))
    if conv is None:
        raise HTTPException(404, "Suhbat topilmadi")
    return conv


def _conv_out(c: Conversation) -> ConversationOut:
    return ConversationOut(id=str(c.id), title=c.title, updated_at=c.updated_at)


@router.get("/models", response_model=list[ModelOut])
def list_models():
    return MODELS


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
        MessageOut(id=str(m.id), role=m.role.value, content=m.content, model=m.model, created_at=m.created_at)
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
    """Foydalanuvchi xabarini saqlaydi va tanlangan modelning javobini SSE orqali oqimlaydi."""
    model = find_model(body.model)
    if model is None:
        raise HTTPException(400, f"Noma'lum model: {body.model}")

    # Oqim boshlanishidan OLDIN tekshiramiz: kalit yo'q bo'lsa, oddiy 400 xato qaytadi
    key_row = db.scalar(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == model["provider"]))
    if key_row is None:
        raise HTTPException(400, f"{model['provider'].value} uchun API kalit kiritilmagan. Settings sahifasiga o'ting.")
    try:
        api_key = decrypt(key_row.encrypted_key)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))

    conv = _own_conversation(db, user, conv_id)
    db.add(Message(conversation_id=conv.id, role=Role.user, content=body.content))
    if conv.title == "New chat":
        conv.title = body.content.strip().replace("\n", " ")[:60]
    db.commit()
    history = merge_history([{"role": m.role.value, "content": m.content} for m in conv.messages])
    conv_uuid = conv.id

    async def event_stream():
        parts: list[str] = []
        try:
            async for chunk in STREAMERS[model["provider"]](api_key, model["id"], history):
                parts.append(chunk)
                yield _sse({"type": "delta", "text": chunk})
            if not parts:
                raise ProviderError("Model bo'sh javob qaytardi.")
            error = None
        except ProviderError as exc:
            error = str(exc)
        except Exception:  # kutilmagan xato oqimni sindirmasin
            error = "Kutilmagan xato yuz berdi."

        # Qisman javob bo'lsa ham saqlaymiz; so'rov sessiyasi yopilgan bo'lishi mumkin, shuning uchun yangi sessiya
        message_id = None
        if parts:
            with SessionLocal() as s:
                msg = Message(conversation_id=conv_uuid, role=Role.assistant, content="".join(parts), model=model["id"])
                s.add(msg)
                c = s.get(Conversation, conv_uuid)
                if c:
                    c.updated_at = func.now()
                s.commit()
                message_id = str(msg.id)
        if error:
            yield _sse({"type": "error", "message": error})
        else:
            yield _sse({"type": "done", "message_id": message_id})

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
