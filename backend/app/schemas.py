"""API so'rov/javob sxemalari (Pydantic)."""
from datetime import datetime

from pydantic import BaseModel, Field

from app.models import Provider


class ApiKeyIn(BaseModel):
    key: str = Field(min_length=8, max_length=500)


class ApiKeyOut(BaseModel):
    provider: Provider
    configured: bool
    last4: str | None = None
    updated_at: datetime | None = None
