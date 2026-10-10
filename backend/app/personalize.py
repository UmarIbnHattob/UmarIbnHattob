"""Foydalanuvchi afzalliklari va ular asosida AI uchun tizim ko'rsatmasi (system prompt)."""
from typing import Literal

from pydantic import BaseModel, Field

from app.models import User

LANG_NAMES = {"uz": "Uzbek (Latin script)", "en": "English", "ru": "Russian"}


class Preferences(BaseModel):
    theme: Literal["system", "light", "dark"] = "system"
    language: Literal["uz", "en", "ru"] = "uz"  # interfeys tili
    response_language: Literal["auto", "uz", "en", "ru"] = "auto"  # AI javob tili
    # "auto", o'rnatilgan model id si yoki "cp:<provayder uuid>:<model id>"
    default_model: str | None = Field(
        default=None, max_length=300, pattern=r"^(auto|[A-Za-z0-9][\w.\-]*|cp:[0-9a-fA-F\-]{36}:\S+)$"
    )
    custom_instructions: str = Field(default="", max_length=3000)
    font_size: Literal["sm", "md", "lg"] = "md"
    send_with_enter: bool = True
    voice_auto_send: bool = True  # ovoz matnga aylangach darhol yuborilsin
    avatar_color: str = Field(default="#7c3aed", pattern=r"^#[0-9a-fA-F]{6}$")


def prefs_of(user: User) -> Preferences:
    """Bazadagi JSON ni tekshirib o'qiydi (eski/noto'g'ri qiymatlar standartga qaytadi)."""
    data = user.preferences or {}
    try:
        return Preferences(**data)
    except Exception:
        clean = {}
        for k, v in data.items():
            try:
                Preferences(**{k: v})
                clean[k] = v
            except Exception:
                continue
        return Preferences(**clean)


def system_prompt(user: User) -> str | None:
    """Ism, javob tili va shaxsiy ko'rsatmalardan chat uchun tizim ko'rsatmasi tuzadi."""
    p = prefs_of(user)
    parts = []
    name = user.nickname or user.display_name
    if name:
        parts.append(f"The user's name is {name}; address them that way when natural.")
    if p.response_language != "auto":
        parts.append(f"Always reply in {LANG_NAMES[p.response_language]} unless the user explicitly asks otherwise.")
    if p.custom_instructions.strip():
        parts.append("The user's personal instructions (follow them unless they conflict with safety):\n"
                     + p.custom_instructions.strip())
    return "\n\n".join(parts) or None
