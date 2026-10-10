"""Soxta AI provayderlar serveri (Anthropic, Gemini, Deepseek, OpenAI, OpenRouter, Groq, Ollama...).

Haqiqiy simli formatlarda javob beradi, shuning uchun backenddagi HAQIQIY provayder kodi ishlaydi.
Kalit qoidalari: kalitda "bad" bo'lsa 401, "rate" bo'lsa 429.
Matn qoidalari (oxirgi foydalanuvchi xabarida): "html" -> HTML kod bloki, "uzun" -> kesilgan javob,
"xato500" -> 500, "SYSTEMCHECK" -> system promptni qaytaradi.
Agent: tool natijalari soniga qarab: 0 -> list_dir, 1 -> write_file hello.txt, 2 -> yakuniy matn.
  Xabarda "rasm" bo'lsa 0-qadam generate_image; "ekspert" bo'lsa 0-qadam ask_expert; "reja" bo'lsa update_plan.
GET /_log -> oxirgi so'rovlar (tekshirish uchun), POST /_reset.
"""
import asyncio, base64, json, struct, zlib
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
LOG: list[dict] = []


def png(r=124, g=58, b=237, w=64, h=64):
    raw = b"".join(b"\x00" + bytes([r, g, b]) * w for _ in range(h))
    ch = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")


def key_error(key: str | None, kind: str):
    key = key or ""
    if "bad" in key:
        if kind == "anthropic":
            return JSONResponse({"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}}, 401)
        return JSONResponse({"error": {"message": "Incorrect API key provided", "type": "invalid_request_error", "code": 401}}, 401)
    if "rate" in key:
        if kind == "anthropic":
            return JSONResponse({"type": "error", "error": {"type": "rate_limit_error", "message": "rate limited"}}, 429)
        return JSONResponse({"error": {"message": "Rate limit reached", "code": 429}}, 429)
    return None


def reply_text(tag: str, model: str, user: str, system: str | None) -> tuple[str, str]:
    """(matn, holat) — holat: stop | length | error."""
    if "xato500" in user:
        return "", "error"
    if "SYSTEMCHECK" in user:
        return f"[{tag}:{model}] SYSTEM=<<{(system or '')[:1500]}>>", "stop"
    if "html" in user.lower():
        body = "<!DOCTYPE html>\n<html><body>\n<h1 id='t'>Salom OmniAI</h1>\n<button id='b' onclick=\"document.getElementById('t').textContent='Bosildi'\">Bos</button>\n</body></html>"
        return f"[{tag}:{model}] Mana sahifa:\n\n```html\n{body}\n```\n\nTayyor.", "stop"
    if "uzun" in user:
        return f"[{tag}:{model}] Bu javob uzun bo'lib kesildi", "length"
    return f"[{tag}:{model}] Javob: {user[:80]}", "stop"


def chunks(text: str, n=12):
    return [text[i:i + n] for i in range(0, len(text), n)] or [""]


def last_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") in ("text", "input_text"))
    return ""


def agent_plan(user: str, n_results: int):
    """(matn, [ (nom, args) ]) — umumiy agent ssenariysi."""
    if n_results == 0:
        if "rasm" in user:
            return "Rasm yarataman.", [("generate_image", {"prompt": "kofe logotipi", "path": "assets/logo.png"})]
        if "ekspert" in user:
            return "Ekspertdan so'rayman.", [("ask_expert", {"question": "Bu kod to'g'rimi?"})]
        if "reja" in user:
            return "Reja tuzaman.", [("update_plan", {"steps": [{"title": "Papkani ko'rish", "status": "in_progress"}, {"title": "Fayl yozish", "status": "pending"}]})]
        return "Avval papkani ko'rib chiqaman.", [("list_dir", {"path": "."})]
    if n_results == 1:
        return "Fayl yozaman.", [("write_file", {"path": "hello.txt", "content": "Salom OmniAI\n"})]
    return "**Tayyor.** hello.txt yozildi.", []


def log(entry):
    LOG.append(entry)
    del LOG[:-300]


@app.get("/_log")
async def get_log(n: int = 30):
    return LOG[-n:]


@app.post("/_reset")
async def reset():
    LOG.clear()
    return {"ok": True}


# ------------------------------------------------------------------ Anthropic
@app.post("/anthropic/v1/messages")
async def anthropic_messages(req: Request):
    body = await req.json()
    key = req.headers.get("x-api-key")
    sys = body.get("system")
    if isinstance(sys, list):
        sys = " ".join(b.get("text", "") for b in sys)
    msgs = body.get("messages", [])
    n_results = sum(1 for m in msgs if isinstance(m.get("content"), list) for b in m["content"] if b.get("type") == "tool_result")
    user_msgs = [m for m in msgs if m["role"] == "user" and last_text(m["content"]).strip()]
    user = last_text(user_msgs[-1]["content"]) if user_msgs else ""
    log({"provider": "anthropic", "model": body.get("model"), "key": key, "stream": body.get("stream", False), "tools": bool(body.get("tools")),
         "system": (sys or "")[:2000], "user": user[:300], "n_messages": len(msgs), "max_tokens": body.get("max_tokens"),
         "betas": req.headers.get("anthropic-beta"), "has_image": any(isinstance(m.get("content"), list) and any(b.get("type") == "image" for b in m["content"]) for m in msgs)})
    if (err := key_error(key, "anthropic")):
        return err
    model = body.get("model")
    if body.get("tools"):
        text, calls = agent_plan(user, n_results)
        content = [{"type": "text", "text": text}] + [
            {"type": "tool_use", "id": f"toolu_{n_results}_{i}", "name": n, "input": a} for i, (n, a) in enumerate(calls)]
        return {"id": "msg_a", "type": "message", "role": "assistant", "model": model, "content": content,
                "stop_reason": "tool_use" if calls else "end_turn", "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 10}}
    text, state = reply_text("claude", model, user, sys)
    if state == "error":
        return JSONResponse({"type": "error", "error": {"type": "api_error", "message": "Internal server error"}}, 500)
    if "refuse" in user:
        text, state = "", "refusal"
    stop = {"stop": "end_turn", "length": "max_tokens", "refusal": "refusal"}[state]
    if not body.get("stream"):
        return {"id": "msg_b", "type": "message", "role": "assistant", "model": model, "content": [{"type": "text", "text": text}],
                "stop_reason": stop, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 10}}

    async def gen():
        def ev(name, data):
            return f"event: {name}\ndata: {json.dumps(data)}\n\n"
        yield ev("message_start", {"type": "message_start", "message": {"id": "msg_s", "type": "message", "role": "assistant", "model": model, "content": [],
                                                                       "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1}}})
        yield ev("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
        for c in chunks(text):
            await asyncio.sleep(0.03)
            yield ev("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": c}})
        yield ev("content_block_stop", {"type": "content_block_stop", "index": 0})
        yield ev("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": {"output_tokens": 10}})
        yield ev("message_stop", {"type": "message_stop"})
    return StreamingResponse(gen(), media_type="text/event-stream")


# ------------------------------------------------------------------ Gemini
@app.post("/gemini/v1beta/models/{spec}")
async def gemini(spec: str, req: Request):
    model, _, method = spec.partition(":")
    body = await req.json()
    key = req.headers.get("x-goog-api-key")
    contents = body.get("contents", [])
    sys = " ".join(p.get("text", "") for p in (body.get("systemInstruction") or {}).get("parts", []))
    users = [c for c in contents if c.get("role", "user") == "user" and any(p.get("text") for p in c.get("parts", []))]
    user = " ".join(p.get("text", "") for p in users[-1]["parts"]) if users else ""
    audio = any("inlineData" in p and p["inlineData"].get("mimeType", "").startswith("audio") for c in contents for p in c.get("parts", []))
    n_results = sum(1 for c in contents for p in c.get("parts", []) if "functionResponse" in p)
    log({"provider": "gemini", "model": model, "method": method, "key": key, "tools": bool(body.get("tools")), "audio": audio,
         "system": sys[:2000], "user": user[:300], "n_contents": len(contents),
         "has_image": any("inlineData" in p and p["inlineData"].get("mimeType", "").startswith("image") for c in contents for p in c.get("parts", []))})
    if (err := key_error(key, "gemini")):
        return err
    if audio:
        return {"candidates": [{"content": {"role": "model", "parts": [{"text": "Salom bu ovozli xabar"}]}, "finishReason": "STOP"}]}
    if "image" in model:
        if "rad" in user:
            return {"candidates": [{"content": {"role": "model", "parts": [{"text": "Bu rasmni yarata olmayman."}]}, "finishReason": "STOP"}]}
        await asyncio.sleep(0.3)
        return {"candidates": [{"content": {"role": "model", "parts": [{"text": "Mana rasm"}, {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(png()).decode()}}]}, "finishReason": "STOP"}]}
    if body.get("tools"):
        text, calls = agent_plan(user, n_results)
        parts = [{"text": text}] + [{"functionCall": {"name": n, "args": a}, "thoughtSignature": f"sig{n_results}{i}"} for i, (n, a) in enumerate(calls)]
        return {"candidates": [{"content": {"role": "model", "parts": parts}, "finishReason": "STOP"}]}
    text, state = reply_text("gemini", model, user, sys)
    if state == "error":
        return JSONResponse({"error": {"code": 500, "message": "Internal error", "status": "INTERNAL"}}, 500)
    fin = "MAX_TOKENS" if state == "length" else "STOP"
    if method == "generateContent":
        return {"candidates": [{"content": {"role": "model", "parts": [{"text": text}]}, "finishReason": fin}]}

    async def gen():
        parts = chunks(text)
        for i, c in enumerate(parts):
            await asyncio.sleep(0.03)
            cand = {"content": {"role": "model", "parts": [{"text": c}]}}
            if i == len(parts) - 1:
                cand["finishReason"] = fin
            yield f"data: {json.dumps({'candidates': [cand]})}\r\n\r\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


# ------------------------------------------------------------------ OpenAI-mos (deepseek, openai, openrouter, groq, ...)
MODELS = {
    "openai": [{"id": i, "object": "model"} for i in ["gpt-5", "gpt-5-codex", "gpt-4.1-mini", "o3", "text-embedding-3-small", "whisper-1", "dall-e-3", "tts-1", "gpt-image-1"]],
    "openrouter": [
        {"id": "meta-llama/llama-3.3-70b-instruct:free", "name": "Llama 3.3 70B (free)", "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]}, "supported_parameters": ["tools"]},
        {"id": "qwen/qwen-2.5-coder-32b-instruct", "name": "Qwen 2.5 Coder 32B", "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]}, "supported_parameters": ["tools"]},
        {"id": "google/gemma-3-27b-it:free", "name": "Gemma 3 27B (free)", "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]}, "supported_parameters": []},
        {"id": "openai/gpt-image", "name": "GPT Image", "architecture": {"output_modalities": ["image"]}},
    ],
    "groq": [{"id": i, "object": "model"} for i in ["llama-3.3-70b-versatile", "whisper-large-v3-turbo", "qwen-qwq-32b"]],
    "mistral": [{"id": i} for i in ["mistral-large-latest", "codestral-latest"]],
    "xai": [{"id": i} for i in ["grok-4", "grok-code-fast"]],
    "together": [{"id": i} for i in ["meta-llama/Llama-3.3-70B-Instruct-Turbo"]],
    "ollama": [{"id": i} for i in ["llama3.2:latest", "qwen2.5-coder:7b"]],
    "lmstudio": [{"id": i} for i in ["local-model"]],
    "deepseek": [{"id": i} for i in ["deepseek-chat", "deepseek-reasoner"]],
    "custom": [{"id": i} for i in ["custom-model-1"]],
}


def bearer(req: Request):
    a = req.headers.get("authorization") or ""
    return a[7:] if a.lower().startswith("bearer ") else None


@app.get("/oai/{vendor}/models")
async def oai_models(vendor: str, req: Request):
    log({"provider": vendor, "endpoint": "models", "key": bearer(req)})
    if (err := key_error(bearer(req), vendor)):
        return err
    return {"object": "list", "data": MODELS.get(vendor, MODELS["custom"])}


@app.post("/oai/{vendor}/chat/completions")
async def oai_chat(vendor: str, req: Request):
    body = await req.json()
    key = bearer(req)
    msgs = body.get("messages", [])
    sys = " ".join(last_text(m["content"]) for m in msgs if m["role"] == "system")
    users = [m for m in msgs if m["role"] == "user"]
    user = last_text(users[-1]["content"]) if users else ""
    n_results = sum(1 for m in msgs if m["role"] == "tool")
    log({"provider": vendor, "endpoint": "chat", "model": body.get("model"), "key": key, "stream": body.get("stream", False), "tools": bool(body.get("tools")),
         "system": sys[:2000], "user": user[:300], "n_messages": len(msgs),
         "max_tokens": body.get("max_tokens"), "max_completion_tokens": body.get("max_completion_tokens"),
         "has_image": any(isinstance(m.get("content"), list) and any(b.get("type") == "image_url" for b in m["content"]) for m in msgs)})
    if (err := key_error(key, vendor)):
        return err
    model = body.get("model")
    if vendor == "openai" and "max_tokens" in body and model.startswith(("gpt-5", "o1", "o3", "o4")):
        return JSONResponse({"error": {"message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", "type": "invalid_request_error"}}, 400)
    if vendor == "openai" and ("codex" in model or model.endswith("-pro")):
        return JSONResponse({"error": {"message": "This model is only supported in v1/responses and not in v1/chat/completions.", "type": "invalid_request_error"}}, 404)
    if body.get("tools"):
        text, calls = agent_plan(user, n_results)
        msg = {"role": "assistant", "content": text}
        if calls:
            msg["tool_calls"] = [{"id": f"call_{n_results}_{i}", "type": "function", "function": {"name": n, "arguments": json.dumps(a)}} for i, (n, a) in enumerate(calls)]
        return {"id": "c1", "object": "chat.completion", "model": model, "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if calls else "stop"}]}
    text, state = reply_text(vendor, model, user, sys)
    if state == "error":
        return JSONResponse({"error": {"message": "Internal server error"}}, 500)
    fin = "length" if state == "length" else "stop"
    if not body.get("stream"):
        return {"id": "c2", "object": "chat.completion", "model": model, "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": fin}]}

    async def gen():
        parts = chunks(text)
        for i, c in enumerate(parts):
            await asyncio.sleep(0.03)
            yield f"data: {json.dumps({'choices': [{'index': 0, 'delta': {'content': c}, 'finish_reason': fin if i == len(parts) - 1 else None}]})}\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/oai/{vendor}/responses")
async def oai_responses(vendor: str, req: Request):
    body = await req.json()
    key = bearer(req)
    inp = body.get("input", [])
    if isinstance(inp, str):
        inp = [{"role": "user", "content": inp}]
    users = [i for i in inp if i.get("role") == "user"]
    user = last_text(users[-1]["content"]) if users else ""
    n_results = sum(1 for i in inp if i.get("type") == "function_call_output")
    log({"provider": vendor, "endpoint": "responses", "model": body.get("model"), "key": key, "stream": body.get("stream", False), "tools": bool(body.get("tools")),
         "system": (body.get("instructions") or "")[:2000], "user": user[:300], "n_input": len(inp), "store": body.get("store"),
         "has_reasoning_input": any(i.get("type") == "reasoning" for i in inp)})
    if (err := key_error(key, vendor)):
        return err
    model = body.get("model")
    if body.get("tools"):
        text, calls = agent_plan(user, n_results)
        out = [{"type": "reasoning", "id": f"rs_{n_results}", "summary": [], "encrypted_content": "ENC", "status": "completed"},
               {"type": "message", "id": "m1", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": text, "annotations": []}]}]
        out += [{"type": "function_call", "id": f"fc_{i}", "call_id": f"call_r{n_results}_{i}", "name": n, "arguments": json.dumps(a), "status": "completed"} for i, (n, a) in enumerate(calls)]
        return {"id": "resp_1", "object": "response", "status": "completed", "model": model, "output": out}
    text, state = reply_text(vendor + "-responses", model, user, body.get("instructions"))
    if state == "error":
        return JSONResponse({"error": {"message": "Internal server error"}}, 500)

    async def gen():
        yield f"data: {json.dumps({'type': 'response.created', 'response': {'id': 'resp_s'}})}\n\n"
        for c in chunks(text):
            await asyncio.sleep(0.03)
            yield f"data: {json.dumps({'type': 'response.output_text.delta', 'delta': c})}\n\n"
        end = "response.incomplete" if state == "length" else "response.completed"
        yield f"data: {json.dumps({'type': end, 'response': {'id': 'resp_s'}})}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/oai/{vendor}/audio/transcriptions")
async def oai_transcribe(vendor: str, req: Request):
    form = await req.form()
    log({"provider": vendor, "endpoint": "transcriptions", "model": form.get("model"), "key": bearer(req)})
    if (err := key_error(bearer(req), vendor)):
        return err
    return {"text": f"Whisper ({vendor}) matni"}
