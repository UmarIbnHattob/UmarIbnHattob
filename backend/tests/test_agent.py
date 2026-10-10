import httpx
import pytest
from anthropic.types import Message, TextBlock, ToolUseBlock, Usage

from app.agent import adapters
from app.agent.adapters import StepResult, _anthropic_messages, _gemini_contents, _openai_messages

HISTORY = [
    {"role": "user", "content": "README ni o'qi"},
    {"role": "assistant", "provider": "x", "raw": "RAW"},
    {"role": "tool_results", "results": [
        {"id": "t1", "name": "read_file", "output": "# Salom", "is_error": False},
        {"id": "t2", "name": "list_dir", "output": "xato", "is_error": True},
    ]},
]


def test_message_conversion_per_provider():
    a = _anthropic_messages(HISTORY)
    assert a[1] == {"role": "assistant", "content": "RAW"}
    assert [b["tool_use_id"] for b in a[2]["content"]] == ["t1", "t2"] and a[2]["content"][1]["is_error"] is True
    assert len(a) == 3  # parallel natijalar bitta user xabarida
    merged = _anthropic_messages(HISTORY + [{"role": "user", "content": "davom et"}])
    assert len(merged) == 3 and merged[2]["content"][-1] == {"type": "text", "text": "davom et"}

    o = _openai_messages("SYS", HISTORY)
    assert o[0] == {"role": "system", "content": "SYS"} and o[2] == "RAW"
    assert [(m["role"], m["tool_call_id"]) for m in o[3:]] == [("tool", "t1"), ("tool", "t2")]

    g = _gemini_contents(HISTORY)
    assert g[1] == "RAW"
    fr = g[2]["parts"][0]["functionResponse"]
    assert fr["name"] == "read_file" and fr["response"]["output"] == "# Salom"


@pytest.mark.anyio
async def test_step_anthropic_parses_tool_use(monkeypatch):
    msg = Message(
        id="msg_1", type="message", role="assistant", model="claude-sonnet-5-5",
        content=[TextBlock(type="text", text="Ko'raman."), ToolUseBlock(type="tool_use", id="tu_1", name="read_file", input={"path": "README.md"})],
        stop_reason="tool_use", stop_sequence=None, usage=Usage(input_tokens=1, output_tokens=1),
    )
    sent = {}

    class FakeMessages:
        async def create(self, **kw):
            sent.update(kw)
            return msg

    class FakeClient:
        messages = FakeMessages()

    monkeypatch.setattr(adapters, "client_for", lambda key: FakeClient())
    res = await adapters.step_anthropic("k", "claude-sonnet-5-5", "SYS", [{"role": "user", "content": "salom"}])
    assert res.text == "Ko'raman."
    assert res.tool_calls == [{"id": "tu_1", "name": "read_file", "args": {"path": "README.md"}}]
    assert res.raw[1]["type"] == "tool_use" and res.raw[1]["id"] == "tu_1"
    assert {t["name"] for t in sent["tools"]} >= {"read_file", "write_file", "run_command"}
    assert "tool_choice" not in sent  # majburiy tool_choice yangi modellarda 400 beradi


@pytest.mark.anyio
async def test_step_deepseek_and_gemini(monkeypatch):
    responses = {
        "deepseek": {"choices": [{"finish_reason": "tool_calls", "message": {"content": "", "tool_calls": [
            {"id": "c1", "type": "function", "function": {"name": "list_dir", "arguments": "{\"path\": \".\"}"}}]}}]},
        "gemini": {"candidates": [{"finishReason": "STOP", "content": {"role": "model", "parts": [
            {"text": "Qidiraman", "thoughtSignature": "SIG"}, {"functionCall": {"name": "search_files", "args": {"query": "TODO"}}}]}}]},
    }

    async def fake_post(self, url, **kw):
        key = "deepseek" if "deepseek" in url else "gemini"
        return httpx.Response(200, json=responses[key], request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    d = await adapters.step_deepseek("k", "deepseek-chat", "S", [{"role": "user", "content": "x"}])
    assert d.tool_calls == [{"id": "c1", "name": "list_dir", "args": {"path": "."}}] and d.raw["tool_calls"]
    g = await adapters.step_gemini("k", "gemini-2.5-pro", "S", [{"role": "user", "content": "x"}])
    assert g.tool_calls == [{"id": "g1", "name": "search_files", "args": {"query": "TODO"}}]
    assert g.raw["parts"][0]["thoughtSignature"] == "SIG"  # imzo o'zgarishsiz saqlanadi


def test_agent_endpoint(client, monkeypatch):
    client.put("/api/keys/anthropic", json={"key": "key-anthropic-1234"})

    async def fake(api_key, model, system, messages):
        assert "my-app" in system and api_key == "key-anthropic-1234"
        return StepResult(raw=[{"type": "text", "text": "ok"}], text="ok", tool_calls=[])

    monkeypatch.setitem(adapters.STEPPERS, "anthropic", fake)
    body = {"model": "claude-sonnet-5-5", "folder": "my-app", "messages": [{"role": "user", "content": "salom"}]}
    r = client.post("/api/agent/step", json=body)
    assert r.status_code == 200 and r.json()["assistant"]["provider"] == "anthropic"
    # Provayder almashtirish rad etiladi
    body["messages"] += [r.json()["assistant"], {"role": "user", "content": "davom"}]
    body["model"] = "deepseek-chat"
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    assert client.post("/api/agent/step", json=body).status_code == 400
    # Tool-calling'siz model rad etiladi
    assert client.post("/api/agent/step", json={"model": "deepseek-reasoner", "messages": [{"role": "user", "content": "x"}]}).status_code == 400


def _platform_gemini(monkeypatch, limit=5):
    from app.config import settings
    monkeypatch.setattr(settings, "platform_gemini_key", "platform-gemini")
    monkeypatch.setattr(settings, "free_monthly_requests", limit)


def test_agent_validation_before_quota_and_malformed_history(client, monkeypatch):
    _platform_gemini(monkeypatch)
    client.put("/api/keys/anthropic", json={"key": "key-anthropic-1234"})
    claude_turn = {"role": "assistant", "provider": "anthropic", "raw": [{"type": "text", "text": "ok"}]}
    bad_bodies = [
        # Claude sessiyasini Gemini bilan davom ettirish (oila almashuvi)
        {"model": "gemini-2.5-flash", "messages": [{"role": "user", "content": "x"}, claude_turn, {"role": "user", "content": "y"}]},
        # raw yo'q / noto'g'ri shakl
        {"model": "gemini-2.5-flash", "messages": [{"role": "user", "content": "x"}, {"role": "assistant", "provider": "gemini"}]},
        {"model": "gemini-2.5-flash", "messages": [{"role": "user", "content": "x"}, {"role": "assistant", "provider": "gemini", "raw": "RAW"}]},
        # tool_results: bo'sh, id/output yo'q, Gemini uchun name yo'q
        {"model": "gemini-2.5-flash", "messages": [{"role": "tool_results", "results": []}]},
        {"model": "gemini-2.5-flash", "messages": [{"role": "tool_results", "results": [{"name": "read_file"}]}]},
        {"model": "gemini-2.5-flash", "messages": [{"role": "tool_results", "results": [{"id": "g0", "output": "ok"}]}]},
        {"model": "claude-sonnet-5-5", "messages": [{"role": "tool_results", "results": [{"id": "t1", "output": {"x": 1}}]}]},
        # user matn emas
        {"model": "gemini-2.5-flash", "messages": [{"role": "user"}]},
        # tool calling'siz o'rnatilgan model
        {"model": "deepseek-reasoner", "messages": [{"role": "user", "content": "x"}]},
    ]
    for body in bad_bodies:
        r = client.post("/api/agent/step", json=body)
        assert r.status_code == 400, (body, r.text)
    assert client.get("/api/usage").json()["used"] == 0  # rad etilgan so'rovlar limitni yemadi


def test_openai_family_malformed_raw_is_400(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "platform_deepseek_key", "platform-deepseek")
    base = {"model": "deepseek-chat"}
    raws = [
        None,
        {"role": "assistant", "content": "", "tool_calls": [{"type": "function", "function": {"name": "x"}}]},  # id yo'q
        {"role": "assistant", "content": "", "items": [{"type": "function_call", "name": "write_file"}]},  # call_id yo'q
        ["not", "a", "dict"],
    ]
    for raw in raws:
        msgs = [{"role": "user", "content": "x"}, {"role": "assistant", "provider": "deepseek", "raw": raw}]
        assert client.post("/api/agent/step", json={**base, "messages": msgs}).status_code == 400, raw


def test_agent_failure_refunds_and_success_records(client, monkeypatch):
    from app.providers.base import ProviderError
    _platform_gemini(monkeypatch)

    async def fail(api_key, model, system, messages):
        raise ProviderError("Gemini serverida xato (500).")
    monkeypatch.setitem(adapters.STEPPERS, "gemini", fail)
    body = {"model": "gemini-2.5-flash", "messages": [{"role": "user", "content": "salom"}]}
    r = client.post("/api/agent/step", json=body)
    assert r.status_code == 502 and client.get("/api/usage").json()["used"] == 0
    assert client.get("/api/usage/stats").json()["by_kind"] == {}

    async def ok(api_key, model, system, messages):
        return StepResult(raw={"role": "model", "parts": [{"text": "ok"}]}, text="ok", tool_calls=[])
    monkeypatch.setitem(adapters.STEPPERS, "gemini", ok)
    assert client.post("/api/agent/step", json=body).status_code == 200
    assert client.get("/api/usage").json()["used"] == 1
    assert client.get("/api/usage/stats").json()["by_kind"] == {"agent": 1}


def test_agent_image_failure_refunds(client, monkeypatch):
    from app.providers import gemini_image
    from app.providers.base import EmptyReply, ProviderError
    _platform_gemini(monkeypatch)

    async def fail(api_key, model, prompt):
        raise ProviderError("Gemini serverida xato (500).")
    monkeypatch.setattr(gemini_image, "generate_image", fail)
    assert client.post("/api/agent/image", json={"prompt": "logo"}).status_code == 502
    assert client.get("/api/usage").json()["used"] == 0

    async def refused(api_key, model, prompt):  # 200, lekin rasm yo'q: so'rov hisoblangan
        raise EmptyReply("Model rasm qaytarmadi.")
    monkeypatch.setattr(gemini_image, "generate_image", refused)
    assert client.post("/api/agent/image", json={"prompt": "logo"}).status_code == 502
    assert client.get("/api/usage").json()["used"] == 1


def test_agent_expert_empty_answer_keeps_quota(client, monkeypatch):
    from app.models import Provider
    from app.providers.base import ProviderError
    from app.providers.registry import STREAMERS
    _platform_gemini(monkeypatch)

    async def fail(api_key, model, messages, system=None):
        raise ProviderError("Gemini serverida xato (500).")
        yield  # pragma: no cover
    monkeypatch.setitem(STREAMERS, Provider.gemini, fail)
    body = {"question": "kodni tekshir", "expertise": "code"}
    assert client.post("/api/agent/expert", json=body).status_code == 502
    assert client.get("/api/usage").json()["used"] == 0

    async def empty(api_key, model, messages, system=None):
        yield "  "
    monkeypatch.setitem(STREAMERS, Provider.gemini, empty)
    r = client.post("/api/agent/expert", json=body)
    assert r.status_code == 502 and "bo'sh" in r.json()["detail"]
    assert client.get("/api/usage").json()["used"] == 1  # provayder javob berdi: limit qaytarilmaydi


def test_custom_model_without_tools_rejected_and_auto_falls_back_to_tools_model(client, monkeypatch):
    from app.config import settings
    from app.providers import openai_compat
    monkeypatch.setattr(settings, "allow_local_providers", True)
    data = {"data": [
        {"id": "google/gemma-3-27b-it:free", "architecture": {"output_modalities": ["text"]}, "supported_parameters": []},
        {"id": "qwen/qwen-2.5-coder-32b", "architecture": {"output_modalities": ["text"]}, "supported_parameters": ["tools"]},
    ]}

    async def fake_get(self, url, **kw):
        return httpx.Response(200, json=data, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    pid = client.post("/api/providers", json={"kind": "openrouter", "api_key": "sk-or-1234"}).json()["id"]
    seen = {}

    async def fake_step(base_url, api_key, model, system, messages, tools, label="Model"):
        seen["model"] = model
        return {"role": "assistant", "content": "ok"}, "ok", [], None
    monkeypatch.setattr(openai_compat, "step", fake_step)
    r = client.post("/api/agent/step", json={"model": f"cp:{pid}:google/gemma-3-27b-it:free", "messages": [{"role": "user", "content": "x"}]})
    assert r.status_code == 400 and "asbob" in r.json()["detail"] and "model" not in seen
    # Auto: o'rnatilgan model uchun kalit yo'q -> asbob chaqira oladigan custom model
    r = client.post("/api/agent/step", json={"model": "auto", "messages": [{"role": "user", "content": "sayt yarat"}]})
    assert r.status_code == 200 and seen["model"] == "qwen/qwen-2.5-coder-32b"
