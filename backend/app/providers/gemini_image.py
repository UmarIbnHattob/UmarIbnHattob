"""Gemini orqali rasm yaratish (generateContent, rasm modalligi)."""
import base64

import httpx

from app.providers.base import ProviderError, friendly_http_error

BASE = "https://generativelanguage.googleapis.com/v1beta/models"
# Rasm yaratish matn javobidan sekinroq: o'qish uchun 2 daqiqagacha kutamiz
IMAGE_TIMEOUT = httpx.Timeout(connect=10, read=120, write=30, pool=10)

IMAGE_MODELS = [
    {"id": "gemini-2.5-flash-image", "label": "Gemini 2.5 Flash Image"},
]


async def generate_image(api_key: str, model: str, prompt: str) -> tuple[str, bytes]:
    """(mime_type, bytes) qaytaradi."""
    url = f"{BASE}/{model}:generateContent"
    body = {"contents": [{"parts": [{"text": prompt}]}]}
    try:
        async with httpx.AsyncClient(timeout=IMAGE_TIMEOUT) as client:
            r = await client.post(url, headers={"x-goog-api-key": api_key}, json=body)
    except httpx.TimeoutException:
        raise ProviderError("Rasm yaratish vaqti tugadi. Qayta urinib ko'ring.")
    except httpx.HTTPError as exc:
        raise ProviderError(f"Gemini bilan ulanishda xato: {exc.__class__.__name__}")
    if r.status_code != 200:
        raise friendly_http_error(r.status_code, r.text)

    data = r.json()
    texts = []
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return inline.get("mimeType") or inline.get("mime_type") or "image/png", base64.b64decode(inline["data"])
            if part.get("text"):
                texts.append(part["text"])
    reason = (texts[0][:200] if texts else data.get("promptFeedback", {}).get("blockReason")) or "sabab noma'lum"
    raise ProviderError(f"Model rasm qaytarmadi ({reason}). So'rovni o'zgartirib ko'ring.")
