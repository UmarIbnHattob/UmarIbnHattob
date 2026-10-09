"""FastAPI kirish nuqtasi. Ishga tushirish: uvicorn app.main:app --reload"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import agent, auth, chat, health, keys, me, media, voice

app = FastAPI(title="OmniAI Workspace API")

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
