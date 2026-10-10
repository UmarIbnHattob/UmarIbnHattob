"""OpenAI-mos API (Chat Completions) — Deepseek, OpenRouter, Groq, OpenAI, Mistral, xAI, Ollama, LM Studio va boshqalar.

Bitta kod yuzlab modelni qamraydi: farq faqat manzil (base_url), kalit va model nomida.
"""
import json
import re
from collections.abc import AsyncIterator

import httpx

from app.netguard import http_client
from app.providers.base import (
    FILTERED_NOTE,
    INTERRUPTED_NOTE,
    MAX_OUTPUT_TOKENS,
    TIMEOUT,
    TRUNCATED_NOTE,
    ProviderError,
    friendly_http_error,
    iter_sse_data,
    refusal_note,
)

AGENT_TIMEOUT = httpx.Timeout(connect=10, read=300, write=60, pool=10)
# O'rnatilgan Deepseek manzili o'zgarmas (foydalanuvchi bermaydi): ulanish paytidagi SSRF tekshiruvi kerak emas
DEEPSEEK_BASE = "https://api.deepseek.com"


def _client(base_url: str, timeout: httpx.Timeout) -> httpx.AsyncClient:
    """Foydalanuvchi bergan manzil uchun himoyalangan mijoz (netguard.http_client), o'rnatilgan Deepseek uchun oddiy."""
    return httpx.AsyncClient(timeout=timeout) if base_url == DEEPSEEK_BASE else http_client(timeout)


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
# Har qanday provayderda chatga yaramaydigan modellar: ovoz (Whisper, TTS), embedding, moderatsiya/guard, OCR,
# rerank, faqat rasm chiqaradiganlar (Groq, Mistral, Together, Ollama ro'yxatlarida ham bor)
_NONCHAT = re.compile(
    r"whisper|(?<![a-z])tts(?![a-z])|text-to-speech|speech|playai|orpheus|transcri|audio|embed|guard|moderation|"
    r"(?<![a-z])ocr(?![a-z])|rerank|dall-e|gpt-image|image-only|stable-diffusion|sdxl|flux|imagen"
)
# Together AI `type` maydoni: shu turlar chat emas
_NONCHAT_TYPES = {"image", "embedding", "moderation", "rerank", "audio", "transcribe", "tts", "stt", "video"}


def is_chat_model(model_id: str) -> bool:
    """Nomi bo'yicha chatga yaraydimi (Whisper, TTS, embedding, guard va h.k. emas)."""
    return not _NONCHAT.search(model_id.lower())


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
    refusal: list[str] = []
    try:
        async with _client(base_url, TIMEOUT) as client:
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
                    delta = choices[0].get("delta") or {}
                    if delta.get("content"):
                        yield delta["content"]
                    if delta.get("refusal"):
                        refusal.append(delta["refusal"])
                    finish = choices[0].get("finish_reason")
                    if finish == "length":
                        yield TRUNCATED_NOTE
                    elif finish == "content_filter":
                        yield FILTERED_NOTE
                if refusal:
                    yield refusal_note(label, "".join(refusal))
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
    """Agent qadami (asbob chaqiruvi bilan). (raw, text, calls, stop) qaytaradi.

    stop: None (oddiy tugadi), "length" (uzunlik chegarasi) yoki "content_filter" (filtr to'xtatdi).
    """
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
        async with _client(base_url, AGENT_TIMEOUT) as client:
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
    text = msg.get("content") or ""
    if msg.get("refusal"):
        text = (text + refusal_note(label, msg["refusal"])).lstrip()
    raw = {"role": "assistant", "content": text}
    # Noto'g'ri tuzilgan chaqiruvlar (id/nom yo'q) tashlab yuboriladi: keyingi qadamda xato bermasin
    tool_calls = [tc for tc in msg.get("tool_calls") or []
                  if isinstance(tc, dict) and tc.get("id") and isinstance(tc.get("function"), dict) and tc["function"].get("name")]
    if tool_calls:
        raw["tool_calls"] = tool_calls
    calls = []
    for tc in tool_calls:
        try:
            args = json.loads(tc["function"].get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {"__invalid_json__": tc["function"].get("arguments")}
        calls.append({"id": tc["id"], "name": tc["function"]["name"], "args": args})
    finish = choice.get("finish_reason")
    return raw, text, calls, finish if finish in ("length", "content_filter") else None


async def complete(base_url: str, api_key: str | None, model: str, system: str | None, prompt: str, label: str = "Model") -> str:
    """Oddiy (oqimsiz) javob — "ekspertga savol" uchun."""
    parts = [t async for t in stream_chat(base_url, api_key, model, [{"role": "user", "content": prompt}], system, label)]
    return "".join(parts)


# API o'rniga oddiy sayt manzili berilganda (masalan https://www.kimi.com/en): sayt yo'naltiradi yoki HTML qaytaradi
NOT_API = (
    "Bu manzil OpenAI-mos API emas (javob sayt sahifasidan keldi). Provayderning API manzilini kiriting — odatda "
    "/v1 bilan tugaydi, masalan https://api.example.com/v1. Kalitni ham provayderning API sahifasidan oling "
    "(sayt paroli emas)."
)


async def list_models(base_url: str, api_key: str | None) -> list[dict]:
    """GET /models — OpenAI formatidagi model ro'yxati. OpenRouter qo'shimcha maydonlarini ham o'qiydi."""
    try:
        async with _client(base_url, httpx.Timeout(20)) as client:
            r = await client.get(f"{base_url.rstrip('/')}/models", headers=_headers(api_key))
    except httpx.HTTPError as exc:
        raise ProviderError(f"Model ro'yxatini olib bo'lmadi: {exc.__class__.__name__}. Manzil va kalitni tekshiring.")
    if r.is_redirect:  # API yo'naltirmaydi; sayt esa bosh/kirish sahifasiga yo'naltiradi
        raise ProviderError(NOT_API)
    if r.status_code != 200:
        raise friendly_http_error(r.status_code, r.text)
    try:
        payload = r.json()
    except ValueError:  # 200, lekin JSON emas (HTML sahifa)
        raise ProviderError(NOT_API)
    if not isinstance(payload, dict):
        raise ProviderError(NOT_API)
    out = []
    for m in (payload.get("data") or [])[:800]:
        mid = m.get("id")
        if not mid or not isinstance(mid, str):
            continue
        low = mid.lower()
        if is_openai(base_url):
            if _OPENAI_SKIP.search(low):
                continue
            out.append({"id": mid, "label": mid, "vision": bool(_OPENAI_VISION.search(low)), "tools": True, "free": False})
            continue
        if not is_chat_model(mid) or str(m.get("type") or "").lower() in _NONCHAT_TYPES:
            continue  # Whisper, TTS, embedding, guard va h.k. chat/agent ro'yxatiga kirmaydi
        caps = m.get("capabilities") if isinstance(m.get("capabilities"), dict) else {}  # Mistral
        if caps.get("completion_chat") is False:
            continue
        arch = m.get("architecture") or {}
        out_mod = arch.get("output_modalities") or ["text"]
        if "text" not in out_mod:
            continue  # faqat rasm/audio chiqaradigan modellarni chatga qo'shmaymiz (OpenRouter)
        params = m.get("supported_parameters")
        if isinstance(params, list):
            tools = "tools" in params
        else:
            tools = caps.get("function_calling", True) is not False
        out.append({
            "id": mid,
            "label": m.get("name") or mid,
            "vision": "image" in (arch.get("input_modalities") or []) or bool(caps.get("vision"))
            or any(k in low for k in ("vision", "-vl", "llava")),
            "tools": tools,
            "free": mid.endswith(":free"),
        })
    if is_openai(base_url):
        out.sort(key=lambda x: x["id"])
    return out


async def transcribe(base_url: str, api_key: str | None, model: str, audio: bytes,
                     filename: str = "voice.wav", mime: str = "audio/wav") -> str:
    """Whisper (OpenAI/Groq) — ovozni matnga."""
    try:
        async with _client(base_url, httpx.Timeout(connect=10, read=90, write=60, pool=10)) as client:
            r = await client.post(
                f"{base_url.rstrip('/')}/audio/transcriptions",
                headers=_headers(api_key),
                data={"model": model},
                files={"file": (filename, audio, mime)},
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
    err = ev.get("error") or (ev.get("response") or {}).get("error")
    if not err and (ev.get("message") or ev.get("code")):
        # Spec bo'yicha "error" hodisasi: {"type": "error", "code": ..., "message": ..., "param": ...}
        err = {"message": ev.get("message"), "code": ev.get("code")}
    if isinstance(err, dict):
        msg, code = str(err.get("message") or ""), err.get("code")
        if code and str(code) not in msg:
            msg = f"{msg} ({code})" if msg else str(code)
    else:
        msg = str(err or "")
    return ProviderError(f"{label}: {(msg or 'nomaʼlum xato')[:300]}")


def _incomplete_note(response: dict) -> str:
    """response.incomplete: uzunlik chegarasi yoki kontent filtri (ikkalasi bir xil ko'rsatilmasin)."""
    reason = ((response or {}).get("incomplete_details") or {}).get("reason")
    return FILTERED_NOTE if reason == "content_filter" else TRUNCATED_NOTE


async def _stream_responses(base_url, api_key, model, messages, system, label) -> AsyncIterator[str]:
    body = {"model": model, "stream": True, "store": False, "max_output_tokens": MAX_OUTPUT_TOKENS, "input": _responses_input(messages)}
    if system:
        body["instructions"] = system
    try:
        async with _client(base_url, TIMEOUT) as client:
            async with client.stream("POST", f"{base_url.rstrip('/')}/responses", headers=_headers(api_key), json=body) as r:
                if r.status_code != 200:
                    raise friendly_http_error(r.status_code, (await r.aread()).decode(errors="ignore"))
                finished, sent, refusal = False, False, []
                async for ev in iter_sse_data(r):
                    if not isinstance(ev, dict):
                        continue
                    kind = ev.get("type")
                    if kind == "response.output_text.delta" and ev.get("delta"):
                        sent = True
                        yield ev["delta"]
                    elif kind == "response.refusal.delta" and ev.get("delta"):
                        refusal.append(ev["delta"])
                    elif kind == "response.refusal.done":
                        sent = True
                        yield refusal_note(label, ev.get("refusal") or "".join(refusal))
                        refusal = []
                    elif kind in ("error", "response.failed"):
                        raise _resp_error(ev, label)
                    elif kind == "response.incomplete":
                        finished = sent = True
                        yield _incomplete_note(ev.get("response") or {})
                    elif kind == "response.completed":
                        finished = True
                if refusal:
                    sent = True
                    yield refusal_note(label, "".join(refusal))
                if not finished:
                    # Oqim yakuniy hodisasiz uzildi: qisman javob to'liq deb ko'rsatilmasin
                    if not sent:
                        raise ProviderError(f"{label}: javob to'liq kelmadi (ulanish uzildi). Qayta urinib ko'ring.")
                    yield INTERRUPTED_NOTE
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
        async with _client(base_url, AGENT_TIMEOUT) as client:
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
    items = [it for it in data.get("output") or []
             if isinstance(it, dict) and it.get("type") in ("message", "function_call", "reasoning")]
    # Kirishda faqat kerakli maydonlar qolsin (status va h.k. qaytarilganda xato bermasin)
    clean = []
    for it in items:
        if it["type"] == "message":
            content = [c for c in it.get("content") or [] if isinstance(c, dict)]
            text = "".join(c.get("text") or "" for c in content if c.get("type") == "output_text")
            refused = "".join(c.get("refusal") or "" for c in content if c.get("type") == "refusal")
            if refused:  # rad etish matni foydalanuvchiga ko'rsatiladi (bo'sh javob o'rniga)
                text = (text + refusal_note(label, refused)).lstrip()
            clean.append({"role": "assistant", "content": text})
        elif it["type"] == "function_call":
            if not (isinstance(it.get("call_id"), str) and isinstance(it.get("name"), str)):
                continue  # noto'g'ri tuzilgan chaqiruv: keyingi qadamda KeyError bermasin
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
    stop = None
    if data.get("status") == "incomplete":
        reason = (data.get("incomplete_details") or {}).get("reason")
        stop = "content_filter" if reason == "content_filter" else "length"
    return {"role": "assistant", "content": text, "items": clean}, text, calls, stop
