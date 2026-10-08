"""Joriy foydalanuvchi.

Hozircha autentifikatsiya yo'q: bitta standart foydalanuvchi ishlatiladi.
Keyinchalik (login qo'shilganda) faqat shu funksiyani almashtirish yetarli.
"""
from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

DEFAULT_EMAIL = "local@omniai.dev"


def get_current_user(db: Session = Depends(get_db)) -> User:
    user = db.scalar(select(User).where(User.email == DEFAULT_EMAIL))
    if user is None:
        user = User(email=DEFAULT_EMAIL)
        db.add(user)
        db.commit()
    return user
