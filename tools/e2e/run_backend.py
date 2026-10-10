"""Backendni soxta provayderlar bilan ishga tushirish: tashqi AI manzillari 127.0.0.1:9100 ga yo'naltiriladi.

Backenddagi provayder kodi O'ZGARMAYDI — faqat httpx transport darajasida manzil almashtiriladi.
"""
import os, sys
for k in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]:
    os.environ.pop(k, None)
os.environ["ANTHROPIC_BASE_URL"] = "http://127.0.0.1:9100/anthropic"
os.environ.setdefault("ALLOW_LOCAL_PROVIDERS", "true")
sys.path.insert(0, os.environ.get("BACKEND_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend")))
import httpx

FAKE = "http://127.0.0.1:9100"
HOSTS = {
    "generativelanguage.googleapis.com": "gemini",
    "api.deepseek.com": "oai/deepseek",
    "api.openai.com": "oai/openai",
    "openrouter.ai": "oai/openrouter",
    "api.groq.com": "oai/groq",
    "api.mistral.ai": "oai/mistral",
    "api.x.ai": "oai/xai",
    "api.together.xyz": "oai/together",
    ("localhost", 11434): "oai/ollama", ("127.0.0.1", 11434): "oai/ollama",
    ("localhost", 1234): "oai/lmstudio", ("127.0.0.1", 1234): "oai/lmstudio",
    "custom.example.com": "oai/custom",
}
# Asl yo'l prefiksini olib tashlash (masalan /openai/v1, /api/v1, /v1)
STRIP = ["/api/openai/v1", "/openai/v1", "/api/v1", "/v1"]


class Rewrite(httpx.AsyncBaseTransport):
    def __init__(self):
        self.inner = httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request):
        u = request.url
        target = HOSTS.get((u.host, u.port)) or (HOSTS.get(u.host) if u.port in (None, 443, 80) else None)
        if target:
            path = u.raw_path.decode()
            if target.startswith("oai/"):
                for s in STRIP:
                    if path.startswith(s + "/"):
                        path = path[len(s):]
                        break
            request.url = httpx.URL(f"{FAKE}/{target}{path}")
            request.headers["host"] = "127.0.0.1:9100"
        return await self.inner.handle_async_request(request)

    async def aclose(self):
        await self.inner.aclose()


_init = httpx.AsyncClient.__init__


def _patched(self, *a, **kw):
    if "transport" not in kw:
        kw["transport"] = Rewrite()
    _init(self, *a, **kw)


httpx.AsyncClient.__init__ = _patched

import uvicorn
from app.main import app

# Sinov: localhost'ning istalgan portidagi frontendga ruxsat (bir nechta dev server parallel ishlaydi)
for m in app.user_middleware:
    if m.cls.__name__ == "CORSMiddleware":
        m.kwargs["allow_origins"] = []
        m.kwargs["allow_origin_regex"] = r"http://(localhost|127\.0\.0\.1):\d+"
PORT = int(os.environ.get("BACKEND_PORT", "8000"))

uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
