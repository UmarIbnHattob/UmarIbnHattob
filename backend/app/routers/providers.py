"""Foydalanuvchi provayderlari: OpenRouter, Groq, OpenAI, Mistral, xAI, Together, Ollama, LM Studio, boshqa OpenAI-mos."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.crypto import decrypt, encrypt
from app.database import get_db
from app.deps import get_current_user
from app.models import CustomProvider, User
from app.netguard import UnsafeURL, check_url
from app.providers import openai_compat
from app.providers.base import ProviderError
from app.providers.presets import PRESETS

router = APIRouter(prefix="/providers", tags=["providers"])
MAX_PROVIDERS = 20

Kind = Literal["openrouter", "groq", "openai", "mistral", "xai", "together", "ollama", "lmstudio", "custom"]


class ProviderIn(BaseModel):
    kind: Kind
    name: str | None = Field(default=None, max_length=60)
    base_url: str | None = Field(default=None, max_length=300)
    api_key: str | None = Field(default=None, max_length=500)


def _out(cp: CustomProvider) -> dict:
    return {
        "id": str(cp.id), "kind": cp.kind, "name": cp.name, "base_url": cp.base_url,
        "has_key": bool(cp.encrypted_key), "model_count": len(cp.models or []),
        "free_count": sum(1 for m in cp.models or [] if m.get("free")),
        "local": PRESETS.get(cp.kind, {}).get("local", False),
    }


def _own(db: Session, user: User, pid: uuid.UUID) -> CustomProvider:
    cp = db.scalar(select(CustomProvider).where(CustomProvider.id == pid, CustomProvider.user_id == user.id))
    if cp is None:
        raise HTTPException(404, "Provayder topilmadi")
    return cp


async def _fetch_models(base_url: str, key: str | None) -> list[dict]:
    try:
        models = await openai_compat.list_models(base_url, key)
    except ProviderError as exc:
        raise HTTPException(400, str(exc))
    if not models:
        raise HTTPException(400, "Bu manzilda birorta model topilmadi. Lokal bo'lsa, avval modelni yuklab oling (masalan: ollama pull llama3.2).")
    return models


@router.get("/presets")
def presets():
    return {"presets": PRESETS, "allow_local": settings.allow_local_providers}


@router.get("")
def list_providers(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(CustomProvider).where(CustomProvider.user_id == user.id).order_by(CustomProvider.created_at))
    return [_out(cp) for cp in rows]


@router.post("", status_code=201)
async def add_provider(body: ProviderIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    preset = PRESETS[body.kind]
    count = len(list(db.scalars(select(CustomProvider.id).where(CustomProvider.user_id == user.id))))
    if count >= MAX_PROVIDERS:
        raise HTTPException(400, f"Ko'pi bilan {MAX_PROVIDERS} ta provayder qo'shish mumkin.")
    base = (body.base_url or preset["base_url"]).strip()
    if not base:
        raise HTTPException(400, "Manzil (base URL) kiriting.")
    try:
        base = check_url(base)
    except UnsafeURL as exc:
        raise HTTPException(400, str(exc))
    key = (body.api_key or "").strip() or None
    if preset["needs_key"] and not key:
        raise HTTPException(400, f"{preset['name']} uchun API kalit kerak.")
    user_id = user.id
    db.close()  # tarmoq so'rovi davomida ulanishni band qilmaymiz
    models = await _fetch_models(base, key)  # ulanish va kalitni tekshiradi
    cp = CustomProvider(user_id=user_id, kind=body.kind, name=(body.name or preset["name"]).strip()[:60], base_url=base,
                        encrypted_key=encrypt(key) if key else None, models=models)
    db.add(cp)
    db.commit()
    db.refresh(cp)
    return _out(cp)


@router.post("/{pid}/refresh")
async def refresh_provider(pid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cp = _own(db, user, pid)
    base, key = cp.base_url, decrypt(cp.encrypted_key) if cp.encrypted_key else None
    try:
        check_url(base)
    except UnsafeURL as exc:
        raise HTTPException(400, str(exc))
    models = await _fetch_models(base, key)
    cp = _own(db, user, pid)
    cp.models = models
    db.commit()
    return _out(cp)


@router.delete("/{pid}", status_code=204)
def delete_provider(pid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(_own(db, user, pid))
    db.commit()
