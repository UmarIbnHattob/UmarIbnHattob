"""Claude (Anthropic Messages API) — oqimli javob."""
from collections.abc import AsyncIterator

import httpx

from app.providers.base import MAX_OUTPUT_TOKENS, TIMEOUT, TRUNCATED_NOTE, ProviderError, friendly_http_error, iter_sse_data

URL = "https://api.anthropic.com/v1/messages"


def _to_api(m: dict) -> dict:
    """Canvas rasmi bo'lsa, xabarni [rasm, matn] bloklariga aylantiradi."""
    if not m.get("image"):
        return {"role": m["role"], "content": m["content"]}
    image = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": m["image"]}}
    return {"role": m["role"], "content": [image, {"type": "text", "text": m["content"]}]}


async def stream_chat(api_key: str, model: str, messages: list[dict]) -> AsyncIterator[str]:
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    body = {"model": model, "max_tokens": MAX_OUTPUT_TOKENS, "stream": True, "messages": [_to_api(m) for m in messages]}
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
                    elif ev.get("type") == "message_delta" and ev.get("delta", {}).get("stop_reason") == "max_tokens":
                        yield TRUNCATED_NOTE
                    elif ev.get("type") == "error":
                        raise ProviderError(ev.get("error", {}).get("message", "Claude xatosi"))
    except httpx.TimeoutException:
        raise ProviderError("Claude javob bermadi (vaqt tugadi). Qayta urinib ko'ring.")
    except httpx.HTTPError as exc:
        raise ProviderError(f"Claude bilan ulanishda xato: {exc.__class__.__name__}")
