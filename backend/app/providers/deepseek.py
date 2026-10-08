"""Deepseek (OpenAI-mos Chat Completions API) — oqimli javob."""
from collections.abc import AsyncIterator

import httpx

from app.providers.base import TIMEOUT, ProviderError, friendly_http_error, iter_sse_data

URL = "https://api.deepseek.com/chat/completions"


async def stream_chat(api_key: str, model: str, messages: list[dict]) -> AsyncIterator[str]:
    headers = {"Authorization": f"Bearer {api_key}"}
    body = {"model": model, "stream": True, "messages": messages}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            async with client.stream("POST", URL, headers=headers, json=body) as r:
                if r.status_code != 200:
                    raise friendly_http_error(r.status_code, (await r.aread()).decode(errors="ignore"))
                async for ev in iter_sse_data(r):
                    if not isinstance(ev, dict):
                        continue
                    choices = ev.get("choices") or []
                    text = choices[0].get("delta", {}).get("content") if choices else None
                    if text:
                        yield text
    except httpx.TimeoutException:
        raise ProviderError("Deepseek javob bermadi (vaqt tugadi). Qayta urinib ko'ring.")
    except httpx.HTTPError as exc:
        raise ProviderError(f"Deepseek bilan ulanishda xato: {exc.__class__.__name__}")
