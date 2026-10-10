"""API kalitlarni boshqarish. Kalitning o'zi hech qachon javobda qaytarilmaydi."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.crypto import encrypt
from app.database import get_db
from app.deps import get_current_user
from app.models import ApiKey, Provider, User
from app.quota import current_month, exhausted, platform_key, used_this_month
from app.schemas import ApiKeyIn, ApiKeyOut, UsageOut

router = APIRouter(prefix="/keys", tags=["keys"])


@router.get("", response_model=list[ApiKeyOut])
def list_keys(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Har bir provayder uchun kalit sozlangan-sozlanmaganini qaytaradi."""
    saved = {k.provider: k for k in db.scalars(select(ApiKey).where(ApiKey.user_id == user.id))}
    out_of_quota = exhausted(db, user)
    return [
        ApiKeyOut(
            provider=p,
            configured=p in saved,
            last4=saved[p].last4 if p in saved else None,
            updated_at=saved[p].updated_at if p in saved else None,
            # Bepul limit tugagan bo'lsa platforma kaliti amalda ishlamaydi
            platform_available=bool(platform_key(p)) and not out_of_quota,
            platform_exhausted=bool(platform_key(p)) and out_of_quota,
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

    # Bitta so'rov bilan "bor bo'lsa almashtir, yo'q bo'lsa qo'sh": ikki marta bosilganda ham UniqueViolation (500) bo'lmaydi
    stmt = insert(ApiKey).values(user_id=user.id, provider=provider, encrypted_key=encrypted, last4=key[-4:])
    stmt = stmt.on_conflict_do_update(
        index_elements=[ApiKey.user_id, ApiKey.provider],
        set_={"encrypted_key": stmt.excluded.encrypted_key, "last4": stmt.excluded.last4, "updated_at": func.now()},
    ).returning(ApiKey.last4, ApiKey.updated_at)
    last4, updated_at = db.execute(stmt).one()
    db.commit()
    return ApiKeyOut(provider=provider, configured=True, last4=last4, updated_at=updated_at)


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
