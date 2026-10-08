"""Gemini (Google Generative Language API) — oqimli javob."""
from collections.abc import AsyncIterator

import httpx

from app.providers.base import TIMEOUT, ProviderError, friendly_http_error, iter_sse_data

BASE = "https://generativelanguage.googleapis.com/v1beta/models"


async def stream_chat(api_key: str, model: str, messages: list[dict]) -> AsyncIterator[str]:
    url = f"{BASE}/{model}:streamGenerateContent?alt=sse"
    headers = {"x-goog-api-key": api_key}
    # Gemini da assistant roli "model" deb ataladi
    contents = [
        {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
        for m in messages
    ]
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            async with client.stream("POST", url, headers=headers, json={"contents": contents}) as r:
                if r.status_code != 200:
                    raise friendly_http_error(r.status_code, (await r.aread()).decode(errors="ignore"))
                async for ev in iter_sse_data(r):
                    if not isinstance(ev, dict):
                        continue
                    for cand in ev.get("candidates", [])[:1]:
                        for part in cand.get("content", {}).get("parts", []):
                            if part.get("text"):
                                yield part["text"]
    except httpx.TimeoutException:
        raise ProviderError("Gemini javob bermadi (vaqt tugadi). Qayta urinib ko'ring.")
    except httpx.HTTPError as exc:
        raise ProviderError(f"Gemini bilan ulanishda xato: {exc.__class__.__name__}")
