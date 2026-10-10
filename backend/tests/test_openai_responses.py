"""OpenAI: model filtri, max_completion_tokens va Codex uchun Responses API (tarmoqsiz, httpx mock)."""
import json

import httpx
import pytest

from app.agent import adapters
from app.providers import openai_compat as oc
from app.providers.base import FILTERED_NOTE, INTERRUPTED_NOTE, TRUNCATED_NOTE, ProviderError

OAI = "https://api.openai.com/v1"


def _transport(handler):
    real = httpx.AsyncClient.__init__

    def init(self, *a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        real(self, *a, **kw)
    return init


@pytest.fixture
def mock_http(monkeypatch):
    seen, current = [], {}

    def wrapped(req):
        seen.append(req)
        return current["handler"](req)
    monkeypatch.setattr(httpx.AsyncClient, "__init__", _transport(wrapped))

    def use(handler):  # bir testda bir necha marta chaqirilsa, oxirgi javob ishlatiladi
        current["handler"] = handler
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


def _sse(evs):
    body = "".join(f"data: {json.dumps(e)}\n\n" for e in evs)
    return lambda req: httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})


async def _collect(**kw):
    return [t async for t in oc.stream_chat(OAI, "sk", "gpt-5-codex", [{"role": "user", "content": "x"}], label="GPT-5 Codex")]


@pytest.mark.anyio
async def test_responses_error_event_spec_shape(mock_http):
    mock_http(_sse([{"type": "error", "code": "rate_limit_exceeded", "message": "Rate limit reached for gpt-5-codex", "param": None}]))
    with pytest.raises(ProviderError) as e:
        await _collect()
    assert str(e.value) == "GPT-5 Codex: Rate limit reached for gpt-5-codex (rate_limit_exceeded)"
    mock_http(_sse([{"type": "response.failed", "response": {"error": {"code": "server_error", "message": "The model failed."}}}]))
    with pytest.raises(ProviderError, match="The model failed"):
        await _collect()


@pytest.mark.anyio
async def test_responses_refusal_filter_and_cut_stream(mock_http):
    mock_http(_sse([{"type": "response.refusal.delta", "delta": "I can't "}, {"type": "response.refusal.delta", "delta": "help."},
                    {"type": "response.refusal.done", "refusal": "I can't help."}, {"type": "response.completed"}]))
    out = "".join(await _collect())
    assert "javob bermadi" in out and "I can't help." in out

    mock_http(_sse([{"type": "response.output_text.delta", "delta": "Salom"},
                    {"type": "response.incomplete", "response": {"incomplete_details": {"reason": "content_filter"}}}]))
    assert await _collect() == ["Salom", FILTERED_NOTE]
    mock_http(_sse([{"type": "response.output_text.delta", "delta": "Salom"},
                    {"type": "response.incomplete", "response": {"incomplete_details": {"reason": "max_output_tokens"}}}]))
    assert await _collect() == ["Salom", TRUNCATED_NOTE]

    # Yakuniy hodisasiz uzilgan oqim: qisman javob "to'liq" deb ko'rsatilmaydi
    mock_http(_sse([{"type": "response.output_text.delta", "delta": "Yarim jav"}]))
    assert await _collect() == ["Yarim jav", INTERRUPTED_NOTE]
    mock_http(_sse([{"type": "response.created"}]))
    with pytest.raises(ProviderError, match="to'liq kelmadi"):
        await _collect()


@pytest.mark.anyio
async def test_chat_completions_content_filter_and_refusal(mock_http):
    evs = [{"choices": [{"delta": {"content": "Salom"}}]}, {"choices": [{"delta": {}, "finish_reason": "content_filter"}]}]
    mock_http(_sse(evs))
    out = [t async for t in oc.stream_chat(OAI, "sk", "gpt-5", [{"role": "user", "content": "x"}])]
    assert out == ["Salom", FILTERED_NOTE]
    mock_http(_sse([{"choices": [{"delta": {"refusal": "No."}, "finish_reason": "stop"}]}]))
    out = "".join([t async for t in oc.stream_chat(OAI, "sk", "gpt-5", [{"role": "user", "content": "x"}], label="GPT-5")])
    assert "GPT-5 bu so'rovga javob bermadi: No." in out


@pytest.mark.anyio
async def test_responses_agent_step_refusal_filter_and_malformed_items(mock_http):
    tools = [{"name": "write_file", "description": "d", "schema": {"type": "object"}}]
    resp = {"status": "completed", "output": [
        {"type": "message", "content": [{"type": "refusal", "refusal": "I can't do that."}]},
        {"type": "function_call", "name": "write_file", "arguments": "{}"},  # call_id yo'q
        "garbage",
    ]}
    mock_http(lambda req: httpx.Response(200, json=resp))
    raw, text, calls, stop = await oc.step(OAI, "sk", "gpt-5-codex", "sys", [{"role": "user", "content": "x"}], tools, "Codex")
    assert "I can't do that." in text and calls == [] and stop is None
    assert [it.get("type", "message") for it in raw["items"]] == ["message"]

    resp = {"status": "incomplete", "incomplete_details": {"reason": "content_filter"}, "output": [
        {"type": "function_call", "call_id": "c1", "name": "write_file", "arguments": "{}"}]}
    mock_http(lambda req: httpx.Response(200, json=resp))
    res = await adapters.step_openai(OAI, "sk", "gpt-5-codex", "sys", [{"role": "user", "content": "x"}])
    assert res.tool_calls == [] and res.note == adapters.FILTERED
