"""Foydalanuvchi provayderlari: OpenRouter, Groq, OpenAI, Mistral, xAI, Together, Ollama, LM Studio, boshqa OpenAI-mos."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.crypto import decrypt, encrypt
from app.database import get_db
from app.deps import get_current_user
from app.models import CustomProvider, User
from app.netguard import UnsafeURL, check_url_async
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


class ProviderPatch(BaseModel):
    """Kalitni almashtirish yoki nomini o'zgartirish (provayder id si va saqlangan model havolalari o'zgarmaydi)."""

    name: str | None = Field(default=None, max_length=60)
    api_key: str | None = Field(default=None, max_length=500)


def _out(cp: CustomProvider) -> dict:
    # Eski (filtrdan oldin saqlangan) ro'yxatlardagi Whisper/TTS va h.k. sanalmaydi: katalogdagi son bilan bir xil
    chat = [m for m in cp.models or [] if openai_compat.is_chat_model(m["id"])]
    return {
        "id": str(cp.id), "kind": cp.kind, "name": cp.name, "base_url": cp.base_url,
        "has_key": bool(cp.encrypted_key), "model_count": len(chat),
        "free_count": sum(1 for m in chat if m.get("free")),
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


def _lock_user(db: Session, user_id: uuid.UUID) -> None:
    """Foydalanuvchi qatorini tranzaksiya oxirigacha qulflaydi: bir vaqtdagi qo'shishlar navbat bilan tekshiriladi.

    FOR NO KEY UPDATE: boshqa jadvallarga (FK) yozishni to'smaydi, faqat shu qulfni olmoqchi bo'lganlarni kutdiradi.
    """
    db.execute(select(User.id).where(User.id == user_id).with_for_update(key_share=True))


def _check_new(db: Session, user_id: uuid.UUID, kind: str, base: str) -> None:
    """Limit (20 ta) va takror (shu tur + shu manzil) tekshiruvi."""
    count = db.scalar(select(func.count()).select_from(CustomProvider).where(CustomProvider.user_id == user_id))
    if count >= MAX_PROVIDERS:
        raise HTTPException(400, f"Ko'pi bilan {MAX_PROVIDERS} ta provayder qo'shish mumkin.")
    dup = db.scalar(select(CustomProvider.name).where(
        CustomProvider.user_id == user_id, CustomProvider.kind == kind, func.lower(CustomProvider.base_url) == base.lower()
    ))
    if dup is not None:
        raise HTTPException(409, f"Bu provayder allaqachon qo'shilgan ({dup}). Kalitni almashtirish uchun uni tahrirlang.")


@router.post("", status_code=201)
async def add_provider(body: ProviderIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    preset = PRESETS[body.kind]
    base = (body.base_url or preset["base_url"]).strip()
    if not base:
        raise HTTPException(400, "Manzil (base URL) kiriting.")
    try:
        base = await check_url_async(base)  # DNS so'rovi event loop'ni to'xtatmaydi
    except UnsafeURL as exc:
        raise HTTPException(400, str(exc))
    key = (body.api_key or "").strip() or None
    if preset["needs_key"] and not key:
        raise HTTPException(400, f"{preset['name']} uchun API kalit kerak.")
    user_id = user.id
    _check_new(db, user_id, body.kind, base)  # tez rad etish (tarmoq so'rovidan oldin)
    db.close()  # tarmoq so'rovi davomida ulanishni band qilmaymiz
    models = await _fetch_models(base, key)  # ulanish va kalitni tekshiradi
    cp = CustomProvider(user_id=user_id, kind=body.kind, name=(body.name or "").strip()[:60] or preset["name"], base_url=base,
                        encrypted_key=encrypt(key) if key else None, models=models)

    def insert() -> None:
        # Tarmoq so'rovi davomida parallel so'rovlar qo'shgan bo'lishi mumkin: qulf ostida qayta tekshiramiz.
        # Alohida oqimda (qulfni kutish event loop'ni to'xtatmasin) va rad etilsa qulf darhol bo'shatiladi.
        try:
            _lock_user(db, user_id)
            _check_new(db, user_id, body.kind, base)
            db.add(cp)
            db.commit()
        except BaseException:
            db.rollback()
            raise
        db.refresh(cp)

    await run_in_threadpool(insert)
    return _out(cp)


@router.patch("/{pid}")
async def update_provider(pid: uuid.UUID, body: ProviderPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Kalitni almashtirish (yangi kalit bilan model ro'yxati qayta olinadi va tekshiriladi) va/yoki nomini o'zgartirish."""
    cp = _own(db, user, pid)
    fields = body.model_fields_set
    preset = PRESETS.get(cp.kind, {})
    name = None
    if "name" in fields:  # bo'sh nom — shablon nomi
        name = (body.name or "").strip()[:60] or preset.get("name") or cp.kind
    if "api_key" in fields:
        key = (body.api_key or "").strip() or None
        if preset.get("needs_key") and not key:
            raise HTTPException(400, f"{preset['name']} uchun API kalit kerak.")
        base = cp.base_url
        try:
            await check_url_async(base)
        except UnsafeURL as exc:
            raise HTTPException(400, str(exc))
        db.close()
        models = await _fetch_models(base, key)  # yangi kalit ishlashini tekshiradi
        cp = _own(db, user, pid)
        cp.encrypted_key, cp.models = (encrypt(key) if key else None), models
    if name is not None:
        cp.name = name
    db.commit()
    db.refresh(cp)
    return _out(cp)


@router.post("/{pid}/refresh")
async def refresh_provider(pid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cp = _own(db, user, pid)
    base, key = cp.base_url, decrypt(cp.encrypted_key) if cp.encrypted_key else None
    try:
        await check_url_async(base)
    except UnsafeURL as exc:
        raise HTTPException(400, str(exc))
    models = await _fetch_models(base, key)
    cp = _own(db, user, pid)
    cp.models = models
    db.commit()
    return _out(cp)


@router.delete("/{pid}", status_code=204)
def delete_provider(pid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cp = _own(db, user, pid)
    # Standart model shu provayderniki bo'lsa, tozalanadi (aks holda "Yangi suhbat" o'chirilgan modelni tanlaydi)
    prefs = dict(user.preferences or {})
    if str(prefs.get("default_model") or "").startswith(f"cp:{cp.id}:"):
        prefs["default_model"] = None
        user.preferences = prefs
    db.delete(cp)
    db.commit()
