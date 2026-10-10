"""Claude chat oqimi haqiqiy SDK kodi orqali (tarmoq o'rniga soxta transport)."""
import json

import anthropic
import httpx2
import pytest

from app.providers import anthropic as claude
from app.providers.base import ProviderError, TRUNCATED_NOTE


def sse(events):
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)


def events(stop_reason="end_turn"):
    msg = {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5", "content": [],
           "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 3, "output_tokens": 0}}
    return [
        {"type": "message_start", "message": msg},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Salom "}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "dunyo"}},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": stop_reason, "stop_sequence": None}, "usage": {"output_tokens": 2}},
        {"type": "message_stop"},
    ]


def patch_client(monkeypatch, handler):
    monkeypatch.setattr(
        claude, "client_for",
        lambda key: anthropic.AsyncAnthropic(api_key=key, max_retries=0, http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler))),
    )


@pytest.mark.anyio
@pytest.mark.parametrize("stop,tail", [("end_turn", []), ("max_tokens", [TRUNCATED_NOTE]), ("refusal", [claude.REFUSAL_NOTE])])
async def test_stream_chat(monkeypatch, stop, tail):
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        seen["beta"] = request.headers.get("anthropic-beta")
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, text=sse(events(stop)))

    patch_client(monkeypatch, handler)
    out = [t async for t in claude.stream_chat("k", "claude-sonnet-5-5", [{"role": "user", "content": "hi"}])]
    assert out == ["Salom ", "dunyo", *tail]
    assert seen["body"]["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in seen["beta"]
    assert seen["body"]["stream"] is True


@pytest.mark.anyio
async def test_auth_error_is_friendly(monkeypatch):
    patch_client(monkeypatch, lambda r: httpx2.Response(401, json={"type": "error", "error": {"type": "authentication_error", "message": "bad key"}}))
    with pytest.raises(ProviderError, match="kaliti noto'g'ri"):
        [t async for t in claude.stream_chat("k", "claude-sonnet-5-5", [{"role": "user", "content": "hi"}])]
