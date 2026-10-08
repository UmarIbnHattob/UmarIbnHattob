from concurrent.futures import ThreadPoolExecutor

from app.config import settings
from tests.conftest import make_client


def test_no_key_and_no_platform_key(client, fake_llm):
    cid = client.post("/api/conversations").json()["id"]
    r = client.post(f"/api/conversations/{cid}/messages", json={"content": "x", "model": "deepseek-chat"})
    assert r.status_code == 400


def test_platform_key_with_monthly_limit(client, fake_llm, monkeypatch):
    monkeypatch.setattr(settings, "platform_deepseek_key", "platform-secret")
    monkeypatch.setattr(settings, "free_monthly_requests", 2)
    keys = {k["provider"]: k for k in client.get("/api/keys").json()}
    assert keys["deepseek"]["platform_available"] and not keys["anthropic"]["platform_available"]
    url = f"/api/conversations/{client.post('/api/conversations').json()['id']}/messages"
    for _ in range(2):
        assert client.post(url, json={"content": "x", "model": "deepseek-chat"}).status_code == 200
    assert fake_llm[-1]["key"] == "platform-secret"
    r = client.post(url, json={"content": "x", "model": "deepseek-chat"})
    assert r.status_code == 429 and "limit" in r.json()["detail"]
    assert client.get("/api/usage").json()["used"] == 2
    # O'z kalitini kiritsa — limitdan qat'iy nazar ishlaydi va platforma kaliti ishlatilmaydi
    client.put("/api/keys/deepseek", json={"key": "my-own-key-1234"})
    assert client.post(url, json={"content": "x", "model": "deepseek-chat"}).status_code == 200
    assert fake_llm[-1]["key"] == "my-own-key-1234"
    # Boshqa foydalanuvchining limiti alohida
    other = make_client("vali@example.com")
    assert other.get("/api/usage").json()["used"] == 0


def test_quota_is_atomic_under_concurrency(client, monkeypatch):
    from app.database import SessionLocal
    from app.models import Provider, User
    from app.quota import resolve_key
    from fastapi import HTTPException

    monkeypatch.setattr(settings, "platform_gemini_key", "pk")
    monkeypatch.setattr(settings, "free_monthly_requests", 5)
    uid = client.get("/api/auth/me").json()["id"]

    def one(_):
        with SessionLocal() as db:
            try:
                resolve_key(db, db.get(User, __import__("uuid").UUID(uid)), Provider.gemini)
                return True
            except HTTPException:
                return False

    with ThreadPoolExecutor(10) as ex:
        ok = list(ex.map(one, range(20)))
    assert sum(ok) == 5
