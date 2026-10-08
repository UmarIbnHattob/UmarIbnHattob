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
from app.quota import resolve_key

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

    api_key = resolve_key(db, user, Provider.gemini)
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
