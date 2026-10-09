"""Test sozlamalari: haqiqiy PostgreSQL kerak (TEST_DATABASE_URL yoki DATABASE_URL).

Ishga tushirish:  .venv/bin/pytest -q
Diqqat: testlar `users` jadvalini tozalaydi — ishlab turgan bazada ishga tushirmang!
"""
import os

from cryptography.fernet import Fernet

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://omniai:omniai@localhost:5432/omniai_test"
)
os.environ["ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough-0123456789"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.providers import registry  # noqa: E402
from app.security import login_limiter  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def schema():
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def clean_db():
    with engine.begin() as c:
        c.execute(text("TRUNCATE users CASCADE"))
    login_limiter._fails.clear()
    yield


@pytest.fixture
def fake_llm(monkeypatch):
    """Haqiqiy API o'rniga: kelgan tarixni yozib oladi va 'Salom dunyo' qaytaradi."""
    calls = []

    async def fake(api_key, model, messages, system=None):
        calls.append({"key": api_key, "model": model, "messages": messages, "system": system})
        for w in ["Salom ", "dunyo"]:
            yield w

    for p in list(registry.STREAMERS):
        monkeypatch.setitem(registry.STREAMERS, p, fake)
    return calls


def make_client(email="ali@example.com", password="parol12345") -> TestClient:
    c = TestClient(app)
    r = c.post("/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    return c


@pytest.fixture
def client():
    return make_client()


@pytest.fixture
def anyio_backend():
    return "asyncio"
