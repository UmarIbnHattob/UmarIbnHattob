"""Media Studio: rasm yaratish, ro'yxat, ko'rish/yuklab olish, o'chirish."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import MediaItem, Provider, User
from app.providers import gemini_image
from app.providers.base import ProviderError
from app.quota import refund_on_error, resolve_key_info
from app.usage_log import record

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
def list_media(
    limit: int = Query(60, ge=1, le=200),
    before: datetime | None = None,
    before_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Eng yangisidan boshlab. Keyingi sahifa: ?before=<oxirgi elementning created_at>&before_id=<uning id si>."""
    # `data` ustunini yuklamaymiz: ro'yxat tez bo'lishi uchun
    stmt = select(MediaItem).where(MediaItem.user_id == user.id)
    if before is not None:
        if before_id is not None:
            # (vaqt, id) juftligi bo'yicha: vaqti bir xil rasmlar sahifa chegarasida tushib qolmaydi
            stmt = stmt.where(tuple_(MediaItem.created_at, MediaItem.id) < tuple_(before, before_id))
        else:  # eski mijozlar: faqat vaqt bo'yicha
            stmt = stmt.where(MediaItem.created_at < before)
    elif before_id is not None:
        raise HTTPException(422, "before_id faqat before bilan birga ishlatiladi.")
    rows = db.scalars(stmt.order_by(MediaItem.created_at.desc(), MediaItem.id.desc()).limit(limit))
    return [_out(m) for m in rows]


@router.post("/images", response_model=MediaOut, status_code=201)
async def create_image(body: ImageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.model not in {m["id"] for m in gemini_image.IMAGE_MODELS}:
        raise HTTPException(400, f"Noma'lum model: {body.model}")
    api_key, platform = resolve_key_info(db, user, Provider.gemini)

    # Rasm yaratish 1-2 daqiqa olishi mumkin: shu vaqtda baza ulanishini band qilib turmaymiz
    user_id = user.id
    db.close()
    # Provayder xatosida bepul limit qaytariladi; model javob berib, rasm chiqmasa (rad etildi) qaytarilmaydi.
    # Ikkalasida ham statistikaga yozilmaydi.
    try:
        with refund_on_error(user_id, platform):
            mime, data = await gemini_image.generate_image(api_key, body.model, body.prompt)
    except ProviderError as exc:
        raise HTTPException(502, str(exc))
    record(user_id, "image", "gemini", body.model, platform)

    item = MediaItem(user_id=user_id, prompt=body.prompt, model=body.model, mime_type=mime, data=data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _out(item)


@router.get("/{media_id}/file")
def get_file(
    media_id: uuid.UUID,
    download: bool = False,
    if_none_match: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = _own(db, user, media_id)  # avval kirish va egalik tekshiriladi, keyin kesh
    # Brauzer rasmni saqlashi mumkin, lekin har safar serverdan so'raydi: chiqqandan keyin (cookie yo'q) 401 bo'ladi.
    # Rasm o'zgarmaydi, shuning uchun ETag = id; mos kelsa baytlar qayta yuborilmaydi (304).
    etag = f'"{item.id}"'
    headers = {"Cache-Control": "private, no-cache", "ETag": etag}
    if if_none_match and etag in {t.strip().removeprefix("W/") for t in if_none_match.split(",")}:
        return Response(status_code=304, headers=headers)
    if download:
        ext = item.mime_type.split("/")[-1]
        headers["Content-Disposition"] = f'attachment; filename="omniai-{item.id}.{ext}"'
    return Response(content=item.data, media_type=item.mime_type, headers=headers)


@router.delete("/{media_id}", status_code=204)
def delete_media(media_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(_own(db, user, media_id))
    db.commit()
