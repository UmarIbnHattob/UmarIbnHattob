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


OGG = base64.b64encode(b"OggS" + b"\0" * 300).decode()


def test_audio_magic_bytes(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "platform_gemini_key", "platform-gemini")
    garbage = base64.b64encode(b"x" * 300).decode()
    for mime in ("audio/ogg", "audio/mpeg", "audio/mp3", "audio/flac", "audio/wav"):
        r = client.post("/api/voice/transcribe", json={"audio": garbage, "mime": mime})
        assert r.status_code == 400, mime
    assert client.post("/api/voice/transcribe", json={"audio": OGG, "mime": "audio/x-unknown"}).status_code == 400
    assert client.get("/api/usage").json()["used"] == 0


def _groq(client, monkeypatch, seen):
    from app.config import settings
    from app.providers import openai_compat
    monkeypatch.setattr(settings, "allow_local_providers", True)

    async def fake_get(self, url, **kw):
        return httpx.Response(200, json={"data": [{"id": "llama-3.3-70b-versatile"}]}, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    assert client.post("/api/providers", json={"kind": "groq", "api_key": "gsk-1234"}).status_code == 201

    async def fake_tr(base, key, model, data, filename="voice.wav", mime="audio/wav"):
        seen.append({"model": model, "filename": filename, "mime": mime})
        return "whisper matni"
    monkeypatch.setattr(openai_compat, "transcribe", fake_tr)


def _gemini_answers(monkeypatch, status, seen=None):
    async def fake_post(self, url, **kw):
        if seen is not None:
            seen.append(kw["headers"]["x-goog-api-key"])
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "x"}}, request=httpx.Request("POST", url))
        data = {"candidates": [{"content": {"parts": [{"text": "gemini matni"}]}}]}
        return httpx.Response(200, json=data, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)


def test_whisper_fallback_when_own_gemini_key_fails(client, monkeypatch):
    seen = []
    _groq(client, monkeypatch, seen)
    client.put("/api/keys/gemini", json={"key": "key-gemini-bad1"})
    for status in (401, 429):
        _gemini_answers(monkeypatch, status)
        r = client.post("/api/voice/transcribe", json={"audio": OGG, "mime": "audio/ogg"})
        assert r.status_code == 200 and r.json()["text"] == "whisper matni"
    assert seen[-1] == {"model": "whisper-large-v3-turbo", "filename": "voice.ogg", "mime": "audio/ogg"}
    _gemini_answers(monkeypatch, 200)
    assert client.post("/api/voice/transcribe", json={"audio": WAV}).json()["text"] == "gemini matni"
    kinds = client.get("/api/usage/stats").json()
    assert kinds["by_kind"] == {"voice": 3} and kinds["labels"]["whisper"] == "Whisper"


def test_platform_quota_exhausted_voice(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "platform_gemini_key", "platform-gemini")
    monkeypatch.setattr(settings, "free_monthly_requests", 1)
    keys = []
    _gemini_answers(monkeypatch, 500, keys)
    r = client.post("/api/voice/transcribe", json={"audio": WAV})
    assert r.status_code == 502 and client.get("/api/usage").json()["used"] == 0  # xato: limit qaytarildi
    _gemini_answers(monkeypatch, 200, keys)
    assert client.post("/api/voice/transcribe", json={"audio": WAV}).status_code == 200
    assert keys[-1] == "platform-gemini" and client.get("/api/usage").json()["used"] == 1
    r = client.post("/api/voice/transcribe", json={"audio": WAV})
    assert r.status_code == 429 and "limit" in r.json()["detail"]  # aniq sabab: bepul limit
    seen = []
    _groq(client, monkeypatch, seen)
    _gemini_answers(monkeypatch, 200, keys)
    r = client.post("/api/voice/transcribe", json={"audio": WAV})
    assert r.status_code == 200 and r.json()["text"] == "whisper matni" and len(seen) == 1


# Gemini noto'g'ri/muddati o'tgan kalitga haqiqatda shunday 400 qaytaradi (401 emas)
KEY_INVALID = {"error": {
    "code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT",
    "details": [
        {"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID", "domain": "googleapis.com",
         "metadata": {"service": "generativelanguage.googleapis.com"}},
        {"@type": "type.googleapis.com/google.rpc.LocalizedMessage", "locale": "en-US",
         "message": "API key not valid. Please pass a valid API key."},
    ],
}}
KEY_EXPIRED = {"error": {
    "code": 400, "message": "API key expired. Please renew the API key.", "status": "INVALID_ARGUMENT",
    "details": [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID",
                 "domain": "googleapis.com", "metadata": {"service": "generativelanguage.googleapis.com"}}],
}}


def _gemini_json(monkeypatch, status, payload):
    async def fake_post(self, url, **kw):
        return httpx.Response(status, json=payload, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)


def test_invalid_gemini_key_400_falls_back_to_whisper(client, monkeypatch):
    client.put("/api/keys/gemini", json={"key": "key-gemini-bad1"})
    # Whisper provayderi yo'q: tushunarli xabar (xom JSON emas)
    _gemini_json(monkeypatch, 400, KEY_INVALID)
    r = client.post("/api/voice/transcribe", json={"audio": WAV})
    assert r.status_code == 502 and "kalit noto'g'ri" in r.json()["detail"]
    seen = []
    _groq(client, monkeypatch, seen)
    for payload in (KEY_INVALID, KEY_EXPIRED):
        _gemini_json(monkeypatch, 400, payload)
        r = client.post("/api/voice/transcribe", json={"audio": WAV})
        assert r.status_code == 200 and r.json()["text"] == "whisper matni"
    assert len(seen) == 2
    # Boshqa 400 (masalan audio noto'g'ri) — Whisper'ga o'tilmaydi
    _gemini_json(monkeypatch, 400, {"error": {"code": 400, "message": "Invalid audio", "status": "INVALID_ARGUMENT"}})
    assert client.post("/api/voice/transcribe", json={"audio": WAV}).status_code == 502 and len(seen) == 2


def test_whisper_provider_looked_up_only_when_needed(client, monkeypatch):
    from app.routers import voice
    seen, lookups = [], []
    _groq(client, monkeypatch, seen)
    real = voice._whisper_provider

    async def counting(db, user_id):
        lookups.append(user_id)
        return await real(db, user_id)
    monkeypatch.setattr(voice, "_whisper_provider", counting)
    client.put("/api/keys/gemini", json={"key": "key-gemini-1234"})
    _gemini_answers(monkeypatch, 200)
    assert client.post("/api/voice/transcribe", json={"audio": WAV}).json()["text"] == "gemini matni"
    assert lookups == []  # Gemini ishladi: Whisper provayderi qidirilmadi (DNS ham yo'q)
    _gemini_answers(monkeypatch, 503)
    assert client.post("/api/voice/transcribe", json={"audio": WAV}).json()["text"] == "whisper matni"
    assert len(lookups) == 1


def test_voice_quota_refund_only_on_gemini_failure(client, monkeypatch):
    """Platforma kaliti: Gemini xatosi limitni qaytaradi; bo'sh (200) javob qaytarmaydi — so'rov hisoblangan."""
    from app.config import settings
    monkeypatch.setattr(settings, "platform_gemini_key", "platform-gemini")
    monkeypatch.setattr(settings, "free_monthly_requests", 5)
    _gemini_answers(monkeypatch, 500)
    assert client.post("/api/voice/transcribe", json={"audio": WAV}).status_code == 502
    assert client.get("/api/usage").json()["used"] == 0
    _gemini_json(monkeypatch, 200, {"candidates": []})
    r = client.post("/api/voice/transcribe", json={"audio": WAV})
    assert r.status_code == 200 and r.json()["text"] == ""
    assert client.get("/api/usage").json()["used"] == 1
