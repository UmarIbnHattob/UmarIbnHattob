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


class ModelOut(BaseModel):
    id: str
    label: str
    provider: Provider


class ConversationOut(BaseModel):
    id: str
    title: str
    updated_at: datetime


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    model: str | None = None
    created_at: datetime


class SendMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=50000)
    model: str
