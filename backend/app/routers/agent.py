"""Agent rejimi: bitta qadam (model -> matn + asbob chaqiruvlari). Asboblar desktop ilovada bajariladi."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agent.adapters import STEPPERS
from app.agent.tools import SYSTEM_PROMPT
from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.providers.base import ProviderError
from app.providers.registry import AGENT_MODELS, find_model
from app.quota import resolve_key

router = APIRouter(prefix="/agent", tags=["agent"])


class AgentMessage(BaseModel):
    role: Literal["user", "assistant", "tool_results"]
    content: str | None = None
    provider: str | None = None
    raw: object | None = None
    results: list[dict] | None = None


class StepIn(BaseModel):
    model: str
    folder: str = Field(default="project", max_length=200)
    messages: list[AgentMessage] = Field(min_length=1, max_length=400)


@router.get("/models")
def agent_models():
    return AGENT_MODELS


@router.post("/step")
async def agent_step(body: StepIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    model = find_model(body.model)
    if model is None or body.model not in {m["id"] for m in AGENT_MODELS}:
        raise HTTPException(400, f"Bu model agent rejimini qo'llab-quvvatlamaydi: {body.model}")
    provider = model["provider"].value

    msgs = [m.model_dump(exclude_none=True) for m in body.messages]
    for m in msgs:
        if m["role"] == "user" and not isinstance(m.get("content"), str):
            raise HTTPException(400, "Foydalanuvchi xabari matn bo'lishi kerak")
        if m["role"] == "assistant" and m.get("provider") != provider:
            # Thinking/signature bloklari boshqa provayderga o'tmaydi: sessiya bitta provayderda qoladi
            raise HTTPException(400, "Agent sessiyasi o'rtasida provayderni almashtirib bo'lmaydi. Yangi sessiya boshlang.")
        if m["role"] == "tool_results" and not m.get("results"):
            raise HTTPException(400, "tool_results bo'sh")

    api_key = resolve_key(db, user, model["provider"])
    db.close()  # model 1-5 daqiqa o'ylashi mumkin: ulanishni band qilmaymiz

    system = SYSTEM_PROMPT.format(folder=body.folder.replace("\n", " "))
    try:
        res = await STEPPERS[provider](api_key, model["id"], system, msgs)
    except ProviderError as exc:
        raise HTTPException(502, str(exc))
    return {
        "assistant": {"role": "assistant", "provider": provider, "raw": res.raw},
        "text": res.text,
        "tool_calls": res.tool_calls,
        "note": res.note,
    }
