"""OpenAI: model filtri, max_completion_tokens va Codex uchun Responses API (tarmoqsiz, httpx mock)."""
import json

import httpx
import pytest

from app.providers import openai_compat as oc

OAI = "https://api.openai.com/v1"


def _transport(handler):
    real = httpx.AsyncClient.__init__

    def init(self, *a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        real(self, *a, **kw)
    return init


@pytest.fixture
def mock_http(monkeypatch):
    seen = []

    def use(handler):
        def wrapped(req):
            seen.append(req)
            return handler(req)
        monkeypatch.setattr(httpx.AsyncClient, "__init__", _transport(wrapped))
        return seen
    return use


def test_routing_rules():
    assert oc.uses_responses(OAI, "gpt-5-codex") and oc.uses_responses(OAI, "gpt-5-pro")
    assert not oc.uses_responses(OAI, "gpt-5") and not oc.uses_responses(OAI, "gpt-4.1-mini")
    assert not oc.uses_responses("https://openrouter.ai/api/v1", "openai/gpt-5-codex")  # OpenRouter o'zi moslaydi


@pytest.mark.anyio
async def test_openai_model_filter(mock_http):
    data = {"data": [{"id": i} for i in ["gpt-5", "gpt-5-codex", "text-embedding-3-small", "whisper-1", "tts-1", "dall-e-3", "gpt-image-1", "o3", "omni-moderation-latest", "gpt-4o-realtime-preview"]]}
    mock_http(lambda req: httpx.Response(200, json=data))
    ids = [m["id"] for m in await oc.list_models(OAI, "sk")]
    assert ids == ["gpt-5", "gpt-5-codex", "o3"]


@pytest.mark.anyio
async def test_chat_completions_uses_max_completion_tokens(mock_http):
    sse = 'data: {"choices":[{"delta":{"content":"salom"}}]}\n\ndata: [DONE]\n\n'
    seen = mock_http(lambda req: httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"}))
    out = [t async for t in oc.stream_chat(OAI, "sk", "gpt-5", [{"role": "user", "content": "hi"}])]
    body = json.loads(seen[0].content)
    assert out == ["salom"] and seen[0].url.path == "/v1/chat/completions"
    assert "max_completion_tokens" in body and "max_tokens" not in body


@pytest.mark.anyio
async def test_codex_stream_via_responses(mock_http):
    evs = [
        {"type": "response.created"},
        {"type": "response.output_text.delta", "delta": "def "},
        {"type": "response.output_text.delta", "delta": "f(): pass"},
        {"type": "response.completed"},
    ]
    sse = "".join(f"data: {json.dumps(e)}\n\n" for e in evs)
    seen = mock_http(lambda req: httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"}))
    out = [t async for t in oc.stream_chat(OAI, "sk", "gpt-5-codex", [{"role": "user", "content": "kod"}], system="qisqa")]
    body = json.loads(seen[0].content)
    assert "".join(out) == "def f(): pass"
    assert seen[0].url.path == "/v1/responses" and body["instructions"] == "qisqa" and body["input"][0]["content"] == "kod"


@pytest.mark.anyio
async def test_codex_agent_step_roundtrip(mock_http):
    resp = {"status": "completed", "output": [
        {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "ENC", "status": "completed"},
        {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "write_file", "arguments": '{"path":"a.py"}', "status": "completed"},
    ]}
    seen = mock_http(lambda req: httpx.Response(200, json=resp))
    tools = [{"name": "write_file", "description": "d", "schema": {"type": "object"}}]
    raw, text, calls, trunc = await oc.step(OAI, "sk", "gpt-5-codex", "sys", [{"role": "user", "content": "yoz"}], tools)
    assert calls == [{"id": "call_1", "name": "write_file", "args": {"path": "a.py"}}] and not trunc
    # Keyingi qadam: oldingi elementlar o'zgarishsiz, natija function_call_output bo'lib ketadi
    msgs = [{"role": "user", "content": "yoz"}, {"role": "assistant", "raw": raw},
            {"role": "tool_results", "results": [{"id": "call_1", "name": "write_file", "output": "ok"}]}]
    await oc.step(OAI, "sk", "gpt-5-codex", "sys", msgs, tools)
    inp = json.loads(seen[1].content)["input"]
    assert inp[1]["encrypted_content"] == "ENC" and inp[2]["call_id"] == "call_1"
    assert inp[3] == {"type": "function_call_output", "call_id": "call_1", "output": "ok"}
    # Xuddi shu sessiyada oddiy GPT modeliga o'tilsa, raw Chat Completions formatiga o'giriladi
    chat = oc.agent_messages("sys", msgs)
    assert chat[2]["tool_calls"][0]["id"] == "call_1" and "items" not in chat[2]
