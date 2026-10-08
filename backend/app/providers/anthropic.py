"""Claude (Anthropic Messages API) — oqimli javob."""
from collections.abc import AsyncIterator

import httpx

from app.providers.base import TIMEOUT, ProviderError, friendly_http_error, iter_sse_data

URL = "https://api.anthropic.com/v1/messages"


async def stream_chat(api_key: str, model: str, messages: list[dict]) -> AsyncIterator[str]:
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    body = {"model": model, "max_tokens": 4096, "stream": True, "messages": messages}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            async with client.stream("POST", URL, headers=headers, json=body) as r:
                if r.status_code != 200:
                    raise friendly_http_error(r.status_code, (await r.aread()).decode(errors="ignore"))
                async for ev in iter_sse_data(r):
                    if not isinstance(ev, dict):
                        continue
                    if ev.get("type") == "content_block_delta":
                        text = ev.get("delta", {}).get("text")
                        if text:
                            yield text
                    elif ev.get("type") == "error":
                        raise ProviderError(ev.get("error", {}).get("message", "Claude xatosi"))
    except httpx.TimeoutException:
        raise ProviderError("Claude javob bermadi (vaqt tugadi). Qayta urinib ko'ring.")
    except httpx.HTTPError as exc:
        raise ProviderError(f"Claude bilan ulanishda xato: {exc.__class__.__name__}")
