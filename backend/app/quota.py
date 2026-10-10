"""Qaysi API kalit ishlatilishini aniqlash: foydalanuvchining o'zi yoki platforma kaliti (oylik limit bilan).

Platforma kaliti ishlatilsa, oylik limitdan bitta so'rov so'rov BOSHLANISHIDAN OLDIN atomar band qilinadi
(`reserve`) va so'rov muvaffaqiyatsiz tugasa (xato, bo'sh javob, bekor qilish) qaytariladi (`refund`).
Shunda bir vaqtdagi so'rovlar ham limitdan oshmaydi, xato so'rovlar esa limitni yemaydi.
"""
import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.crypto import decrypt
from app.database import SessionLocal
from app.models import ApiKey, Provider, UsageCounter, User

log = logging.getLogger(__name__)


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


def exhausted(db: Session, user: User) -> bool:
    """Bu oy uchun bepul platforma limiti tugaganmi."""
    return settings.free_monthly_requests <= 0 or used_this_month(db, user) >= settings.free_monthly_requests


def quota_message() -> str:
    return (
        f"Bu oy uchun bepul limit ({settings.free_monthly_requests} so'rov) tugadi. "
        "Settings sahifasida o'z API kalitingizni kiriting yoki keyingi oyni kuting."
    )


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


def reserve(db: Session, user: User) -> None:
    """Platforma limitidan bitta so'rovni band qiladi (tugagan bo'lsa 429)."""
    if settings.free_monthly_requests <= 0 or not _consume(db, user):
        raise HTTPException(429, quota_message())


def refund(user_id: uuid.UUID) -> None:
    """Muvaffaqiyatsiz so'rov uchun band qilingan so'rovni qaytaradi.

    Alohida sessiyada (asosiy so'rov sessiyasi yopilgan bo'lishi mumkin); atomar va manfiyga tushmaydi.
    """
    try:
        with SessionLocal() as s:
            s.execute(
                text(
                    "UPDATE usage_counters SET requests = requests - 1 "
                    "WHERE user_id = :u AND month = :m AND requests > 0"
                ),
                {"u": user_id, "m": current_month()},
            )
            s.commit()
    except Exception:
        log.exception("Bepul limitni qaytarib bo'lmadi")


@contextmanager
def refund_on_error(user_id: uuid.UUID, platform: bool) -> Iterator[None]:
    """Blok ichida xato (yoki bekor qilish) bo'lsa, platforma limitidan olingan so'rovni qaytaradi."""
    try:
        yield
    except BaseException:
        if platform:
            refund(user_id)
        raise


def key_for(db: Session, user: User, provider: Provider) -> tuple[str, bool]:
    """(kalit, platforma_kalitimi) — limitdan YECHMAYDI. O'z kaliti doim platforma kalitidan ustun."""
    own = db.scalar(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == provider))
    if own is not None:
        try:
            return decrypt(own.encrypted_key), False
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))
    shared = platform_key(provider)
    if not shared:
        raise HTTPException(400, f"{provider.value} uchun API kalit kiritilmagan. Settings sahifasiga o'ting.")
    return shared, True


def resolve_key_info(db: Session, user: User, provider: Provider) -> tuple[str, bool]:
    """(kalit, platforma_kalitimi) qaytaradi; platforma kaliti bo'lsa limitdan bitta so'rov band qilinadi."""
    key, platform = key_for(db, user, provider)
    if platform:
        reserve(db, user)
    return key, platform


def resolve_key(db: Session, user: User, provider: Provider) -> str:
    """Foydalanuvchining kaliti bo'lsa o'shani, aks holda platforma kalitini (limit bo'lsa) qaytaradi."""
    return resolve_key_info(db, user, provider)[0]
