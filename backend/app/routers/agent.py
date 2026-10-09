"""Agent rejimi: bitta qadam (model -> matn + asbob chaqiruvlari) va serverda bajariladigan asboblar.

Fayl asboblari desktop ilovada bajariladi; generate_image va ask_expert serverda (API kalitlar shu yerda).
"""
import base64
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agent import adapters
from app.agent.tools import SYSTEM_PROMPT
from app.catalog import catalog, resolve
from app.database import get_db
from app.deps import get_current_user
from app.models import Provider, User
from app.personalize import system_prompt
from app.providers import gemini_image
from app.providers.base import ProviderError
from app.providers.router_auto import choose
from app.quota import resolve_key_info
from app.usage_log import record

router = APIRouter(prefix="/agent", tags=["agent"])

# Javob formati oilasi: bir oila ichida model almashtirish mumkin (masalan Deepseek <-> OpenRouter)
FAMILY = {"anthropic": "anthropic", "gemini": "gemini"}


def family(provider: str) -> str:
    return FAMILY.get(provider, "openai")


class AgentMessage(BaseModel):
    role: Literal["user", "assistant", "tool_results"]
    content: str | None = None
    provider: str | None = None
    raw: object | None = None
    results: list[dict] | None = None


class StepIn(BaseModel):
    model: str
    folder: str = Field(default="project", max_length=200)
    messages: list[AgentMessage] = Field(min_length=1, max_length=600)


@router.get("/models")
def agent_models(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Asbob chaqira oladigan modellar; birinchisi "auto"."""
    items = [m for m in catalog(db, user) if m["tools"]]
    return [{"id": "auto", "label": "Auto", "provider": "auto", "available": True, "group": "auto", "source": "builtin", "vision": True, "tools": True}] + items


def _pick_auto(db: Session, user: User) -> str:
    picked = choose("code", catalog(db, user), need_tools=True)
    if picked is None:
        raise HTTPException(400, "Agent uchun mos model topilmadi. Settings sahifasida kalit kiriting yoki provayder qo'shing.")
    return picked["id"]


@router.post("/step")
async def agent_step(body: StepIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ref = _pick_auto(db, user) if body.model == "auto" else body.model
    if not ref.startswith("cp:") and ref not in {m["id"] for m in catalog(db, user) if m["tools"]}:
        raise HTTPException(400, f"Bu model agent rejimini qo'llab-quvvatlamaydi: {ref}")
    res_model = resolve(db, user, ref)
    fam = family(res_model.provider)

    msgs = [m.model_dump(exclude_none=True) for m in body.messages]
    for m in msgs:
        if m["role"] == "user" and not isinstance(m.get("content"), str):
            raise HTTPException(400, "Foydalanuvchi xabari matn bo'lishi kerak")
        if m["role"] == "assistant" and family(m.get("provider") or "") != fam:
            # Thinking/signature bloklari boshqa formatga o'tmaydi: sessiya bitta format oilasida qoladi
            raise HTTPException(400, "Agent sessiyasi o'rtasida bu modelga o'tib bo'lmaydi. Yangi sessiya boshlang.")
        if m["role"] == "tool_results" and not m.get("results"):
            raise HTTPException(400, "tool_results bo'sh")

    personal = system_prompt(user)
    record(user.id, "agent", res_model.provider, res_model.id, res_model.platform)
    db.close()  # model 1-5 daqiqa o'ylashi mumkin: ulanishni band qilmaymiz

    system = SYSTEM_PROMPT.format(folder=body.folder.replace("\n", " "))
    if personal:
        system += "\n\n" + personal
    try:
        if fam == "openai" and res_model.base_url:
            res = await adapters.step_openai(res_model.base_url, res_model.api_key, res_model.id, system, msgs, res_model.label)
        else:
            res = await adapters.STEPPERS[res_model.provider](res_model.api_key, res_model.id, system, msgs)
    except ProviderError as exc:
        raise HTTPException(502, str(exc))
    return {
        "assistant": {"role": "assistant", "provider": res_model.provider, "raw": res.raw},
        "text": res.text,
        "tool_calls": res.tool_calls,
        "note": res.note,
        "model": {"id": ref, "label": res_model.label, "provider": res_model.provider},
    }


class ImageIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)


@router.post("/image")
async def agent_image(body: ImageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """generate_image asbobi: PNG ni base64 qilib qaytaradi (desktop uni papkaga ruxsat bilan yozadi)."""
    api_key, platform = resolve_key_info(db, user, Provider.gemini)
    model = gemini_image.IMAGE_MODELS[0]["id"]
    record(user.id, "image", "gemini", model, platform)
    db.close()
    try:
        mime, data = await gemini_image.generate_image(api_key, model, body.prompt)
    except ProviderError as exc:
        raise HTTPException(502, str(exc))
    return {"mime": mime, "data": base64.b64encode(data).decode(), "model": model}


class ExpertIn(BaseModel):
    question: str = Field(min_length=1, max_length=20000)
    expertise: Literal["design", "code", "reasoning"] = "code"
    exclude: str | None = None  # orkestrator modeli: boshqa modeldan maslahat olinadi


EXPERT_SYSTEM = {
    "design": "You are a senior UI/UX and visual designer. Give concrete, implementable advice: palette (hex), typography, layout, spacing, section copy. Be concise.",
    "code": "You are a senior software engineer reviewing or advising on code. Be concrete and concise; show code where useful.",
    "reasoning": "You are a careful systems architect. Reason step by step and give a clear recommendation.",
}


@router.post("/expert")
async def agent_expert(body: ExpertIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """ask_expert asbobi: savolni boshqa (mavzuga mos) modelga beradi."""
    kind = {"design": "vision", "code": "code", "reasoning": "reasoning"}[body.expertise]
    items = [m for m in catalog(db, user) if m["id"] != body.exclude]
    picked = choose(kind, items)
    if picked is None:
        raise HTTPException(400, "Ekspert uchun boshqa model topilmadi.")
    res_model = resolve(db, user, picked["id"])
    record(user.id, "agent", res_model.provider, res_model.id, res_model.platform)
    db.close()
    try:
        answer = "".join([t async for t in res_model.stream([{"role": "user", "content": body.question}], EXPERT_SYSTEM[body.expertise])])
    except ProviderError as exc:
        raise HTTPException(502, str(exc))
    return {"answer": answer, "model": res_model.label}
