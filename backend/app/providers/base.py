"""Provayderlar uchun umumiy narsalar: xato turi, SSE o'quvchi, tarixni tayyorlash."""
import json
from collections.abc import AsyncIterator

import httpx

# Javob uzunligi chegarasi (Claude/Deepseek uchun)
MAX_OUTPUT_TOKENS = 8192
TRUNCATED_NOTE = "\n\n_(Javob uzunlik chegarasida to'xtadi. \"Davom et\" deb yozing.)_"
FILTERED_NOTE = "\n\n_(Javob kontent filtri tomonidan to'xtatildi.)_"
INTERRUPTED_NOTE = "\n\n_(Javob to'liq kelmadi: ulanish uzilib qoldi. Qayta urinib ko'ring.)_"


def refusal_note(label: str, reason: str = "") -> str:
    """Model so'rovni rad etganda (Claude'dagi kabi) foydalanuvchiga ko'rsatiladigan izoh."""
    reason = " ".join(reason.split())[:500]
    return f"\n\n_({label} bu so'rovga javob bermadi{': ' + reason if reason else '.'})_"

# Provayderga 60 soniya javob kutamiz, ulanish uchun 10 soniya
TIMEOUT = httpx.Timeout(connect=10, read=60, write=30, pool=10)


class ProviderError(Exception):
    """Foydalanuvchiga ko'rsatiladigan tushunarli xato."""


class EmptyReply(ProviderError):
    """Provayder 200 bilan javob berdi (so'rov hisoblangan), lekin foydali natija yo'q (masalan rasm chiqmadi).

    Bepul limit qaytarilmaydi: aks holda rad etiladigan so'rovlar bilan platforma kalitini tekin ishlatish mumkin.
    """


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
            if m.get("image"):
                merged[-1]["image"] = m["image"]
        else:
            merged.append(dict(m))
    return merged


def trim_history(messages: list[dict], max_chars: int = 120_000) -> list[dict]:
    """Juda uzun suhbatda eng eski xabarlarni tashlab yuboradi (model kontekst chegarasidan oshmasin).

    Oxirgi xabar doim qoladi; natija 'user' bilan boshlanadi (Claude talabi).
    """
    total, kept = 0, []
    for m in reversed(messages):
        total += len(m["content"])
        if kept and total > max_chars:
            break
        kept.append(m)
    kept.reverse()
    while len(kept) > 1 and kept[0]["role"] != "user":
        kept.pop(0)
    return kept
