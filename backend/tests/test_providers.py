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

    async def fake_tr(base, key, model, data):
        seen.update(base=base, model=model, size=len(data))
        return "salom dunyo"
    monkeypatch.setattr(openai_compat, "transcribe", fake_tr)
    r = client.post("/api/voice/transcribe", json={"audio": wav})
    assert r.json() == {"text": "salom dunyo"} and seen["model"] == "whisper-large-v3-turbo" and "groq" in seen["base"]
