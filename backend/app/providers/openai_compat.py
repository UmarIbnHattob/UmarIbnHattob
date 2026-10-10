"""OpenAI-mos API (Chat Completions) — Deepseek, OpenRouter, Groq, OpenAI, Mistral, xAI, Ollama, LM Studio va boshqalar.

Bitta kod yuzlab modelni qamraydi: farq faqat manzil (base_url), kalit va model nomida.
"""
import json
import re
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


# OpenAI'ning o'zi: yangi modellar `max_tokens` o'rniga `max_completion_tokens` talab qiladi,
# Codex va "-pro" modellar esa faqat Responses API (/responses) orqali ishlaydi.
_RESPONSES_ONLY = re.compile(r"codex|-pro($|-)|deep-research|computer-use")
# Chatga yaramaydigan OpenAI modellari (embedding, ovoz, rasm, moderatsiya va h.k.)
_OPENAI_SKIP = re.compile(r"embedding|tts|whisper|transcribe|dall-e|gpt-image|image|davinci|babbage|moderation|realtime|audio|search|sora|instruct")
_OPENAI_VISION = re.compile(r"gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o1($|-)|o3|o4|codex")


def is_openai(base_url: str) -> bool:
    return "api.openai.com" in (base_url or "")


def uses_responses(base_url: str, model: str) -> bool:
    return is_openai(base_url) and bool(_RESPONSES_ONLY.search(model.lower()))


def _limit(base_url: str, n: int) -> dict:
    return {"max_completion_tokens": n} if is_openai(base_url) else {"max_tokens": n}


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
    if uses_responses(base_url, model):
        async for t in _stream_responses(base_url, api_key, model, messages, system, label):
            yield t
        return
    body = {
        "model": model,
        "stream": True,
        **_limit(base_url, MAX_OUTPUT_TOKENS),
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
            out.append(_as_chat_raw(m["raw"]))
        else:
            out += [{"role": "tool", "tool_call_id": r["id"], "content": r["output"]} for r in m["results"]]
    return out


async def step(base_url: str, api_key: str | None, model: str, system: str, messages: list[dict], tools: list[dict], label: str = "Model"):
    """Agent qadami (asbob chaqiruvi bilan). (raw, text, calls, truncated) qaytaradi."""
    if uses_responses(base_url, model):
        return await _step_responses(base_url, api_key, model, system, messages, tools, label)
    body = {
        "model": model,
        **_limit(base_url, 8192),
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
        if is_openai(base_url):
            if _OPENAI_SKIP.search(mid.lower()):
                continue
            out.append({"id": mid, "label": mid, "vision": bool(_OPENAI_VISION.search(mid.lower())), "tools": True, "free": False})
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
    if is_openai(base_url):
        out.sort(key=lambda x: x["id"])
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


# ---------------------------------------------------------------- OpenAI Responses API (Codex, -pro modellar)

def _as_chat_raw(raw: dict) -> dict:
    """Responses formatidagi javobni Chat Completions xabariga o'giradi (sessiyada modellar aralashsa)."""
    if "items" not in raw:
        return raw
    out = {"role": "assistant", "content": raw.get("content") or ""}
    calls = [
        {"id": it["call_id"], "type": "function", "function": {"name": it["name"], "arguments": it.get("arguments") or "{}"}}
        for it in raw["items"] if it.get("type") == "function_call"
    ]
    if calls:
        out["tool_calls"] = calls
    return out


def _as_response_items(raw: dict) -> list[dict]:
    """Chat Completions javobini Responses kirish elementlariga o'giradi."""
    if "items" in raw:
        return raw["items"]
    items = []
    if raw.get("content"):
        items.append({"role": "assistant", "content": raw["content"]})
    for tc in raw.get("tool_calls") or []:
        items.append({"type": "function_call", "call_id": tc["id"], "name": tc["function"]["name"], "arguments": tc["function"].get("arguments") or "{}"})
    return items


def _responses_input(messages: list[dict]) -> list[dict]:
    """Chat xabarlari -> Responses `input` (rasm bo'lsa input_image bilan)."""
    out = []
    for m in messages:
        if m["role"] == "user" and m.get("image"):
            out.append({"role": "user", "content": [
                {"type": "input_text", "text": m["content"]},
                {"type": "input_image", "image_url": f"data:image/png;base64,{m['image']}"},
            ]})
        else:
            out.append({"role": m["role"], "content": m["content"]})
    return out


def _resp_error(ev: dict, label: str) -> ProviderError:
    err = ev.get("error") or (ev.get("response") or {}).get("error") or {}
    msg = err.get("message", err) if isinstance(err, dict) else err
    return ProviderError(f"{label}: {str(msg or 'nomaʼlum xato')[:300]}")


async def _stream_responses(base_url, api_key, model, messages, system, label) -> AsyncIterator[str]:
    body = {"model": model, "stream": True, "store": False, "max_output_tokens": MAX_OUTPUT_TOKENS, "input": _responses_input(messages)}
    if system:
        body["instructions"] = system
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            async with client.stream("POST", f"{base_url.rstrip('/')}/responses", headers=_headers(api_key), json=body) as r:
                if r.status_code != 200:
                    raise friendly_http_error(r.status_code, (await r.aread()).decode(errors="ignore"))
                async for ev in iter_sse_data(r):
                    if not isinstance(ev, dict):
                        continue
                    kind = ev.get("type")
                    if kind == "response.output_text.delta" and ev.get("delta"):
                        yield ev["delta"]
                    elif kind in ("error", "response.failed"):
                        raise _resp_error(ev, label)
                    elif kind == "response.incomplete":
                        yield TRUNCATED_NOTE
    except httpx.TimeoutException:
        raise ProviderError(f"{label} javob bermadi (vaqt tugadi). Qayta urinib ko'ring.")
    except httpx.ConnectError:
        raise ProviderError(f"{label} serveriga ulanib bo'lmadi.")
    except httpx.HTTPError as exc:
        raise ProviderError(f"{label} bilan ulanishda xato: {exc.__class__.__name__}")


async def _step_responses(base_url, api_key, model, system, messages, tools, label):
    inp: list[dict] = []
    for m in messages:
        if m["role"] == "user":
            inp.append({"role": "user", "content": m["content"]})
        elif m["role"] == "assistant":
            inp += _as_response_items(m["raw"])
        else:
            inp += [{"type": "function_call_output", "call_id": r["id"], "output": r["output"]} for r in m["results"]]
    body = {
        "model": model,
        "instructions": system,
        "input": inp,
        "max_output_tokens": 16000,
        # store=False: fikrlash bloklari shifrlangan holda qaytadi va keyingi qadamda o'zgarishsiz yuboriladi
        "store": False,
        "include": ["reasoning.encrypted_content"],
        "tools": [{"type": "function", "name": t["name"], "description": t["description"], "parameters": t["schema"]} for t in tools],
    }
    try:
        async with httpx.AsyncClient(timeout=AGENT_TIMEOUT) as client:
            r = await client.post(f"{base_url.rstrip('/')}/responses", headers=_headers(api_key), json=body)
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
        raise _resp_error(data, label)
    items = [it for it in data.get("output") or [] if it.get("type") in ("message", "function_call", "reasoning")]
    # Kirishda faqat kerakli maydonlar qolsin (status va h.k. qaytarilganda xato bermasin)
    clean = []
    for it in items:
        if it["type"] == "message":
            clean.append({"role": "assistant", "content": "".join(c.get("text", "") for c in it.get("content") or [] if c.get("type") == "output_text")})
        elif it["type"] == "function_call":
            clean.append({"type": "function_call", "call_id": it["call_id"], "name": it["name"], "arguments": it.get("arguments") or "{}"})
        else:
            clean.append({k: v for k, v in it.items() if k in ("type", "id", "summary", "encrypted_content")})
    text = "".join(c["content"] for c in clean if c.get("role") == "assistant")
    calls = []
    for it in clean:
        if it.get("type") == "function_call":
            try:
                args = json.loads(it["arguments"])
            except json.JSONDecodeError:
                args = {"__invalid_json__": it["arguments"]}
            calls.append({"id": it["call_id"], "name": it["name"], "args": args})
    truncated = data.get("status") == "incomplete"
    return {"role": "assistant", "content": text, "items": clean}, text, calls, truncated
