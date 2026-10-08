"""SQLAlchemy engine, sessiya va Base klassi."""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# pool_pre_ping: uzilgan ulanishlarni avtomatik tiklaydi
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: har bir so'rov uchun bitta sessiya."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
