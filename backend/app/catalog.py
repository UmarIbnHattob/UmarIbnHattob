"""Model katalogi: o'rnatilgan modellar (Claude, Deepseek, Gemini) + foydalanuvchi qo'shgan provayderlar.

Chat, agent va Auto rejimi modelni shu yerdan oladi: qaysi kalit, qanday chaqirish, qobiliyatlari.
"""
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import quota
from app.crypto import decrypt
from app.models import ApiKey, CustomProvider, Provider, User
from app.netguard import UnsafeURL, check_url_async
from app.providers import openai_compat
from app.providers.presets import PRESETS
from app.providers.registry import MODELS, STREAMERS

# Agent rejimida (asbob chaqiruvi) ishonchli o'rnatilgan modellar
BUILTIN_AGENT = {"claude-sonnet-5-5", "claude-opus-5-5", "deepseek-chat", "gemini-2.5-pro", "gemini-2.5-flash"}
CUSTOM_PREFIX = "cp:"


@dataclass
class Resolved:
    id: str  # modelning provayderdagi nomi (masalan "claude-sonnet-5-5" yoki "meta-llama/llama-3.3-70b")
    ref: str  # katalogdagi to'liq id ("cp:<uuid>:<model>" yoki o'rnatilgan id)
    label: str
    provider: str  # anthropic | deepseek | gemini | openrouter | groq | ollama | ...
    vision: bool
    tools: bool
    platform: bool  # oylik limitli platforma kaliti bilan chaqiriladimi
    stream: Callable[[list[dict], str | None], AsyncIterator[str]]
    base_url: str | None = None
    api_key: str | None = None


def _own_providers(db: Session, user: User) -> set[Provider]:
    return {k.provider for k in db.scalars(select(ApiKey).where(ApiKey.user_id == user.id))}


def catalog(db: Session, user: User) -> list[dict]:
    """UI uchun ro'yxat: har bir model + mavjudmi (kalit bor-yo'qligi va bepul limit qolgan-qolmaganligi).

    `platform`: model faqat oylik limitli platforma kaliti orqali ishlaydi.
    `unavailable_reason`: mavjud bo'lmasa sababi — "no_key" (kalit yo'q) yoki "quota" (bepul limit tugagan).
    """
    own = _own_providers(db, user)
    out_of_quota = quota.exhausted(db, user)
    items = []
    for m in MODELS:
        mine = m["provider"] in own
        shared = bool(quota.platform_key(m["provider"]))
        available = mine or (shared and not out_of_quota)
        items.append({
            "id": m["id"], "label": m["label"], "provider": m["provider"].value, "vision": m["vision"],
            "tools": m["id"] in BUILTIN_AGENT, "group": m["provider"].value, "source": "builtin",
            "available": available, "free": False, "platform": not mine and shared,
            "unavailable_reason": None if available else ("quota" if shared else "no_key"),
        })
    for cp in db.scalars(select(CustomProvider).where(CustomProvider.user_id == user.id).order_by(CustomProvider.created_at)):
        # Eski (filtrdan oldin saqlangan) ro'yxatlarda Whisper/TTS va h.k. bo'lishi mumkin: ko'rsatilmaydi
        for m in (x for x in cp.models or [] if openai_compat.is_chat_model(x["id"])):
            items.append({
                "id": f"{CUSTOM_PREFIX}{cp.id}:{m['id']}", "label": m.get("label") or m["id"], "provider": cp.kind,
                "vision": bool(m.get("vision")), "tools": bool(m.get("tools", True)), "group": cp.name,
                "source": "custom", "available": True, "free": bool(m.get("free")), "platform": False,
                "unavailable_reason": None,
            })
    return items


def _custom(db: Session, user: User, ref: str) -> tuple[CustomProvider, dict]:
    try:
        _, pid, model_id = ref.split(":", 2)
        cp = db.scalar(select(CustomProvider).where(CustomProvider.id == uuid.UUID(pid), CustomProvider.user_id == user.id))
    except ValueError:
        cp = None
    if cp is None:
        raise HTTPException(400, "Provayder topilmadi (o'chirilgan bo'lishi mumkin).")
    meta = next((m for m in cp.models or [] if m["id"] == model_id), None) or {"id": model_id, "label": model_id}
    return cp, meta


async def resolve(db: Session, user: User, ref: str, reserve: bool = True) -> Resolved:
    """Modelni chaqirishga tayyorlaydi.

    Platforma kaliti ishlatilsa oylik limitdan bitta so'rov band qilinadi. So'rovni avval tekshirish kerak bo'lsa
    (masalan rasm/asbob qo'llab-quvvatlashi), `reserve=False` bilan chaqirib, tekshiruvdan keyin `charge()` qiling.
    """
    if ref.startswith(CUSTOM_PREFIX):
        cp, meta = _custom(db, user, ref)
        base, name = cp.base_url, cp.name
        # Manzil ichki tarmoqqa o'zgarmaganmi (tushunarli 400 uchun; DNS alohida oqimda). Asosiy himoya ulanish
        # paytida (netguard.http_client): bu tekshiruvdan keyin DNS o'zgartirilsa ham ichki manzilga ulanilmaydi.
        try:
            await check_url_async(base)
        except UnsafeURL as exc:
            raise HTTPException(400, f"{name}: {exc}")
        key = decrypt(cp.encrypted_key) if cp.encrypted_key else None
        label = f"{meta.get('label') or meta['id']}"

        def stream(messages, system, _m=meta["id"], _k=key, _b=base, _l=label):
            return openai_compat.stream_chat(_b, _k, _m, messages, system, label=_l)

        return Resolved(id=meta["id"], ref=ref, label=label, provider=cp.kind, vision=bool(meta.get("vision")),
                        tools=bool(meta.get("tools", True)), platform=False, stream=stream, base_url=base, api_key=key)

    m = next((x for x in MODELS if x["id"] == ref), None)
    if m is None:
        raise HTTPException(400, f"Noma'lum model: {ref}")
    key, platform = quota.key_for(db, user, m["provider"])
    fn = STREAMERS[m["provider"]]

    def stream(messages, system, _fn=fn, _k=key, _id=m["id"]):
        return _fn(_k, _id, messages, system=system)

    res = Resolved(id=m["id"], ref=ref, label=m["label"], provider=m["provider"].value, vision=m["vision"],
                   tools=m["id"] in BUILTIN_AGENT, platform=platform, stream=stream, api_key=key)
    if reserve:
        charge(db, user, res)
    return res


def charge(db: Session, user: User, res: Resolved) -> None:
    """Platforma kaliti bo'lsa oylik limitdan bitta so'rovni band qiladi (tugagan bo'lsa 429)."""
    if res.platform:
        quota.reserve(db, user)


def preset_stt(cp: CustomProvider) -> str | None:
    return PRESETS.get(cp.kind, {}).get("stt_model")


Completer = Callable[[str, str | None], Awaitable[str]]
