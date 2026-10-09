"""OpenAI-mos API (Chat Completions) — Deepseek, OpenRouter, Groq, OpenAI, Mistral, xAI, Ollama, LM Studio va boshqalar.

Bitta kod yuzlab modelni qamraydi: farq faqat manzil (base_url), kalit va model nomida.
"""
import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import (
    MAX_OUTPUT_TOKENS,
    TIMEOUT,
    TRUNCATED_NOTE,
    ProviderError,
    friendly_http_error,
    iter_sse_data,
)

AGENT_TIMEOUT = httpx.Timeout(connect=10, read=300, write=60, pool=10)
# OpenRouter ilovani taniy olishi uchun (ixtiyoriy sarlavhalar)
EXTRA_HEADERS = {"HTTP-Referer": "https://omniai.uz", "X-Title": "OmniAI Workspace"}


def _headers(api_key: str | None) -> dict:
    h = dict(EXTRA_HEADERS)
    if api_key:
        h["Authorization"] = f"Bearer {api_key}"
    return h


def _user_content(m: dict):
    """Rasm bo'lsa OpenAI formatidagi [matn, rasm] bloklari, aks holda oddiy matn."""
    if not m.get("image"):
        return m["content"]
    return [
        {"type": "text", "text": m["content"]},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{m['image']}"}},
    ]


async def stream_chat(
    base_url: str, api_key: str | None, model: str, messages: list[dict], system: str | None = None, label: str = "Model"
) -> AsyncIterator[str]:
    body = {
        "model": model,
        "stream": True,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "messages": ([{"role": "system", "content": system}] if system else [])
        + [{"role": m["role"], "content": _user_content(m) if m["role"] == "user" else m["content"]} for m in messages],
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            async with client.stream("POST", f"{base_url.rstrip('/')}/chat/completions", headers=_headers(api_key), json=body) as r:
                if r.status_code != 200:
                    raise friendly_http_error(r.status_code, (await r.aread()).decode(errors="ignore"))
                async for ev in iter_sse_data(r):
                    if not isinstance(ev, dict):
                        continue
                    if ev.get("error"):
                        raise ProviderError(f"{label}: {str(ev['error'].get('message', ev['error']))[:300]}")
                    choices = ev.get("choices") or []
                    if not choices:
                        continue
                    text = choices[0].get("delta", {}).get("content")
                    if text:
                        yield text
                    if choices[0].get("finish_reason") == "length":
                        yield TRUNCATED_NOTE
    except httpx.TimeoutException:
        raise ProviderError(f"{label} javob bermadi (vaqt tugadi). Qayta urinib ko'ring.")
    except httpx.ConnectError:
        raise ProviderError(f"{label} serveriga ulanib bo'lmadi. Manzilni tekshiring (lokal model ishga tushganmi?).")
    except httpx.HTTPError as exc:
        raise ProviderError(f"{label} bilan ulanishda xato: {exc.__class__.__name__}")


def agent_messages(system: str, messages: list[dict]) -> list[dict]:
    out = [{"role": "system", "content": system}]
    for m in messages:
        if m["role"] == "user":
            out.append({"role": "user", "content": m["content"]})
        elif m["role"] == "assistant":
            out.append(m["raw"])
        else:
            out += [{"role": "tool", "tool_call_id": r["id"], "content": r["output"]} for r in m["results"]]
    return out


async def step(base_url: str, api_key: str | None, model: str, system: str, messages: list[dict], tools: list[dict], label: str = "Model"):
    """Agent qadami (asbob chaqiruvi bilan). (raw, text, calls, truncated) qaytaradi."""
    body = {
        "model": model,
        "max_tokens": 8192,
        "messages": agent_messages(system, messages),
        "tools": [
            {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["schema"]}}
            for t in tools
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=AGENT_TIMEOUT) as client:
            r = await client.post(f"{base_url.rstrip('/')}/chat/completions", headers=_headers(api_key), json=body)
    except httpx.TimeoutException:
        raise ProviderError(f"{label} javob bermadi (vaqt tugadi).")
    except httpx.ConnectError:
        raise ProviderError(f"{label} serveriga ulanib bo'lmadi.")
    except httpx.HTTPError as exc:
        raise ProviderError(f"{label} bilan ulanishda xato: {exc.__class__.__name__}")
    if r.status_code != 200:
        raise friendly_http_error(r.status_code, r.text)
    data = r.json()
    if data.get("error"):
        raise ProviderError(f"{label}: {str(data['error'].get('message', data['error']))[:300]}")
    choice = (data.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    raw = {"role": "assistant", "content": msg.get("content") or ""}
    if msg.get("tool_calls"):
        raw["tool_calls"] = msg["tool_calls"]
    calls = []
    for tc in msg.get("tool_calls") or []:
        try:
            args = json.loads(tc["function"].get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {"__invalid_json__": tc["function"].get("arguments")}
        calls.append({"id": tc["id"], "name": tc["function"]["name"], "args": args})
    return raw, msg.get("content") or "", calls, choice.get("finish_reason") == "length"


async def complete(base_url: str, api_key: str | None, model: str, system: str | None, prompt: str, label: str = "Model") -> str:
    """Oddiy (oqimsiz) javob — "ekspertga savol" uchun."""
    parts = [t async for t in stream_chat(base_url, api_key, model, [{"role": "user", "content": prompt}], system, label)]
    return "".join(parts)


async def list_models(base_url: str, api_key: str | None) -> list[dict]:
    """GET /models — OpenAI formatidagi model ro'yxati. OpenRouter qo'shimcha maydonlarini ham o'qiydi."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20)) as client:
            r = await client.get(f"{base_url.rstrip('/')}/models", headers=_headers(api_key))
    except httpx.HTTPError as exc:
        raise ProviderError(f"Model ro'yxatini olib bo'lmadi: {exc.__class__.__name__}. Manzil va kalitni tekshiring.")
    if r.status_code != 200:
        raise friendly_http_error(r.status_code, r.text)
    out = []
    for m in (r.json().get("data") or [])[:800]:
        mid = m.get("id")
        if not mid:
            continue
        arch = m.get("architecture") or {}
        out_mod = arch.get("output_modalities") or ["text"]
        if "text" not in out_mod:
            continue  # faqat rasm/audio chiqaradigan modellarni chatga qo'shmaymiz
        params = m.get("supported_parameters")
        out.append({
            "id": mid,
            "label": m.get("name") or mid,
            "vision": "image" in (arch.get("input_modalities") or []) or any(k in mid.lower() for k in ("vision", "-vl", "llava")),
            "tools": ("tools" in params) if isinstance(params, list) else True,
            "free": mid.endswith(":free"),
        })
    return out


async def transcribe(base_url: str, api_key: str | None, model: str, wav: bytes) -> str:
    """Whisper (OpenAI/Groq) — ovozni matnga."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=90, write=60, pool=10)) as client:
            r = await client.post(
                f"{base_url.rstrip('/')}/audio/transcriptions",
                headers=_headers(api_key),
                data={"model": model},
                files={"file": ("voice.wav", wav, "audio/wav")},
            )
    except httpx.HTTPError:
        raise ProviderError("Ovozni matnga aylantirish xizmatiga ulanib bo'lmadi.")
    if r.status_code != 200:
        raise friendly_http_error(r.status_code, r.text)
    return (r.json().get("text") or "").strip()
