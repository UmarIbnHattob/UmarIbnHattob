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
