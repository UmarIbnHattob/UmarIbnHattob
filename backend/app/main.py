"""FastAPI kirish nuqtasi. Ishga tushirish: uvicorn app.main:app --reload"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import health, keys

app = FastAPI(title="OmniAI Workspace API")

# Frontend (Next.js) backendga murojaat qilishi uchun CORS ruxsati
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(keys.router, prefix="/api")
