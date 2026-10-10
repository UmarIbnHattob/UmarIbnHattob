"""AI so'rovlarini statistikaga yozish."""
import uuid

from app.database import SessionLocal
from app.models import UsageEvent


def record(user_id: uuid.UUID, kind: str, provider: str, model: str, platform: bool) -> None:
    """Alohida sessiyada yozadi: asosiy so'rov sessiyasi yopilgan bo'lishi mumkin. Xato so'rovni buzmaydi."""
    try:
        with SessionLocal() as s:
            s.add(UsageEvent(user_id=user_id, kind=kind, provider=provider, model=model, platform_key=platform))
            s.commit()
    except Exception:
        pass
