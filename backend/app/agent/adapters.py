"""Agentning bitta qadami: umumiy xabarlar formatini har bir provayder formatiga o'giradi va javobni qaytaradi.

Umumiy (mijoz saqlaydigan) xabarlar:
  {"role": "user", "content": "matn"}
  {"role": "assistant", "provider": "anthropic|deepseek|gemini", "raw": <provayder javobi o'zgarishsiz>}
  {"role": "tool_results", "results": [{"id": "...", "name": "...", "output": "...", "is_error": false}]}

Assistant javobi `raw` holida qaytariladi va keyingi qadamda O'ZGARTIRILMASDAN yuboriladi:
Claude'ning thinking bloklari va Gemini'ning thoughtSignature'lari shuni talab qiladi.
"""
import json
from dataclasses import dataclass, field

import anthropic
import httpx

from app.agent.tools import TOOLS
from app.providers import deepseek, openai_compat
from app.providers.anthropic import client_for, friendly_sdk_error
from app.providers.base import ProviderError, friendly_http_error

AGENT_TIMEOUT = httpx.Timeout(connect=10, read=300, write=60, pool=10)
TRUNCATED = "(Javob uzunlik chegarasida to'xtadi.)"


@dataclass
class StepResult:
    raw: object
    text: str
    tool_calls: list[dict] = field(default_factory=list)  # [{"id","name","args"}]
    note: str | None = None


# ---------------------------------------------------------------- Claude (SDK)

def _anthropic_messages(messages: list[dict]) -> list[dict]:
    out: list[dict] = []

    def add_user(blocks: list[dict]) -> None:
        # Ketma-ket user xabarlari (masalan to'xtatilgandan keyin yangi buyruq) bitta xabarga birlashtiriladi
        if out and out[-1]["role"] == "user":
            out[-1]["content"] += blocks
        else:
            out.append({"role": "user", "content": blocks})

    for m in messages:
        if m["role"] == "user":
            add_user([{"type": "text", "text": m["content"]}])
        elif m["role"] == "assistant":
            out.append({"role": "assistant", "content": m["raw"]})
        else:  # tool_results: hammasi bitta user xabarida (parallel chaqiruvlar uchun)
            add_user([
                {"type": "tool_result", "tool_use_id": r["id"], "content": r["output"], "is_error": bool(r.get("is_error"))}
                for r in m["results"]
            ])
    return out


async def step_anthropic(api_key: str, model: str, system: str, messages: list[dict]) -> StepResult:
    tools = [{"name": t["name"], "description": t["description"], "input_schema": t["schema"]} for t in TOOLS]
    try:
        resp = await client_for(api_key).messages.create(
            model=model, max_tokens=16000, system=system, tools=tools, messages=_anthropic_messages(messages)
        )
    except anthropic.APIError as exc:
        raise friendly_sdk_error(exc)
    if resp.stop_reason == "refusal":
        raise ProviderError("Claude bu so'rovga xavfsizlik sababli javob bermadi.")
    raw = [b.model_dump(mode="json", exclude_none=True) for b in resp.content]
    text = "".join(b.text for b in resp.content if b.type == "text")
    calls = [{"id": b.id, "name": b.name, "args": b.input} for b in resp.content if b.type == "tool_use"]
    if resp.stop_reason == "max_tokens":
        # Kesilgan tool chaqiruvi yarim kirish bilan kelishi mumkin: bajarmaymiz
        return StepResult(raw=raw, text=text, tool_calls=[], note=TRUNCATED)
    return StepResult(raw=raw, text=text, tool_calls=calls)


# ---------------------------------------------------------------- OpenAI-mos (Deepseek, OpenRouter, Groq, Ollama…)

_openai_messages = openai_compat.agent_messages


async def step_openai(base_url: str, api_key: str | None, model: str, system: str, messages: list[dict], label: str = "Model") -> StepResult:
    raw, text, calls, truncated = await openai_compat.step(base_url, api_key, model, system, messages, TOOLS, label)
    return StepResult(raw=raw, text=text, tool_calls=[] if truncated else calls, note=TRUNCATED if truncated else None)


async def step_deepseek(api_key: str, model: str, system: str, messages: list[dict]) -> StepResult:
    return await step_openai(deepseek.BASE_URL, api_key, model, system, messages, "Deepseek")


# ---------------------------------------------------------------- Gemini

def _gemini_contents(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages:
        if m["role"] == "user":
            out.append({"role": "user", "parts": [{"text": m["content"]}]})
        elif m["role"] == "assistant":
            out.append(m["raw"])  # thoughtSignature'lar bilan o'zgarishsiz
        else:
            out.append({
                "role": "user",
                "parts": [
                    {"functionResponse": {"name": r["name"], "response": {"output": r["output"], "is_error": bool(r.get("is_error"))}}}
                    for r in m["results"]
                ],
            })
    return out


async def step_gemini(api_key: str, model: str, system: str, messages: list[dict]) -> StepResult:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": _gemini_contents(messages),
        "tools": [{"functionDeclarations": [
            {"name": t["name"], "description": t["description"], "parameters": t["schema"]} for t in TOOLS
        ]}],
    }
    try:
        async with httpx.AsyncClient(timeout=AGENT_TIMEOUT) as client:
            r = await client.post(url, headers={"x-goog-api-key": api_key}, json=body)
    except httpx.TimeoutException:
        raise ProviderError("Gemini javob bermadi (vaqt tugadi).")
    except httpx.HTTPError as exc:
        raise ProviderError(f"Gemini bilan ulanishda xato: {exc.__class__.__name__}")
    if r.status_code != 200:
        raise friendly_http_error(r.status_code, r.text)
    cands = r.json().get("candidates") or []
    if not cands or "content" not in cands[0]:
        raise ProviderError("Gemini javob qaytarmadi (xavfsizlik filtri bo'lishi mumkin).")
    content = cands[0]["content"]
    content.setdefault("role", "model")
    parts = content.get("parts", [])
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    # Gemini chaqiruvlarga id bermaydi: tartib raqami bilan o'zimiz beramiz
    calls = [
        {"id": f"g{i}", "name": p["functionCall"]["name"], "args": p["functionCall"].get("args") or {}}
        for i, p in enumerate(parts) if "functionCall" in p
    ]
    note = TRUNCATED if cands[0].get("finishReason") == "MAX_TOKENS" else None
    return StepResult(raw=content, text=text, tool_calls=[] if note else calls, note=note)


STEPPERS = {"anthropic": step_anthropic, "deepseek": step_deepseek, "gemini": step_gemini}
