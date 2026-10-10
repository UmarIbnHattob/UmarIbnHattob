"""API kalitlarni shifrlash/deshifrlash (Fernet, simmetrik)."""
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def _fernet() -> Fernet:
    if not settings.encryption_key:
        raise RuntimeError("ENCRYPTION_KEY .env faylida sozlanmagan")
    return Fernet(settings.encryption_key.encode())


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Kalitni deshifrlab bo'lmadi (ENCRYPTION_KEY o'zgargan bo'lishi mumkin)") from exc
