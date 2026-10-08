from sqlalchemy import text

from app.database import engine
from tests.conftest import make_client
from fastapi.testclient import TestClient
from app.main import app


def test_protected_routes_need_login():
    c = TestClient(app)
    for path in ["/api/auth/me", "/api/keys", "/api/conversations", "/api/media"]:
        assert c.get(path).status_code == 401


def test_register_login_logout(client):
    assert client.get("/api/auth/me").json()["email"] == "ali@example.com"
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    r = client.post("/api/auth/login", json={"email": "ALI@example.com", "password": "parol12345"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_cookie_is_httponly(client):
    c = TestClient(app)
    r = c.post("/api/auth/register", json={"email": "x@example.com", "password": "parol12345"})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_duplicate_and_validation(client):
    assert client.post("/api/auth/register", json={"email": "ali@example.com", "password": "boshqa12345"}).status_code == 409
    assert client.post("/api/auth/register", json={"email": "v@example.com", "password": "123"}).status_code == 422
    assert client.post("/api/auth/register", json={"email": "abc", "password": "parol12345"}).status_code == 422


def test_login_rate_limit(client):
    c = TestClient(app)
    for _ in range(5):
        assert c.post("/api/auth/login", json={"email": "ali@example.com", "password": "xato-parol"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "ali@example.com", "password": "parol12345"}).status_code == 429


def test_unknown_email_same_message():
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"email": "yoq@example.com", "password": "parol12345"})
    assert r.status_code == 401 and r.json()["detail"] == "Email yoki parol noto'g'ri."


def test_forged_cookie_rejected():
    c = TestClient(app)
    c.cookies.set("omniai_session", "soxta.token.qiymati")
    assert c.get("/api/auth/me").status_code == 401


def test_first_user_adopts_legacy_data():
    with engine.begin() as c:
        c.execute(text("insert into users (id,email) values (gen_random_uuid(),'local@omniai.dev')"))
        c.execute(text("insert into conversations (id,user_id,title) select gen_random_uuid(), id, 'ESKI' from users"))
    first = make_client("birinchi@example.com")
    assert [c["title"] for c in first.get("/api/conversations").json()] == ["ESKI"]
    second = make_client("ikkinchi@example.com")
    assert second.get("/api/conversations").json() == []
