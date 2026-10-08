"""API kalitlarni boshqarish. Kalitning o'zi hech qachon javobda qaytarilmaydi."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.crypto import encrypt
from app.database import get_db
from app.deps import get_current_user
from app.models import ApiKey, Provider, User
from app.quota import current_month, platform_key, used_this_month
from app.schemas import ApiKeyIn, ApiKeyOut, UsageOut

router = APIRouter(prefix="/keys", tags=["keys"])


@router.get("", response_model=list[ApiKeyOut])
def list_keys(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Har bir provayder uchun kalit sozlangan-sozlanmaganini qaytaradi."""
    saved = {k.provider: k for k in db.scalars(select(ApiKey).where(ApiKey.user_id == user.id))}
    return [
        ApiKeyOut(
            provider=p,
            configured=p in saved,
            last4=saved[p].last4 if p in saved else None,
            updated_at=saved[p].updated_at if p in saved else None,
            platform_available=bool(platform_key(p)),
        )
        for p in Provider
    ]


@router.put("/{provider}", response_model=ApiKeyOut)
def save_key(
    provider: Provider,
    body: ApiKeyIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Kalitni shifrlab saqlaydi (mavjud bo'lsa, almashtiradi)."""
    key = body.key.strip()
    try:
        encrypted = encrypt(key)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    row = db.scalar(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == provider))
    if row is None:
        row = ApiKey(user_id=user.id, provider=provider, encrypted_key=encrypted, last4=key[-4:])
        db.add(row)
    else:
        row.encrypted_key, row.last4 = encrypted, key[-4:]
    db.commit()
    db.refresh(row)
    return ApiKeyOut(provider=provider, configured=True, last4=row.last4, updated_at=row.updated_at)


@router.delete("/{provider}", status_code=204)
def delete_key(provider: Provider, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = db.scalar(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == provider))
    if row is None:
        raise HTTPException(status_code=404, detail="Kalit topilmadi")
    db.delete(row)
    db.commit()


usage_router = APIRouter(tags=["keys"])


@usage_router.get("/usage", response_model=UsageOut)
def usage(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Platforma kaliti bilan bu oy qancha so'rov ishlatilgani."""
    return UsageOut(
        month=current_month(),
        used=used_this_month(db, user),
        limit=settings.free_monthly_requests,
        platform_providers=[p for p in Provider if platform_key(p)],
    )
