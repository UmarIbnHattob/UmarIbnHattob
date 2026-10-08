"""Provayderlar uchun umumiy narsalar: xato turi, SSE o'quvchi, tarixni tayyorlash."""
import json
from collections.abc import AsyncIterator

import httpx

# Provayderga 60 soniya javob kutamiz, ulanish uchun 10 soniya
TIMEOUT = httpx.Timeout(connect=10, read=60, write=30, pool=10)


class ProviderError(Exception):
    """Foydalanuvchiga ko'rsatiladigan tushunarli xato."""


def friendly_http_error(status: int, body: str) -> ProviderError:
    if status in (401, 403):
        return ProviderError("API kalit noto'g'ri yoki ruxsat yo'q. Settings sahifasida tekshiring.")
    if status == 429:
        return ProviderError("So'rovlar limiti tugadi (429). Birozdan keyin qayta urinib ko'ring.")
    if status >= 500:
        return ProviderError(f"Provayder serverida xato ({status}). Keyinroq urinib ko'ring.")
    return ProviderError(f"Provayder xatosi ({status}): {body[:300]}")


async def iter_sse_data(response: httpx.Response) -> AsyncIterator[dict | str]:
    """SSE oqimidan `data:` qatorlarini JSON sifatida beradi ([DONE] -> '[DONE]')."""
    async for line in response.aiter_lines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload:
            continue
        if payload == "[DONE]":
            yield payload
            continue
        try:
            yield json.loads(payload)
        except json.JSONDecodeError:
            continue


def merge_history(messages: list[dict]) -> list[dict]:
    """Ketma-ket bir xil rolli xabarlarni birlashtiradi.

    Javob xato bilan tugasa, tarixda ikkita 'user' xabar yonma-yon qolishi mumkin;
    Claude buni qabul qilmaydi.
    """
    merged: list[dict] = []
    for m in messages:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n\n" + m["content"]
        else:
            merged.append({"role": m["role"], "content": m["content"]})
    return merged
