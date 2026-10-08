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
