"""Mavjud modellar ro'yxati. Yangi model qo'shish uchun faqat shu faylni o'zgartiring."""
from app.models import Provider
from app.providers import anthropic, deepseek, gemini

MODELS = [
    {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5", "provider": Provider.anthropic},
    {"id": "claude-opus-5-5", "label": "Claude Opus 5.5", "provider": Provider.anthropic},
    {"id": "deepseek-chat", "label": "Deepseek Chat (kod uchun ham)", "provider": Provider.deepseek},
    {"id": "deepseek-reasoner", "label": "Deepseek Reasoner", "provider": Provider.deepseek},
    {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro", "provider": Provider.gemini},
    {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash", "provider": Provider.gemini},
]

STREAMERS = {
    Provider.anthropic: anthropic.stream_chat,
    Provider.deepseek: deepseek.stream_chat,
    Provider.gemini: gemini.stream_chat,
}


def find_model(model_id: str) -> dict | None:
    return next((m for m in MODELS if m["id"] == model_id), None)
