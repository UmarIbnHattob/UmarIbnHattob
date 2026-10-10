import base64
import json

import httpx
import pytest

from app.agent import adapters
from app.agent.adapters import StepResult
from app.config import settings
from app.providers import gemini_image, openai_compat
from app.providers.router_auto import classify

MODELS_JSON = {"data": [
    {"id": "meta-llama/llama-3.3-70b-instruct:free", "name": "Llama 3.3 70B (free)", "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]}, "supported_parameters": ["tools"]},
    {"id": "qwen/qwen-2.5-coder-32b", "name": "Qwen Coder", "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]}, "supported_parameters": []},
    {"id": "openai/gpt-image", "architecture": {"output_modalities": ["image"]}},
]}


@pytest.fixture
def fake_net(monkeypatch):
    async def fake_get(self, url, **kw):
        return httpx.Response(200, json=MODELS_JSON, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    calls = []

    async def fake_stream(base_url, api_key, model, messages, system=None, label="Model"):
        calls.append({"base": base_url, "key": api_key, "model": model})
        yield "custom javob"
    monkeypatch.setattr(openai_compat, "stream_chat", fake_stream)
    return calls


def events(r):
    return [json.loads(x[5:]) for x in r.text.strip().split("\n\n") if x.startswith("data:")]


def test_ssrf_blocked(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_local_providers", False)
    for url in ["http://127.0.0.1:11434/v1", "http://169.254.169.254/latest", "http://localhost:5432", "file:///etc/passwd", "http://user:pw@example.com"]:
        r = client.post("/api/providers", json={"kind": "custom", "base_url": url})
        assert r.status_code == 400, url
    r = client.post("/api/providers", json={"kind": "ollama"})
    assert r.status_code == 400 and "ALLOW_LOCAL_PROVIDERS" in r.json()["detail"]


def test_add_openrouter_and_chat_with_custom_model(client, fake_net, monkeypatch):
    monkeypatch.setattr(settings, "allow_local_providers", True)  # test muhitida DNS bo'lmasligi mumkin
    assert client.post("/api/providers", json={"kind": "openrouter"}).status_code == 400  # kalit kerak
    p = client.post("/api/providers", json={"kind": "openrouter", "api_key": "sk-or-secret-1234"}).json()
    assert p["model_count"] == 2 and p["free_count"] == 1 and "api_key" not in p  # rasm-chiqaruvchi model qo'shilmadi
    models = client.get("/api/models").json()
    custom = [m for m in models if m["source"] == "custom"]
    assert {m["label"] for m in custom} == {"Llama 3.3 70B (free)", "Qwen Coder"}
    ref = next(m["id"] for m in custom if "llama" in m["id"])
    cid = client.post("/api/conversations").json()["id"]
    r = client.post(f"/api/conversations/{cid}/messages", json={"content": "salom", "model": ref})
    assert events(r)[-1]["type"] == "done"
    assert fake_net[-1] == {"base": "https://openrouter.ai/api/v1", "key": "sk-or-secret-1234", "model": "meta-llama/llama-3.3-70b-instruct:free"}
    # boshqa foydalanuvchi bu provayderni ishlata olmaydi
    from tests.conftest import make_client
    other = make_client("v@example.com")
    cid2 = other.post("/api/conversations").json()["id"]
    assert other.post(f"/api/conversations/{cid2}/messages", json={"content": "x", "model": ref}).status_code == 400
    assert client.delete(f"/api/providers/{p['id']}").status_code == 204
    assert not [m for m in client.get("/api/models").json() if m["source"] == "custom"]


def test_classify():
    assert classify("Menga python funksiya yozib ber") == "code"
    assert classify("kichik logo chizib ber") == "image"
    assert classify("rasmni chiz: tog'lar") == "image"
    assert classify("salom, qalaysan?") == "general"
    assert classify("nima bu?", has_image=True) == "vision"
    assert classify("Bu tenglamani isbotla va har bir qadamni batafsil tushuntir iltimos") == "reasoning"


def test_auto_routes_by_task(client, fake_llm, monkeypatch):
    url = f"/api/conversations/{client.post('/api/conversations').json()['id']}/messages"
    assert client.post(url, json={"content": "salom", "model": "auto"}).status_code == 400  # kalit yo'q
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    ev = events(client.post(url, json={"content": "python kod yozib ber", "model": "auto"}))
    assert ev[0]["type"] == "route" and ev[0]["model"] == "deepseek-chat" and ev[0]["reason"] == "kod"
    client.put("/api/keys/anthropic", json={"key": "key-anthropic-1234"})
    ev = events(client.post(url, json={"content": "react komponent yoz", "model": "auto"}))
    assert ev[0]["model"] == "claude-sonnet-5-5"
    # rasm: Gemini bo'lsa chat ichida rasm yaratiladi
    client.put("/api/keys/gemini", json={"key": "key-gemini-1234"})

    async def fake_img(api_key, model, prompt):
        return "image/png", b"\x89PNG\r\n\x1a\n" + b"0" * 20
    monkeypatch.setattr(gemini_image, "generate_image", fake_img)
    ev = events(client.post(url, json={"content": "kichik logo chizib ber", "model": "auto"}))
    assert ev[0]["reason"] == "rasm chizish" and "omni-media://" in ev[1]["text"]
    assert len(client.get("/api/media").json()) == 1  # Media Studio'ga ham saqlandi
    last = client.get(url).json()[-1]
    assert last["role"] == "assistant" and last["content"].startswith("![")


def test_agent_auto_and_expert(client, monkeypatch):
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    client.put("/api/keys/anthropic", json={"key": "key-anthropic-1234"})

    async def fake_step(api_key, model, system, messages):
        assert "update_plan" in json.dumps(adapters.TOOLS)
        return StepResult(raw=[{"type": "text", "text": "ok"}], text="ok", tool_calls=[])
    monkeypatch.setitem(adapters.STEPPERS, "anthropic", fake_step)
    r = client.post("/api/agent/step", json={"model": "auto", "messages": [{"role": "user", "content": "sayt yarat"}]})
    assert r.status_code == 200 and r.json()["model"]["id"] == "claude-sonnet-5-5"
    assert client.get("/api/agent/models").json()[0]["id"] == "auto"

    from app.providers.registry import STREAMERS
    from app.models import Provider

    async def fake_ds(api_key, model, messages, system=None):
        yield f"{model} maslahati"
    monkeypatch.setitem(STREAMERS, Provider.deepseek, fake_ds)
    r = client.post("/api/agent/expert", json={"question": "kodni tekshir", "expertise": "code", "exclude": "claude-sonnet-5-5"})
    assert r.status_code == 200 and r.json()["answer"] == "deepseek-chat maslahati"


def test_voice_whisper_fallback(client, fake_net, monkeypatch):
    monkeypatch.setattr(settings, "allow_local_providers", True)
    wav = base64.b64encode(b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 200).decode()
    r = client.post("/api/voice/transcribe", json={"audio": wav})
    assert r.status_code == 400 and "Groq" in r.json()["detail"]
    client.post("/api/providers", json={"kind": "groq", "api_key": "gsk-1234"})
    seen = {}

    async def fake_tr(base, key, model, data, filename="voice.wav", mime="audio/wav"):
        seen.update(base=base, model=model, size=len(data), filename=filename)
        return "salom dunyo"
    monkeypatch.setattr(openai_compat, "transcribe", fake_tr)
    r = client.post("/api/voice/transcribe", json={"audio": wav})
    assert r.json() == {"text": "salom dunyo"} and seen["model"] == "whisper-large-v3-turbo" and "groq" in seen["base"]


def test_ssrf_blocks_non_global_ranges(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_local_providers", False)
    for url in ["http://100.64.0.1/v1", "http://100.100.100.200/latest", "http://198.18.0.1", "http://[::ffff:10.0.0.1]",
                "http://[fd00::1]/v1", "http://192.0.0.170"]:
        r = client.post("/api/providers", json={"kind": "custom", "base_url": url})
        assert r.status_code == 400 and "ichki" in r.json()["detail"], url


def test_custom_url_rechecked_at_request_time(client, fake_net, monkeypatch):
    """DNS rebinding: qo'shilganda tashqi manzil, keyin ichki manzilga o'zgarsa so'rov yuborilmaydi."""
    import socket
    monkeypatch.setattr(settings, "allow_local_providers", False)
    ip = {"v": "93.184.216.34"}
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port, *a, **k: [(2, 1, 6, "", (ip["v"], port))])
    p = client.post("/api/providers", json={"kind": "custom", "base_url": "https://custom.example.com/v1"}).json()
    ref = f"cp:{p['id']}:qwen/qwen-2.5-coder-32b"
    url = f"/api/conversations/{client.post('/api/conversations').json()['id']}/messages"
    assert events(client.post(url, json={"content": "salom", "model": ref}))[-1]["type"] == "done"
    ip["v"] = "169.254.169.254"
    r = client.post(url, json={"content": "salom", "model": ref})
    assert r.status_code == 400 and "ichki" in r.json()["detail"]
    assert len(fake_net) == 1  # ikkinchi so'rov ichki manzilga yuborilmadi


@pytest.mark.anyio
async def test_non_chat_models_filtered_for_every_provider(monkeypatch):
    lists = {
        "https://api.groq.com/openai/v1": [
            {"id": "llama-3.3-70b-versatile"}, {"id": "whisper-large-v3-turbo"}, {"id": "whisper-large-v3"},
            {"id": "distil-whisper-large-v3-en"}, {"id": "playai-tts"}, {"id": "playai-tts-arabic"},
            {"id": "meta-llama/llama-guard-4-12b"}, {"id": "meta-llama/llama-prompt-guard-2-86m"}, {"id": "qwen-qwq-32b"},
        ],
        "https://api.mistral.ai/v1": [
            {"id": "mistral-large-latest", "capabilities": {"completion_chat": True, "function_calling": True, "vision": True}},
            {"id": "mistral-embed", "capabilities": {"completion_chat": False}},
            {"id": "mistral-moderation-latest"}, {"id": "mistral-ocr-latest"},
            {"id": "codestral-latest", "type": "base", "capabilities": {"completion_chat": True, "function_calling": False}},
        ],
        "https://api.together.xyz/v1": [
            {"id": "meta-llama/Llama-3.3-70B-Instruct-Turbo", "type": "chat"},
            {"id": "black-forest-labs/FLUX.1-schnell", "type": "image"},
            {"id": "BAAI/bge-large-en-v1.5", "type": "embedding"}, {"id": "Salesforce/Llama-Rank-V1", "type": "rerank"},
        ],
        "http://localhost:11434/v1": [{"id": "llama3.2:latest"}, {"id": "nomic-embed-text:latest"}],
        "https://openrouter.ai/api/v1": [
            {"id": "google/gemini-2.5-flash-image", "architecture": {"output_modalities": ["image", "text"]}},
            {"id": "x/image-only", "architecture": {"output_modalities": ["image"]}},
        ],
    }

    async def fake_get(self, url, **kw):
        base = url.rsplit("/models", 1)[0]
        return httpx.Response(200, json={"data": lists[base]}, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    got = {b: await openai_compat.list_models(b, "k") for b in lists}
    assert [m["id"] for m in got["https://api.groq.com/openai/v1"]] == ["llama-3.3-70b-versatile", "qwen-qwq-32b"]
    mistral = {m["id"]: m for m in got["https://api.mistral.ai/v1"]}
    assert list(mistral) == ["mistral-large-latest", "codestral-latest"]
    assert mistral["mistral-large-latest"]["vision"] and not mistral["codestral-latest"]["tools"]
    assert [m["id"] for m in got["https://api.together.xyz/v1"]] == ["meta-llama/Llama-3.3-70B-Instruct-Turbo"]
    assert [m["id"] for m in got["http://localhost:11434/v1"]] == ["llama3.2:latest"]
    assert [m["id"] for m in got["https://openrouter.ai/api/v1"]] == ["google/gemini-2.5-flash-image"]


def test_duplicate_provider_and_blank_name(client, fake_net, monkeypatch):
    monkeypatch.setattr(settings, "allow_local_providers", True)
    p = client.post("/api/providers", json={"kind": "openrouter", "api_key": "sk-or-1234", "name": "   "})
    assert p.status_code == 201 and p.json()["name"] == "OpenRouter"
    r = client.post("/api/providers", json={"kind": "openrouter", "api_key": "sk-or-other", "base_url": "https://OpenRouter.ai/api/v1/"})
    assert r.status_code == 409 and "allaqachon" in r.json()["detail"]
    # Boshqa foydalanuvchi o'zinikini qo'sha oladi
    from tests.conftest import make_client
    assert make_client("v@example.com").post("/api/providers", json={"kind": "openrouter", "api_key": "sk-or-1234"}).status_code == 201


@pytest.mark.anyio
async def test_provider_limit_is_race_safe(client, monkeypatch):
    """Bitta event loop'da (haqiqiy server kabi) parallel qo'shish: limit oshmaydi va qulf tufayli osilib qolmaydi."""
    import asyncio
    from app.main import app
    from app.routers import providers as providers_router
    monkeypatch.setattr(settings, "allow_local_providers", True)
    monkeypatch.setattr(providers_router, "MAX_PROVIDERS", 3)

    async def slow_get(self, url, **kw):
        await asyncio.sleep(0.3)  # tarmoq so'rovi: shu orada boshqalar ham birinchi tekshiruvdan o'tadi
        return httpx.Response(200, json=MODELS_JSON, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx.AsyncClient, "get", slow_get)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t", cookies=dict(client.cookies)) as ac:
        reqs = [ac.post("/api/providers", json={"kind": "custom", "base_url": f"https://custom.example.com/v{i}"}) for i in range(16)]
        codes = [r.status_code for r in await asyncio.wait_for(asyncio.gather(*reqs), 20)]
    assert codes.count(201) == 3 and set(codes) == {201, 400}
    assert len(client.get("/api/providers").json()) == 3


def test_patch_provider_key_and_name(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_local_providers", True)
    keys = []

    async def fake_get(self, url, **kw):
        auth = kw["headers"].get("Authorization", "")
        keys.append(auth)
        if "bad" in auth:
            return httpx.Response(401, json={"error": "x"}, request=httpx.Request("GET", url))
        return httpx.Response(200, json=MODELS_JSON, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    pid = client.post("/api/providers", json={"kind": "openrouter", "api_key": "sk-or-old-1234"}).json()["id"]
    r = client.patch(f"/api/providers/{pid}", json={"api_key": "sk-or-bad-1234"})
    assert r.status_code == 400  # yangi kalit tekshiruvdan o'tmadi: eski kalit saqlanib qoladi
    r = client.patch(f"/api/providers/{pid}", json={"api_key": "sk-or-new-1234", "name": "Mening OR"})
    assert r.status_code == 200 and r.json()["id"] == pid and r.json()["name"] == "Mening OR"
    assert keys[-1] == "Bearer sk-or-new-1234"
    assert client.patch(f"/api/providers/{pid}", json={"name": "  "}).json()["name"] == "OpenRouter"
    assert client.patch(f"/api/providers/{pid}", json={"api_key": ""}).status_code == 400  # OpenRouter'ga kalit shart
    client.post("/api/providers/" + pid + "/refresh")
    assert keys[-1] == "Bearer sk-or-new-1234"
    from tests.conftest import make_client
    assert make_client("v@example.com").patch(f"/api/providers/{pid}", json={"name": "x"}).status_code == 404


def test_delete_provider_clears_default_model(client, fake_net, monkeypatch):
    monkeypatch.setattr(settings, "allow_local_providers", True)
    pid = client.post("/api/providers", json={"kind": "openrouter", "api_key": "sk-or-1234"}).json()["id"]
    ref = f"cp:{pid}:qwen/qwen-2.5-coder-32b"
    assert client.patch("/api/me", json={"preferences": {"default_model": ref}}).status_code == 200
    client.delete(f"/api/providers/{pid}")
    assert client.get("/api/me").json()["preferences"]["default_model"] is None


def test_old_stored_non_chat_models_hidden_from_catalog(client, fake_net, monkeypatch):
    from sqlalchemy import text
    from app.database import engine
    monkeypatch.setattr(settings, "allow_local_providers", True)
    pid = client.post("/api/providers", json={"kind": "groq", "api_key": "gsk-1234"}).json()["id"]
    with engine.begin() as c:  # filtr qo'shilishidan oldin saqlangan ro'yxat
        c.execute(text("""UPDATE custom_providers SET models = '[{"id": "llama-3.3-70b-versatile"}, {"id": "whisper-large-v3-turbo"}]' WHERE id = :i"""), {"i": pid})
    ids = [m["id"] for m in client.get("/api/models").json() if m["source"] == "custom"]
    assert ids == [f"cp:{pid}:llama-3.3-70b-versatile"]
    assert not [m for m in client.get("/api/agent/models").json() if "whisper" in m["id"]]

