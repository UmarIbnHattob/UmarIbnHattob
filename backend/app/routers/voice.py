"""Ovozli xabar -> matn (Gemini audio tushunish orqali). O'zbek, rus va ingliz tillari."""
import base64
import binascii

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Provider, User
from app.providers.base import friendly_http_error
from app.catalog import preset_stt
from app.crypto import decrypt
from app.models import CustomProvider
from app.providers import openai_compat
from app.providers.base import ProviderError
from app.quota import resolve_key_info
from sqlalchemy import select
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


class VoiceIn(BaseModel):
    audio: str = Field(min_length=100, max_length=MAX_B64)  # base64 WAV
    mime: str = "audio/wav"


@router.post("/transcribe")
async def transcribe(body: VoiceIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.mime not in {"audio/wav", "audio/ogg", "audio/mp3", "audio/mpeg", "audio/flac"}:
        raise HTTPException(400, "Audio formati qo'llab-quvvatlanmaydi (WAV kerak).")
    try:
        raw = base64.b64decode(body.audio, validate=True)
    except binascii.Error:
        raise HTTPException(400, "Audio noto'g'ri kodlangan.")
    if body.mime == "audio/wav" and not (raw[:4] == b"RIFF" and raw[8:12] == b"WAVE"):
        raise HTTPException(400, "Audio WAV formatida emas.")

    # 1) Gemini (o'z kaliti yoki platforma); 2) bo'lmasa Whisper (Groq / OpenAI provayderi)
    try:
        api_key, platform = resolve_key_info(db, user, Provider.gemini)
    except HTTPException:
        whisper = _whisper_provider(db, user)
        if whisper is None:
            raise HTTPException(
                400,
                "Ovozni matnga aylantirish uchun Gemini kaliti (bepul: aistudio.google.com) yoki Groq provayderi kerak. "
                "Settings sahifasida qo'shing.",
            )
        base, key, model = whisper
        record(user.id, "voice", "whisper", model, False)
        db.close()
        try:
            return {"text": await openai_compat.transcribe(base, key, model, raw)}
        except ProviderError as exc:
            raise HTTPException(502, str(exc))
    record(user.id, "voice", "gemini", TRANSCRIBE_MODEL, platform)
    db.close()

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{TRANSCRIBE_MODEL}:generateContent"
    req = {"contents": [{"parts": [{"inlineData": {"mimeType": body.mime, "data": body.audio}}, {"text": PROMPT}]}]}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=90, write=60, pool=10)) as client:
            r = await client.post(url, headers={"x-goog-api-key": api_key}, json=req)
    except httpx.HTTPError:
        raise HTTPException(502, "Ovozni matnga aylantirish xizmatiga ulanib bo'lmadi.")
    if r.status_code != 200:
        raise HTTPException(502, str(friendly_http_error(r.status_code, r.text)))
    parts = ((r.json().get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
    return {"text": text}


def _whisper_provider(db: Session, user: User) -> tuple[str, str | None, str] | None:
    """Whisper qo'llaydigan birinchi provayder (Groq/OpenAI): (base_url, key, model)."""
    for cp in db.scalars(select(CustomProvider).where(CustomProvider.user_id == user.id).order_by(CustomProvider.created_at)):
        model = preset_stt(cp)
        if model:
            return cp.base_url, decrypt(cp.encrypted_key) if cp.encrypted_key else None, model
    return None
