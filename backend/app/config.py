"""Ilova sozlamalari: .env faylidan o'qiladi."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://omniai:omniai@localhost:5432/omniai"
    frontend_origin: str = "http://localhost:3000"
    encryption_key: str = ""
    db_pool_size: int = 10
    db_max_overflow: int = 20
    # Sessiya (JWT) imzolash kaliti. Yaratish: python -c "import secrets; print(secrets.token_urlsafe(48))"
    secret_key: str = ""
    session_days: int = 7
    # HTTPS orqali joylashtirilganda true qiling
    cookie_secure: bool = False
    # Yangi ro'yxatdan o'tishni yopish uchun false qiling
    allow_registration: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
