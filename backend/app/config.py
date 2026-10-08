"""Ilova sozlamalari: .env faylidan o'qiladi."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./omniai.db"
    frontend_origin: str = "http://localhost:3000"
    encryption_key: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
