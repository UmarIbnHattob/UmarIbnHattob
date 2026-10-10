"""FastAPI kirish nuqtasi. Ishga tushirish: uvicorn app.main:app --reload"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings
from app.routers import agent, auth, chat, health, keys, me, media, providers, voice


class NoStoreMiddleware:
    """/api javoblari brauzer keshida saqlanmasin: chiqqandan keyin "Orqaga" eski foydalanuvchi ma'lumotini ko'rsatmasin.

    O'z siyosatini bergan javoblar (media fayl: private, no-cache + ETag; SSE: no-cache) o'zgartirilmaydi.
    Sof ASGI: SSE oqimi va mijoz uzilishini aniqlashga xalaqit bermaydi (BaseHTTPMiddleware'dan farqli).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api"):
            await self.app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_header)


app = FastAPI(title="OmniAI Workspace API")
app.add_middleware(NoStoreMiddleware)

# Frontend (Next.js) backendga murojaat qilishi uchun CORS ruxsati
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,  # cookie yuborish uchun
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(keys.router, prefix="/api")
app.include_router(keys.usage_router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(media.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(agent.router, prefix="/api")
app.include_router(voice.router, prefix="/api")
app.include_router(me.router, prefix="/api")
app.include_router(providers.router, prefix="/api")
