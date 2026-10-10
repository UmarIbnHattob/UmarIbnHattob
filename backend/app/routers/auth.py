"""Ro'yxatdan o'tish, kirish, chiqish va joriy foydalanuvchi."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import COOKIE_NAME, LEGACY_EMAIL, get_current_user
from app.models import User
from app.security import create_token, hash_password, login_limiter, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: str
    email: str


def _set_cookie(response: Response, user: User) -> None:
    try:
        token = create_token(str(user.id), user.token_version)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,  # JavaScript o'qiy olmaydi (XSS dan himoya)
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=201)
def register(body: Credentials, response: Response, db: Session = Depends(get_db)):
    if not settings.allow_registration:
        raise HTTPException(403, "Ro'yxatdan o'tish yopilgan.")
    email = body.email.lower()
    taken = "Bu email allaqachon ro'yxatdan o'tgan."
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, taken)

    password_hash = hash_password(body.password)
    # Eski (loginsiz) ma'lumotlar yo'qolmasin: birinchi ro'yxatdan o'tgan odam ularni oladi.
    # Qator qulflanadi: bir vaqtda ikki kishi ro'yxatdan o'tsa, faqat bittasi oladi.
    legacy = db.scalar(select(User).where(User.email == LEGACY_EMAIL).with_for_update())
    if legacy is not None and legacy.password_hash is None:
        legacy.email, legacy.password_hash = email, password_hash
        user = legacy
    else:
        user = User(email=email, password_hash=password_hash)
        db.add(user)
    try:
        db.commit()
    except IntegrityError:  # shu email bilan parallel ro'yxatdan o'tish (UNIQUE email)
        db.rollback()
        raise HTTPException(409, taken)
    db.refresh(user)
    _set_cookie(response, user)
    return UserOut(id=str(user.id), email=user.email)


@router.post("/login", response_model=UserOut)
def login(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.lower()
    key = f"{request.client.host if request.client else '?'}|{email}"
    if login_limiter.blocked(key):
        raise HTTPException(429, "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring.")

    user = db.scalar(select(User).where(User.email == email))
    if not verify_password(body.password, user.password_hash if user else None):
        login_limiter.fail(key)
        raise HTTPException(401, "Email yoki parol noto'g'ri.")
    login_limiter.reset(key)
    _set_cookie(response, user)
    return UserOut(id=str(user.id), email=user.email)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut(id=str(user.id), email=user.email)
