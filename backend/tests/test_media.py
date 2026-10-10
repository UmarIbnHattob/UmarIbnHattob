from app.providers import gemini_image
from app.providers.base import ProviderError

PNG = b"\x89PNG\r\n\x1a\n" + b"1" * 30


def test_image_flow(client, monkeypatch):
    async def fake(api_key, model, prompt):
        return "image/png", PNG

    monkeypatch.setattr(gemini_image, "generate_image", fake)
    body = {"prompt": "mushuk", "model": "gemini-2.5-flash-image"}
    assert client.post("/api/media/images", json=body).status_code == 400  # kalit yo'q
    client.put("/api/keys/gemini", json={"key": "key-gemini-1234"})
    item = client.post("/api/media/images", json=body).json()
    assert [m["prompt"] for m in client.get("/api/media").json()] == ["mushuk"]
    f = client.get(f"/api/media/{item['id']}/file?download=1")
    assert f.content == PNG and "attachment" in f.headers["content-disposition"]
    assert client.delete(f"/api/media/{item['id']}").status_code == 204
    assert client.get("/api/media").json() == []


def test_provider_error_is_502(client, monkeypatch):
    async def fail(api_key, model, prompt):
        raise ProviderError("limit tugadi")

    monkeypatch.setattr(gemini_image, "generate_image", fail)
    client.put("/api/keys/gemini", json={"key": "key-gemini-1234"})
    r = client.post("/api/media/images", json={"prompt": "x", "model": "gemini-2.5-flash-image"})
    assert r.status_code == 502 and r.json()["detail"] == "limit tugadi"


def test_failed_image_refunds_platform_quota(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "platform_gemini_key", "platform-gemini")
    monkeypatch.setattr(settings, "free_monthly_requests", 3)

    async def fail(api_key, model, prompt):
        raise ProviderError("Model rasm qaytarmadi (rad).")
    monkeypatch.setattr(gemini_image, "generate_image", fail)
    body = {"prompt": "x", "model": "gemini-2.5-flash-image"}
    assert client.post("/api/media/images", json=body).status_code == 502
    assert client.get("/api/usage").json()["used"] == 0
    assert client.get("/api/usage/stats").json()["by_kind"] == {}

    async def ok(api_key, model, prompt):
        return "image/png", PNG
    monkeypatch.setattr(gemini_image, "generate_image", ok)
    assert client.post("/api/media/images", json=body).status_code == 201
    assert client.get("/api/usage").json()["used"] == 1


def test_media_pagination(client):
    from sqlalchemy import text
    from app.database import engine
    uid = client.get("/api/auth/me").json()["id"]
    with engine.begin() as c:
        for i in range(5):
            c.execute(text("INSERT INTO media_items (id, user_id, kind, prompt, model, mime_type, data, created_at) "
                           "VALUES (gen_random_uuid(), :u, 'image', :p, 'm', 'image/png', :d, now() - make_interval(mins => :m))"),
                      {"u": uid, "p": f"r{i}", "d": PNG, "m": 10 - i})
    page = client.get("/api/media?limit=2").json()
    assert [m["prompt"] for m in page] == ["r4", "r3"]
    page = client.get("/api/media", params={"limit": 2, "before": page[-1]["created_at"]}).json()
    assert [m["prompt"] for m in page] == ["r2", "r1"]
    assert len(client.get("/api/media").json()) == 5
    assert client.get("/api/media?limit=500").status_code == 422


def test_file_cache_policy(client, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from tests.conftest import make_client

    async def fake(api_key, model, prompt):
        return "image/png", PNG
    monkeypatch.setattr(gemini_image, "generate_image", fake)
    client.put("/api/keys/gemini", json={"key": "key-gemini-1234"})
    item = client.post("/api/media/images", json={"prompt": "mushuk", "model": "gemini-2.5-flash-image"}).json()
    url = f"/api/media/{item['id']}/file"
    f = client.get(url)
    assert f.headers["cache-control"] == "private, no-cache" and f.headers["etag"] == f'"{item["id"]}"'
    again = client.get(url, headers={"If-None-Match": f.headers["etag"]})
    assert again.status_code == 304 and again.content == b""
    assert client.get(url, headers={"If-None-Match": '"boshqa"'}).status_code == 200
    # Chiqqan (cookie yo'q) yoki boshqa foydalanuvchi: ETag mos bo'lsa ham rasm berilmaydi
    assert TestClient(app).get(url, headers={"If-None-Match": f.headers["etag"]}).status_code == 401
    assert make_client("v@example.com").get(url, headers={"If-None-Match": f.headers["etag"]}).status_code == 404
