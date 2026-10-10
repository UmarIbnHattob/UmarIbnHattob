"""Ovozli xabar -> matn (Gemini audio tushunish orqali, zaxira: Whisper). O'zbek, rus va ingliz tillari."""
import base64
import binascii
import uuid
from collections.abc import Callable

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import preset_stt
from app.config import settings
from app.crypto import decrypt
from app.database import get_db
from app.deps import get_current_user
from app.models import CustomProvider, Provider, User
from app.netguard import UnsafeURL, check_url_async
from app.providers import openai_compat
from app.providers.base import ProviderError, friendly_http_error
from app.quota import key_for, refund, reserve
from app.usage_log import record

router = APIRouter(prefix="/voice", tags=["voice"])

TRANSCRIBE_MODEL = "gemini-2.5-flash"
PROMPT = (
    "Transcribe this voice message exactly as spoken. The speaker usually uses Uzbek (Latin script), "
    "sometimes Russian or English, and may mix them. Keep the original language, write Uzbek in Latin script, "
    "add normal punctuation, and return ONLY the transcript text. If there is no speech, return an empty string."
)
# ~2 daqiqa 16kHz mono WAV ≈ 3.8 MB; base64 bilan ~5 MB
MAX_B64 = 6_000_000
NEED_KEY = (
    "Ovozni matnga aylantirish uchun Gemini kaliti (bepul: aistudio.google.com) yoki Groq provayderi kerak. "
    "Settings sahifasida qo'shing."
)
# Gemini xatosi shu bo'lsa (kalit noto'g'ri / limit) Whisper'ga o'tamiz; server xatosi va ulanish xatosida ham
FALLBACK_STATUSES = {401, 403, 429}


def _can_fall_back(status: int | None) -> bool:
    return status is None or status in FALLBACK_STATUSES or status >= 500


def _key_invalid(status: int, body: str) -> bool:
    """Gemini noto'g'ri yoki muddati o'tgan kalitga 401 emas, 400 qaytaradi (reason: API_KEY_INVALID)."""
    return status == 400 and any(s in body for s in ("API_KEY_INVALID", "API key not valid", "API key expired"))


def _is_mp3(b: bytes) -> bool:
    return b[:3] == b"ID3" or (len(b) > 1 and b[0] == 0xFF and (b[1] & 0xE0) == 0xE0)


# mime -> (fayl kengaytmasi, "sehrli baytlar" tekshiruvi): audio bo'lmagan ma'lumot provayderga (va limitga) yetmasin
AUDIO_FORMATS: dict[str, tuple[str, Callable[[bytes], bool]]] = {
    "audio/wav": ("wav", lambda b: b[:4] == b"RIFF" and b[8:12] == b"WAVE"),
    "audio/ogg": ("ogg", lambda b: b[:4] == b"OggS"),
    "audio/mp3": ("mp3", _is_mp3),
    "audio/mpeg": ("mp3", _is_mp3),
    "audio/flac": ("flac", lambda b: b[:4] == b"fLaC"),
}


class VoiceIn(BaseModel):
    audio: str = Field(min_length=100, max_length=MAX_B64)  # base64 WAV
    mime: str = "audio/wav"


class _GeminiFailed(Exception):
    def __init__(self, status: int | None, message: str):
        super().__init__(message)
        self.status = status


async def _gemini(api_key: str, mime: str, audio_b64: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{TRANSCRIBE_MODEL}:generateContent"
    req = {"contents": [{"parts": [{"inlineData": {"mimeType": mime, "data": audio_b64}}, {"text": PROMPT}]}]}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=90, write=60, pool=10)) as client:
            r = await client.post(url, headers={"x-goog-api-key": api_key}, json=req)
    except httpx.HTTPError:
        raise _GeminiFailed(None, "Ovozni matnga aylantirish xizmatiga ulanib bo'lmadi.")
    if r.status_code != 200:
        # Noto'g'ri kalit (400 API_KEY_INVALID) 401 kabi ko'riladi: tushunarli xabar va Whisper'ga o'tish
        status = 401 if _key_invalid(r.status_code, r.text) else r.status_code
        raise _GeminiFailed(status, str(friendly_http_error(status, r.text)))
    parts = ((r.json().get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()


async def _whisper(user_id, whisper: tuple[str, str | None, str], raw: bytes, ext: str, mime: str) -> dict:
    base, key, model = whisper
    try:
        text = await openai_compat.transcribe(base, key, model, raw, filename=f"voice.{ext}", mime=mime)
    except ProviderError as exc:
        raise HTTPException(502, str(exc))
    record(user_id, "voice", "whisper", model, False)
    return {"text": text}


@router.post("/transcribe")
async def transcribe(body: VoiceIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fmt = AUDIO_FORMATS.get(body.mime)
    if fmt is None:
        raise HTTPException(400, "Audio formati qo'llab-quvvatlanmaydi (WAV kerak).")
    try:
        raw = base64.b64decode(body.audio, validate=True)
    except binascii.Error:
        raise HTTPException(400, "Audio noto'g'ri kodlangan.")
    ext, looks_ok = fmt
    if not looks_ok(raw):
        raise HTTPException(400, f"Audio {ext.upper()} formatida emas.")

    # 1) Gemini (o'z kaliti yoki platforma limiti); 2) Gemini ishlatib bo'lmasa (kalit yo'q, limit tugagan, o'z kaliti
    # ishlamadi) — Whisper (Groq / OpenAI provayderi). Whisper provayderi faqat shunda qidiriladi.
    user_id = user.id
    try:
        api_key, platform = key_for(db, user, Provider.gemini)
    except HTTPException:
        api_key, platform = None, False
    quota_out = False
    if api_key and platform:
        try:
            reserve(db, user)
        except HTTPException:
            api_key, quota_out = None, True

    if api_key is None:
        whisper = await _whisper_provider(db, user_id)
        db.close()
        if whisper is None:
            if quota_out:
                raise HTTPException(
                    429,
                    f"Bu oy uchun bepul limit ({settings.free_monthly_requests} so'rov) tugadi. Ovoz uchun o'z Gemini "
                    "kalitingizni (bepul: aistudio.google.com) yoki Groq provayderini qo'shing.",
                )
            raise HTTPException(400, NEED_KEY)
        return await _whisper(user_id, whisper, raw, ext, body.mime)

    db.close()  # Gemini javobini kutish davomida baza ulanishini band qilmaymiz
    try:
        text = await _gemini(api_key, body.mime, body.audio)
    except _GeminiFailed as exc:
        # So'rov Gemini'da bajarilmadi (HTTP xato yoki ulanish yo'q): bepul limit qaytariladi.
        # Bekor qilish va kutilmagan xatoda qaytarilmaydi (so'rov hisoblangan bo'lishi mumkin).
        if platform:
            refund(user_id)
        whisper = await _whisper_provider(db, user_id) if _can_fall_back(exc.status) else None
        db.close()
        if whisper is not None:
            return await _whisper(user_id, whisper, raw, ext, body.mime)
        raise HTTPException(502, str(exc))
    record(user_id, "voice", "gemini", TRANSCRIBE_MODEL, platform)
    return {"text": text}


async def _whisper_provider(db: Session, user_id: uuid.UUID) -> tuple[str, str | None, str] | None:
    """Whisper qo'llaydigan birinchi provayder (Groq/OpenAI): (base_url, key, model)."""
    rows = db.scalars(
        select(CustomProvider).where(CustomProvider.user_id == user_id).order_by(CustomProvider.created_at)
    ).all()
    for cp in rows:
        model = preset_stt(cp)
        if not model:
            continue
        try:
            # Manzil ichki tarmoqqa o'zgarmagan bo'lsin (DNS alohida oqimda; ulanishda ham tekshiriladi)
            await check_url_async(cp.base_url)
        except UnsafeURL:
            continue
        return cp.base_url, decrypt(cp.encrypted_key) if cp.encrypted_key else None, model
    return None
