"""Gemini (Google Generative Language API) — oqimli javob."""
from collections.abc import AsyncIterator

import httpx

from app.providers.base import TIMEOUT, TRUNCATED_NOTE, ProviderError, friendly_http_error, iter_sse_data

BASE = "https://generativelanguage.googleapis.com/v1beta/models"


async def stream_chat(api_key: str, model: str, messages: list[dict], system: str | None = None) -> AsyncIterator[str]:
    url = f"{BASE}/{model}:streamGenerateContent?alt=sse"
    headers = {"x-goog-api-key": api_key}
    # Gemini da assistant roli "model" deb ataladi
    contents = []
    for m in messages:
        parts = [{"text": m["content"]}]
        if m.get("image"):
            parts.insert(0, {"inlineData": {"mimeType": "image/png", "data": m["image"]}})
        contents.append({"role": "model" if m["role"] == "assistant" else "user", "parts": parts})
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            body = {"contents": contents}
            if system:
                body["systemInstruction"] = {"parts": [{"text": system}]}
            async with client.stream("POST", url, headers=headers, json=body) as r:
                if r.status_code != 200:
                    raise friendly_http_error(r.status_code, (await r.aread()).decode(errors="ignore"))
                async for ev in iter_sse_data(r):
                    if not isinstance(ev, dict):
                        continue
                    for cand in ev.get("candidates", [])[:1]:
                        for part in cand.get("content", {}).get("parts", []):
                            if part.get("text"):
                                yield part["text"]
                        if cand.get("finishReason") == "MAX_TOKENS":
                            yield TRUNCATED_NOTE
    except httpx.TimeoutException:
        raise ProviderError("Gemini javob bermadi (vaqt tugadi). Qayta urinib ko'ring.")
    except httpx.HTTPError as exc:
        raise ProviderError(f"Gemini bilan ulanishda xato: {exc.__class__.__name__}")
