"""Claude (rasmiy Anthropic Python SDK) — oqimli chat javobi."""
from collections.abc import AsyncIterator

import anthropic

from app.providers.base import TRUNCATED_NOTE, ProviderError

# Claude oqimli javob uchun chegara (SDK tavsiyasi: oqimda katta qiymat xavfsiz)
CHAT_MAX_TOKENS = 64000
REFUSAL_NOTE = "\n\n_(Claude bu so'rovga xavfsizlik sababli javob bermadi.)_"


def client_for(api_key: str) -> anthropic.AsyncAnthropic:
    # Vaqt chegarasi: ulanish 10s, umumiy 10 daqiqa (uzoq javoblar uchun); 2 marta qayta urinish (429/5xx)
    return anthropic.AsyncAnthropic(api_key=api_key, timeout=600.0, max_retries=2)


def friendly_sdk_error(exc: Exception) -> ProviderError:
    """SDK xatolarini foydalanuvchiga tushunarli xabarga aylantiradi."""
    if isinstance(exc, (anthropic.AuthenticationError, anthropic.PermissionDeniedError)):
        return ProviderError("Claude API kaliti noto'g'ri yoki ruxsat yo'q. Settings sahifasida tekshiring.")
    if isinstance(exc, anthropic.RateLimitError):
        return ProviderError("Claude so'rovlar limiti tugadi (429). Birozdan keyin qayta urinib ko'ring.")
    if isinstance(exc, anthropic.APITimeoutError):
        return ProviderError("Claude javob bermadi (vaqt tugadi). Qayta urinib ko'ring.")
    if isinstance(exc, anthropic.APIConnectionError):
        return ProviderError("Claude bilan ulanib bo'lmadi. Internetni tekshiring.")
    if isinstance(exc, anthropic.BadRequestError):
        return ProviderError(f"Claude so'rovni qabul qilmadi: {exc.message[:300]}")
    if isinstance(exc, anthropic.APIStatusError):
        if exc.status_code >= 500:
            return ProviderError(f"Claude serverida xato ({exc.status_code}). Keyinroq urinib ko'ring.")
        return ProviderError(f"Claude xatosi ({exc.status_code}): {exc.message[:300]}")
    return ProviderError("Claude bilan kutilmagan xato.")


def _to_api(m: dict) -> dict:
    """Canvas rasmi bo'lsa, xabarni [rasm, matn] bloklariga aylantiradi."""
    if not m.get("image"):
        return {"role": m["role"], "content": m["content"]}
    image = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": m["image"]}}
    return {"role": m["role"], "content": [image, {"type": "text", "text": m["content"]}]}


async def stream_chat(api_key: str, model: str, messages: list[dict]) -> AsyncIterator[str]:
    try:
        async with client_for(api_key).beta.messages.stream(
            model=model,
            max_tokens=CHAT_MAX_TOKENS,
            messages=[_to_api(m) for m in messages],
            # Xavfsizlik klassifikatori adashib rad etsa, Anthropic tavsiya qilgan modelda qayta urinadi
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            async for text in stream.text_stream:
                yield text
            final = await stream.get_final_message()
        if final.stop_reason == "max_tokens":
            yield TRUNCATED_NOTE
        elif final.stop_reason == "refusal":
            yield REFUSAL_NOTE
    except anthropic.APIError as exc:
        raise friendly_sdk_error(exc)
