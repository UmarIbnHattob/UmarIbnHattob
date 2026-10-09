"""Joriy foydalanuvchi: sessiya cookie'sidan olinadi."""
import uuid

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import read_token

COOKIE_NAME = "omniai_session"
# Login qo'shilishidan oldingi standart foydalanuvchi (ma'lumotlarini birinchi ro'yxatdan o'tgan odam oladi)
LEGACY_EMAIL = "local@omniai.dev"


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    parsed = read_token(token) if token else None
    user = None
    if parsed:
        try:
            user = db.get(User, uuid.UUID(parsed[0]))
        except ValueError:
            user = None
        # Parol o'zgargan yoki "barcha qurilmalardan chiqish" bosilgan bo'lsa eski token yaroqsiz
        if user is not None and user.token_version != parsed[1]:
            user = None
    if user is None:
        raise HTTPException(status_code=401, detail="Kirish talab qilinadi")
    return user
