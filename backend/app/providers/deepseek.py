"""Deepseek — OpenAI-mos API (umumiy kod: openai_compat)."""
from collections.abc import AsyncIterator

from app.providers import openai_compat

BASE_URL = "https://api.deepseek.com"


async def stream_chat(api_key: str, model: str, messages: list[dict], system: str | None = None) -> AsyncIterator[str]:
    async for chunk in openai_compat.stream_chat(BASE_URL, api_key, model, messages, system, label="Deepseek"):
        yield chunk
