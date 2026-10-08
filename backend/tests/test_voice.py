import base64

import httpx

WAV = base64.b64encode(b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 200).decode()


def test_voice_transcribe(client, monkeypatch):
    assert client.post("/api/voice/transcribe", json={"audio": WAV}).status_code == 400  # Gemini kaliti yo'q
    client.put("/api/keys/gemini", json={"key": "key-gemini-1234"})
    seen = {}

    async def fake_post(self, url, **kw):
        seen["mime"] = kw["json"]["contents"][0]["parts"][0]["inlineData"]["mimeType"]
        data = {"candidates": [{"content": {"parts": [{"text": "  Salom, kalkulyator yoz  "}]}}]}
        return httpx.Response(200, json=data, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    r = client.post("/api/voice/transcribe", json={"audio": WAV})
    assert r.status_code == 200 and r.json()["text"] == "Salom, kalkulyator yoz" and seen["mime"] == "audio/wav"
    not_wav = base64.b64encode(b"x" * 300).decode()
    assert client.post("/api/voice/transcribe", json={"audio": not_wav}).status_code == 400
