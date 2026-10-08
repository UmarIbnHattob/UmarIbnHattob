"""Media Studio: rasm yaratish, ro'yxat, ko'rish/yuklab olish, o'chirish."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crypto import decrypt
from app.database import get_db
from app.deps import get_current_user
from app.models import ApiKey, MediaItem, Provider, User
from app.providers import gemini_image
from app.providers.base import ProviderError

router = APIRouter(prefix="/media", tags=["media"])


class ImageIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    model: str


class MediaOut(BaseModel):
    id: str
    kind: str
    prompt: str
    model: str
    created_at: str


def _out(m: MediaItem) -> MediaOut:
    return MediaOut(id=str(m.id), kind=m.kind, prompt=m.prompt, model=m.model, created_at=m.created_at.isoformat())


def _own(db: Session, user: User, media_id: uuid.UUID) -> MediaItem:
    item = db.scalar(select(MediaItem).where(MediaItem.id == media_id, MediaItem.user_id == user.id))
    if item is None:
        raise HTTPException(404, "Fayl topilmadi")
    return item


@router.get("/models")
def image_models():
    return gemini_image.IMAGE_MODELS


@router.get("", response_model=list[MediaOut])
def list_media(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # `data` ustunini yuklamaymiz: ro'yxat tez bo'lishi uchun
    rows = db.scalars(
        select(MediaItem).where(MediaItem.user_id == user.id).order_by(MediaItem.created_at.desc()).limit(60)
    )
    return [_out(m) for m in rows]


@router.post("/images", response_model=MediaOut, status_code=201)
async def create_image(body: ImageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.model not in {m["id"] for m in gemini_image.IMAGE_MODELS}:
        raise HTTPException(400, f"Noma'lum model: {body.model}")
    key_row = db.scalar(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == Provider.gemini))
    if key_row is None:
        raise HTTPException(400, "gemini uchun API kalit kiritilmagan. Settings sahifasiga o'ting.")
    try:
        api_key = decrypt(key_row.encrypted_key)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))

    try:
        mime, data = await gemini_image.generate_image(api_key, body.model, body.prompt)
    except ProviderError as exc:
        raise HTTPException(502, str(exc))

    item = MediaItem(user_id=user.id, prompt=body.prompt, model=body.model, mime_type=mime, data=data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _out(item)


@router.get("/{media_id}/file")
def get_file(media_id: uuid.UUID, download: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = _own(db, user, media_id)
    headers = {"Cache-Control": "private, max-age=86400"}
    if download:
        ext = item.mime_type.split("/")[-1]
        headers["Content-Disposition"] = f'attachment; filename="omniai-{item.id}.{ext}"'
    return Response(content=item.data, media_type=item.mime_type, headers=headers)


@router.delete("/{media_id}", status_code=204)
def delete_media(media_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(_own(db, user, media_id))
    db.commit()
