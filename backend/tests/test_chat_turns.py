"""Chat navbati chekka holatlari: xato/bo'sh javob/bekor qilish, saqlash xatosi, bepul limit, ro'yxat sahifalari."""
import asyncio
import json
import uuid

import httpx
import pytest
from sqlalchemy import select, text

from app.config import settings
from app.database import SessionLocal, engine
from app.models import Provider, User
from app.providers import gemini_image, openai_compat, registry
from app.providers.base import ProviderError
from app.routers import chat
from app.schemas import SendMessageIn
from tests.conftest import make_client


def events(r):
    return [json.loads(x[5:]) for x in r.text.strip().split("\n\n") if x.startswith("data:")]


def new_conv(c):
    return c.post("/api/conversations").json()["id"]


def use_streamer(monkeypatch, fn):
    for p in list(registry.STREAMERS):
        monkeypatch.setitem(registry.STREAMERS, p, fn)


def add_custom(client, monkeypatch, model_ids, kind="openrouter"):
    """Soxta /models bilan custom provayder qo'shadi; chat javobi: 'custom javob'."""
    monkeypatch.setattr(settings, "allow_local_providers", True)
    data = {"data": [{"id": m, "architecture": {"output_modalities": ["text"]}, "supported_parameters": ["tools"]} for m in model_ids]}

    async def fake_get(self, url, **kw):
        return httpx.Response(200, json=data, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    async def fake_stream(base_url, api_key, model, messages, system=None, label="Model"):
        yield "custom javob"
    monkeypatch.setattr(openai_compat, "stream_chat", fake_stream)
    p = client.post("/api/providers", json={"kind": kind, "api_key": "sk-test-1234"})
    assert p.status_code == 201, p.text
    return p.json()["id"]


def test_long_custom_model_id_reply_is_saved(client, monkeypatch):
    long_id = "cognitivecomputations/" + "x" * 200 + ":free"
    pid = add_custom(client, monkeypatch, [long_id])
    ref = f"cp:{pid}:{long_id}"
    url = f"/api/conversations/{new_conv(client)}/messages"
    ev = events(client.post(url, json={"content": "salom", "model": ref}))
    assert ev[-1]["type"] == "done" and ev[-1]["model"] == ref
    assert [(m["role"], m["model"]) for m in client.get(url).json()] == [("user", None), ("assistant", ref)]


def test_failed_turn_is_removed_and_does_not_poison_next_prompt(client, fake_llm, monkeypatch):
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    cid = new_conv(client)
    url = f"/api/conversations/{cid}/messages"

    async def fail(api_key, model, messages, system=None):
        raise ProviderError("Provayder serverida xato (500).")
        yield  # pragma: no cover

    async def empty(api_key, model, messages, system=None):
        return
        yield  # pragma: no cover

    for bad in (fail, empty):
        monkeypatch.setitem(registry.STREAMERS, Provider.deepseek, bad)
        ev = events(client.post(url, json={"content": "birinchi savol", "model": "deepseek-chat"}))
        assert ev[-1]["type"] == "error" and ev[-1]["user_message_removed"] is True
        assert client.get(url).json() == []
        assert client.get("/api/conversations").json()[0]["title"] == "New chat"  # sarlavha ham qaytdi

    calls = []

    async def ok(api_key, model, messages, system=None):
        calls.append(messages)
        yield "javob"
    monkeypatch.setitem(registry.STREAMERS, Provider.deepseek, ok)
    assert events(client.post(url, json={"content": "ikkinchi savol", "model": "deepseek-chat"}))[-1]["type"] == "done"
    assert calls[-1] == [{"role": "user", "content": "ikkinchi savol"}]  # eski savol qo'shilib ketmadi
    assert client.get("/api/conversations").json()[0]["title"] == "ikkinchi savol"


def test_partial_reply_kept_on_error(client, monkeypatch):
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    url = f"/api/conversations/{new_conv(client)}/messages"

    async def half(api_key, model, messages, system=None):
        yield "Yarim jav"
        raise ProviderError("uzildi")
    monkeypatch.setitem(registry.STREAMERS, Provider.deepseek, half)
    ev = events(client.post(url, json={"content": "savol", "model": "deepseek-chat"}))
    assert ev[-1] == {"type": "error", "message": "uzildi"}
    assert [m["content"] for m in client.get(url).json()] == ["savol", "Yarim jav"]


def test_save_failure_and_deleted_conversation_end_with_error_event(client, monkeypatch):
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    cid = new_conv(client)
    url = f"/api/conversations/{cid}/messages"

    async def nul(api_key, model, messages, system=None):
        yield "a\x00b"  # PostgreSQL matnida NUL bo'lmaydi: saqlash xatosi
    monkeypatch.setitem(registry.STREAMERS, Provider.deepseek, nul)
    ev = events(client.post(url, json={"content": "savol", "model": "deepseek-chat"}))
    assert ev[-1] == {"type": "error", "message": "Javobni saqlab bo'lmadi."}

    async def delete_meanwhile(api_key, model, messages, system=None):
        yield "boshlandi"
        with engine.begin() as c:
            c.execute(text("DELETE FROM conversations WHERE id = :i"), {"i": cid})
        yield " davomi"
    monkeypatch.setitem(registry.STREAMERS, Provider.deepseek, delete_meanwhile)
    ev = events(client.post(url, json={"content": "yana", "model": "deepseek-chat"}))
    assert [e["type"] for e in ev] == ["delta", "delta", "error"] and "o'chirilgan" in ev[-1]["message"]
    assert client.get(url).status_code == 404


async def _start(cid: str, content: str):
    with SessionLocal() as db:
        user = db.scalar(select(User))
        resp = await chat.send_message(uuid.UUID(cid), SendMessageIn(content=content, model="deepseek-chat"), db=db, user=user)
    return resp.body_iterator


@pytest.mark.anyio
async def test_client_cancel(client, monkeypatch):
    """Mijoz uzilsa (Starlette oqim vazifasini bekor qiladi): javob yo'q bo'lsa savol olinadi, qisman bo'lsa saqlanadi."""
    monkeypatch.setattr(settings, "platform_deepseek_key", "platform-secret")
    monkeypatch.setattr(settings, "free_monthly_requests", 5)
    cid = new_conv(client)
    url = f"/api/conversations/{cid}/messages"
    gate = asyncio.Event()

    async def slow(api_key, model, messages, system=None):
        if messages[-1]["content"] == "qisman":
            yield "Yarim"
        gate.set()
        await asyncio.sleep(30)
        yield "hech qachon"
    monkeypatch.setitem(registry.STREAMERS, Provider.deepseek, slow)

    it = await _start(cid, "bekor qilingan savol")
    task = asyncio.ensure_future(it.__anext__())
    await gate.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert client.get(url).json() == []
    assert client.get("/api/usage").json()["used"] == 0  # bepul limit qaytarildi

    gate.clear()
    it = await _start(cid, "qisman")
    assert json.loads((await it.__anext__())[5:])["text"] == "Yarim"
    task = asyncio.ensure_future(it.__anext__())
    await gate.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert [m["content"] for m in client.get(url).json()] == ["qisman", "Yarim"]
    assert client.get("/api/usage").json()["used"] == 1


def test_platform_quota_and_usage_only_for_successful_replies(client, monkeypatch):
    monkeypatch.setattr(settings, "platform_deepseek_key", "platform-secret")
    monkeypatch.setattr(settings, "free_monthly_requests", 3)
    url = f"/api/conversations/{new_conv(client)}/messages"

    async def fail(api_key, model, messages, system=None):
        raise ProviderError("Provayder serverida xato (500).")
        yield  # pragma: no cover
    monkeypatch.setitem(registry.STREAMERS, Provider.deepseek, fail)
    for _ in range(4):  # limitdan ko'p xato so'rov ham limitni yemaydi
        assert events(client.post(url, json={"content": "x", "model": "deepseek-chat"}))[-1]["type"] == "error"
    assert client.get("/api/usage").json()["used"] == 0
    assert client.get("/api/usage/stats").json()["by_kind"] == {}

    # Rasmni ko'ra olmaydigan modelga canvas: 400, limit yechilmaydi
    png = "iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    assert client.post(url, json={"content": "x", "model": "deepseek-chat", "image": png}).status_code == 400
    assert client.get("/api/usage").json()["used"] == 0

    async def ok(api_key, model, messages, system=None):
        yield "javob"
    monkeypatch.setitem(registry.STREAMERS, Provider.deepseek, ok)
    assert events(client.post(url, json={"content": "x", "model": "deepseek-chat"}))[-1]["type"] == "done"
    assert client.get("/api/usage").json()["used"] == 1
    assert client.get("/api/usage/stats").json()["by_model"] == [{"model": "deepseek-chat", "count": 1}]


def test_auto_image_failure_refunds_and_alt_text_is_safe(client, monkeypatch):
    monkeypatch.setattr(settings, "platform_gemini_key", "platform-gemini")
    monkeypatch.setattr(settings, "free_monthly_requests", 5)
    url = f"/api/conversations/{new_conv(client)}/messages"

    async def refuse(api_key, model, prompt):
        raise ProviderError("Model rasm qaytarmadi (rad).")
    monkeypatch.setattr(gemini_image, "generate_image", refuse)
    ev = events(client.post(url, json={"content": "logo chizib ber", "model": "auto"}))
    assert ev[0]["type"] == "route" and ev[0]["kind"] == "image" and ev[-1]["user_message_removed"] is True
    assert client.get("/api/usage").json()["used"] == 0

    async def ok(api_key, model, prompt):
        return "image/png", b"\x89PNG\r\n\x1a\n" + b"0" * 20
    monkeypatch.setattr(gemini_image, "generate_image", ok)
    prompt = "logo] chizib ber\n\nqizil `rang` <b>" + "y" * 60 + "\\"
    ev = events(client.post(url, json={"content": prompt, "model": "auto"}))
    md = ev[1]["text"]
    alt = md[2:md.index("](omni-media://")]
    assert md.startswith("![") and md.endswith(")") and len(alt) <= 80
    assert not any(ch in alt for ch in "[]\\`<>\n")
    assert client.get("/api/usage").json()["used"] == 1
    assert client.get("/api/usage/stats").json()["by_kind"] == {"image": 1}


def test_whitespace_only_message_rejected(client, fake_llm):
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    cid = new_conv(client)
    r = client.post(f"/api/conversations/{cid}/messages", json={"content": "  \n\t ", "model": "deepseek-chat"})
    assert r.status_code == 422 and r.json()["detail"] == "Xabar bo'sh bo'lmasligi kerak."
    assert client.get("/api/conversations").json()[0]["title"] == "New chat"


def test_usage_stats_custom_models_and_labels(client, monkeypatch):
    pid = add_custom(client, monkeypatch, ["meta-llama/llama-3.3-70b-instruct:free"])
    url = f"/api/conversations/{new_conv(client)}/messages"
    client.post(url, json={"content": "x", "model": f"cp:{pid}:meta-llama/llama-3.3-70b-instruct:free"})
    s = client.get("/api/usage/stats").json()
    assert s["by_model"] == [{"model": "meta-llama/llama-3.3-70b-instruct:free", "count": 1}]
    assert s["providers"] == ["openrouter"] and s["labels"] == {"openrouter": "OpenRouter"} and s["total"] == 1


def test_route_event_kind_and_own_provider_after_quota(client, monkeypatch):
    monkeypatch.setattr(settings, "platform_gemini_key", "platform-gemini")
    monkeypatch.setattr(settings, "free_monthly_requests", 1)
    calls = []

    async def fake(api_key, model, messages, system=None):
        calls.append((model, api_key))
        yield "javob"
    use_streamer(monkeypatch, fake)
    url = f"/api/conversations/{new_conv(client)}/messages"
    ev = events(client.post(url, json={"content": "salom", "model": "auto"}))
    assert ev[0] == {"type": "route", "model": "gemini-2.5-flash", "label": "Gemini 2.5 Flash", "reason": "umumiy savol", "kind": "general"}
    # Limit tugadi: platforma modellari mavjud emas, sababi "quota"
    flash = next(m for m in client.get("/api/models").json() if m["id"] == "gemini-2.5-flash")
    assert flash["available"] is False and flash["unavailable_reason"] == "quota" and flash["platform"] is True
    claude = next(m for m in client.get("/api/models").json() if m["id"] == "claude-sonnet-5-5")
    assert claude["unavailable_reason"] == "no_key"
    r = client.post(url, json={"content": "salom", "model": "auto"})
    assert r.status_code == 400  # hech narsa yo'q
    # Custom provayder qo'shildi: Auto o'shani tanlaydi (429 emas)
    pid = add_custom(client, monkeypatch, ["meta-llama/llama-3.3-70b-instruct:free"])
    ev = events(client.post(url, json={"content": "python kod yoz", "model": "auto"}))
    assert ev[0]["model"] == f"cp:{pid}:meta-llama/llama-3.3-70b-instruct:free" and ev[0]["kind"] == "code"
    assert ev[-1]["type"] == "done"
    # O'z Deepseek kaliti: oddiy savol ham platformaga emas, o'z kalitiga
    monkeypatch.setattr(settings, "free_monthly_requests", 100)
    client.put("/api/keys/deepseek", json={"key": "my-deepseek-1234"})
    ev = events(client.post(url, json={"content": "salom", "model": "auto"}))
    assert ev[0]["model"] == "deepseek-chat" and calls[-1] == ("deepseek-chat", "my-deepseek-1234")


def test_conversations_pagination_search_and_rename(client):
    ids = []
    for i in range(5):
        cid = new_conv(client)
        client.patch(f"/api/conversations/{cid}", json={"title": f"Suhbat {i} 100%_ok" if i == 3 else f"Suhbat {i}"})
        with engine.begin() as c:  # aniq tartib uchun vaqtni qo'lda beramiz
            c.execute(text("UPDATE conversations SET updated_at = now() - make_interval(mins => :m) WHERE id = :i"),
                      {"m": 10 - i, "i": cid})
        ids.append(cid)
    page1 = client.get("/api/conversations?limit=2").json()
    assert [c["id"] for c in page1] == [ids[4], ids[3]]
    before = page1[-1]["updated_at"]
    page2 = client.get("/api/conversations", params={"limit": 2, "before": before}).json()
    assert [c["id"] for c in page2] == [ids[2], ids[1]]
    assert len(client.get("/api/conversations").json()) == 5
    assert client.get("/api/conversations?limit=201").status_code == 422
    assert [c["id"] for c in client.get("/api/conversations", params={"q": "SUHBAT 2"}).json()] == [ids[2]]
    assert [c["id"] for c in client.get("/api/conversations", params={"q": "100%_"}).json()] == [ids[3]]
    assert client.get("/api/conversations", params={"q": "%"}).json()[0]["id"] == ids[3]  # % harfma-harf qidiriladi

    r = client.patch(f"/api/conversations/{ids[0]}", json={"title": "  Yangi nom  "})
    assert r.status_code == 200 and r.json()["title"] == "Yangi nom"
    assert client.get("/api/conversations").json()[-1]["id"] == ids[0]  # nomlash tartibni o'zgartirmaydi
    assert client.patch(f"/api/conversations/{ids[0]}", json={"title": "   "}).status_code == 422
    assert client.patch(f"/api/conversations/{ids[0]}", json={"title": "x" * 201}).status_code == 422
    other = make_client("vali@example.com")
    assert other.patch(f"/api/conversations/{ids[0]}", json={"title": "o'g'ri"}).status_code == 404
    assert other.get("/api/conversations", params={"q": "Suhbat"}).json() == []
