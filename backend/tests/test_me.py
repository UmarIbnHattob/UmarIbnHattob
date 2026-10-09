import json

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import make_client


def test_profile_and_preferences(client):
    me = client.get("/api/me").json()
    assert me["preferences"]["theme"] == "system" and me["plan"] == "none"
    r = client.patch("/api/me", json={"display_name": "Umar Ibn Hattob", "nickname": "Umar",
                                      "preferences": {"theme": "light", "language": "en"}})
    assert r.status_code == 200
    p = r.json()["preferences"]
    assert p["theme"] == "light" and p["language"] == "en" and p["font_size"] == "md"  # qisman yangilash
    assert client.patch("/api/me", json={"preferences": {"theme": "neon"}}).status_code == 422
    assert client.patch("/api/me", json={"preferences": {"avatar_color": "red;"}}).status_code == 422
    # nickname ni bo'shatish
    assert client.patch("/api/me", json={"nickname": ""}).json()["nickname"] is None


def test_personal_system_prompt_reaches_model(client, fake_llm):
    client.patch("/api/me", json={"nickname": "Umar", "preferences": {
        "response_language": "uz", "custom_instructions": "Javoblar qisqa bo'lsin."}})
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    cid = client.post("/api/conversations").json()["id"]
    client.post(f"/api/conversations/{cid}/messages", json={"content": "salom", "model": "deepseek-chat"})
    system = fake_llm[-1]["system"]
    assert "Umar" in system and "Uzbek" in system and "qisqa" in system
    assert client.get("/api/me").json()["plan"] == "byok"


def test_change_password_and_logout_everywhere(client):
    other_device = TestClient(app)
    other_device.post("/api/auth/login", json={"email": "ali@example.com", "password": "parol12345"})
    assert other_device.get("/api/me").status_code == 200
    assert client.post("/api/me/password", json={"current_password": "xato", "new_password": "yangi-parol-1"}).status_code == 400
    assert client.post("/api/me/password", json={"current_password": "parol12345", "new_password": "yangi-parol-1"}).status_code == 204
    assert client.get("/api/me").status_code == 200        # shu qurilma kirgan holda qoladi
    assert other_device.get("/api/me").status_code == 401  # boshqa qurilma chiqarib yuborildi
    assert TestClient(app).post("/api/auth/login", json={"email": "ali@example.com", "password": "yangi-parol-1"}).status_code == 200
    client.post("/api/me/logout-all")
    assert client.get("/api/me").status_code == 401


def test_export_and_delete_all(client, fake_llm):
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    cid = client.post("/api/conversations").json()["id"]
    client.post(f"/api/conversations/{cid}/messages", json={"content": "eksport testi", "model": "deepseek-chat"})
    r = client.get("/api/me/export")
    assert "attachment" in r.headers["content-disposition"]
    data = json.loads(r.content)
    assert data["account"]["email"] == "ali@example.com"
    assert [m["content"] for m in data["conversations"][0]["messages"]] == ["eksport testi", "Salom dunyo"]
    assert "key-deepseek" not in r.text  # kalitlar eksportga kirmaydi
    assert client.delete("/api/conversations").status_code == 204
    assert client.get("/api/conversations").json() == []


def test_usage_stats(client, fake_llm):
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    cid = client.post("/api/conversations").json()["id"]
    for _ in range(3):
        client.post(f"/api/conversations/{cid}/messages", json={"content": "x", "model": "deepseek-chat"})
    s = client.get("/api/usage/stats?days=7").json()
    assert len(s["days"]) == 7 and s["days"][-1] in s["series"]
    assert s["series"][s["days"][-1]]["deepseek"] == 3
    assert s["by_model"] == [{"model": "deepseek-chat", "count": 3}] and s["by_kind"] == {"chat": 3}
    assert make_client("v@example.com").get("/api/usage/stats").json()["by_model"] == []


def test_delete_account(client):
    assert client.request("DELETE", "/api/me", json={"password": "xato"}).status_code == 400
    assert client.request("DELETE", "/api/me", json={"password": "parol12345"}).status_code == 204
    assert TestClient(app).post("/api/auth/login", json={"email": "ali@example.com", "password": "parol12345"}).status_code == 401
