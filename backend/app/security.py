"""Parol xeshlash (scrypt), sessiya tokeni (JWT) va login urinishlarini cheklash."""
import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

import jwt

from app.config import settings

# scrypt parametrlari (OWASP tavsiyasi: N=2**15, r=8, p=1)
_N, _R, _P = 2**15, 8, 1


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=2**26, dklen=32)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str | None) -> bool:
    """Doim bir xil ish qiladi (hatto `stored` yo'q bo'lsa ham): foydalanuvchi bor-yo'qligi vaqtdan sezilmasin."""
    if not stored:
        hashlib.scrypt(password.encode(), salt=b"\0" * 16, n=_N, r=_R, p=_P, maxmem=2**26, dklen=32)
        return False
    try:
        _, n, r, p, salt, expected = stored.split("$")
        dk = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), maxmem=2**26, dklen=32
        )
        return hmac.compare_digest(dk, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


def create_token(user_id: str) -> str:
    if not settings.secret_key:
        raise RuntimeError("SECRET_KEY .env faylida sozlanmagan")
    exp = int(time.time()) + settings.session_days * 86400
    return jwt.encode({"sub": user_id, "exp": exp}, settings.secret_key, algorithm="HS256")


def read_token(token: str) -> str | None:
    """Token to'g'ri va muddati o'tmagan bo'lsa user_id, aks holda None."""
    if not settings.secret_key:
        return None
    try:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"]).get("sub")
    except jwt.PyJWTError:
        return None


class LoginLimiter:
    """Xotiradagi oddiy cheklov: oynada `limit` martadan ko'p muvaffaqiyatsiz urinish bo'lsa bloklaydi.

    Bitta jarayon uchun. Bir nechta server bo'lsa, Redis kabi umumiy saqlash kerak bo'ladi.
    """

    def __init__(self, limit: int = 5, window: int = 900):
        self.limit, self.window = limit, window
        self._fails: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str) -> deque[float]:
        q, now = self._fails[key], time.time()
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        return len(self._prune(key)) >= self.limit

    def fail(self, key: str) -> None:
        self._prune(key).append(time.time())

    def reset(self, key: str) -> None:
        self._fails.pop(key, None)


login_limiter = LoginLimiter()
