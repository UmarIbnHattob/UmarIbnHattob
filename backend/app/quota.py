"""Qaysi API kalit ishlatilishini aniqlash: foydalanuvchining o'zi yoki platforma kaliti (oylik limit bilan)."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.crypto import decrypt
from app.models import ApiKey, Provider, UsageCounter, User


def platform_key(provider: Provider) -> str:
    return {
        Provider.anthropic: settings.platform_anthropic_key,
        Provider.deepseek: settings.platform_deepseek_key,
        Provider.gemini: settings.platform_gemini_key,
    }[provider]


def current_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def used_this_month(db: Session, user: User) -> int:
    row = db.get(UsageCounter, (user.id, current_month()))
    return row.requests if row else 0


def _consume(db: Session, user: User) -> bool:
    """Limit tugamagan bo'lsa hisoblagichni bittaga oshiradi. Bir vaqtdagi so'rovlarda ham atomar."""
    row = db.execute(
        text(
            "INSERT INTO usage_counters (user_id, month, requests) VALUES (:u, :m, 1) "
            "ON CONFLICT (user_id, month) DO UPDATE SET requests = usage_counters.requests + 1 "
            "WHERE usage_counters.requests < :limit RETURNING requests"
        ),
        {"u": user.id, "m": current_month(), "limit": settings.free_monthly_requests},
    ).first()
    db.commit()
    return row is not None


def resolve_key(db: Session, user: User, provider: Provider) -> str:
    """Foydalanuvchining kaliti bo'lsa o'shani, aks holda platforma kalitini (limit bo'lsa) qaytaradi."""
    own = db.scalar(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == provider))
    if own is not None:
        try:
            return decrypt(own.encrypted_key)
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

    shared = platform_key(provider)
    if not shared:
        raise HTTPException(400, f"{provider.value} uchun API kalit kiritilmagan. Settings sahifasiga o'ting.")
    if settings.free_monthly_requests <= 0 or not _consume(db, user):
        raise HTTPException(
            429,
            f"Bu oy uchun bepul limit ({settings.free_monthly_requests} so'rov) tugadi. "
            "Settings sahifasida o'z API kalitingizni kiriting yoki keyingi oyni kuting.",
        )
    return shared
