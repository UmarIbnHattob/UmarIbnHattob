"""Ilova sozlamalari: .env faylidan o'qiladi."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://omniai:omniai@localhost:5432/omniai"
    frontend_origin: str = "http://localhost:3000"
    encryption_key: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
