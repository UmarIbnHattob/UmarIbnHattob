"""Profil, afzalliklar, xavfsizlik (parol, sessiyalar), eksport va hisobni o'chirish."""
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.catalog import catalog
from app.config import settings
from app.database import get_db
from app.deps import COOKIE_NAME, get_current_user
from app.models import ApiKey, Conversation, CustomProvider, MediaItem, Provider, UsageEvent, User
from app.personalize import Preferences, prefs_of
from app.providers.presets import PRESETS
from app.quota import current_month, platform_key, used_this_month
from app.routers.auth import _set_cookie
from app.security import hash_password, verify_password

router = APIRouter(tags=["me"])


class MeOut(BaseModel):
    id: str
    email: str
    display_name: str | None
    nickname: str | None
    preferences: Preferences
    created_at: datetime
    own_keys: list[Provider]
    platform_providers: list[Provider]
    plan: str  # "byok" (o'z kalitlari) | "free" (platforma limiti) | "none"


def _me(db: Session, user: User) -> MeOut:
    own = [k.provider for k in db.scalars(select(ApiKey).where(ApiKey.user_id == user.id))]
    platform = [p for p in Provider if platform_key(p)]
    plan = "byok" if own else ("free" if platform else "none")
    return MeOut(
        id=str(user.id), email=user.email, display_name=user.display_name, nickname=user.nickname,
        preferences=prefs_of(user), created_at=user.created_at, own_keys=own, platform_providers=platform, plan=plan,
    )


@router.get("/me", response_model=MeOut)
def get_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _me(db, user)


class MePatch(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    nickname: str | None = Field(default=None, max_length=60)
    preferences: dict | None = None  # qisman yangilash


@router.patch("/me", response_model=MeOut)
def patch_me(body: MePatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fields = body.model_fields_set
    if "display_name" in fields:
        user.display_name = (body.display_name or "").strip() or None
    if "nickname" in fields:
        user.nickname = (body.nickname or "").strip() or None
    if body.preferences is not None:
        current = prefs_of(user)
        merged = {**current.model_dump(), **body.preferences}
        try:
            prefs = Preferences(**merged)
        except Exception as exc:
            raise HTTPException(422, f"Noto'g'ri sozlama: {exc}")
        # Yangi standart model haqiqatan mavjud bo'lsin (o'chirilgan provayder yoki xato id saqlanmasin)
        dm = prefs.default_model
        if dm not in (None, "auto", current.default_model) and dm not in {m["id"] for m in catalog(db, user)}:
            raise HTTPException(422, f"Noma'lum model: {dm}")
        user.preferences = prefs.model_dump()
    db.commit()
    db.refresh(user)
    return _me(db, user)


class PasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/me/password", status_code=204)
def change_password(body: PasswordIn, response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Joriy parol noto'g'ri.")
    if body.new_password == body.current_password:
        raise HTTPException(400, "Yangi parol joriy paroldan farq qilishi kerak.")
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1  # boshqa qurilmalardagi sessiyalar bekor bo'ladi
    db.commit()
    _set_cookie(response, user)  # shu qurilmada kirgan holda qolamiz


@router.post("/me/logout-all", status_code=204)
def logout_all(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user.token_version += 1
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


class DeleteIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


@router.delete("/me", status_code=204)
def delete_account(body: DeleteIn, response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(400, "Parol noto'g'ri.")
    db.delete(user)  # suhbatlar, kalitlar, rasmlar, statistika — hammasi CASCADE bilan o'chadi
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me/export")
def export_data(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Barcha ma'lumotlar JSON faylda (API kalitlar va rasm baytlari kirmaydi)."""
    convs = db.scalars(select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.created_at))
    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": {"email": user.email, "display_name": user.display_name, "nickname": user.nickname,
                    "created_at": user.created_at.isoformat(), "preferences": prefs_of(user).model_dump()},
        "conversations": [
            {"title": c.title, "created_at": c.created_at.isoformat(), "messages": [
                {"role": m.role.value, "model": m.model, "content": m.content, "created_at": m.created_at.isoformat()}
                for m in c.messages
            ]}
            for c in convs
        ],
        "media": [
            {"prompt": m.prompt, "model": m.model, "created_at": m.created_at.isoformat()}
            for m in db.scalars(select(MediaItem).where(MediaItem.user_id == user.id))
        ],
    }
    name = f"omniai-export-{datetime.now(timezone.utc):%Y-%m-%d}.json"
    return Response(
        content=json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.delete("/conversations", status_code=204)
def delete_all_conversations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.execute(delete(Conversation).where(Conversation.user_id == user.id))
    db.commit()


STAT_LABELS = {"anthropic": "Claude", "deepseek": "Deepseek", "gemini": "Gemini", "whisper": "Whisper"}


@router.get("/usage/stats")
def usage_stats(days: int = 14, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Kunlar va provayderlar bo'yicha so'rovlar soni + model/tur bo'yicha jami."""
    days = max(1, min(days, 90))
    since = datetime.now(timezone.utc) - timedelta(days=days - 1)
    since = since.replace(hour=0, minute=0, second=0, microsecond=0)
    day = func.date_trunc("day", UsageEvent.created_at).label("day")
    base = select().where(UsageEvent.user_id == user.id, UsageEvent.created_at >= since)
    per_day = db.execute(
        base.add_columns(day, UsageEvent.provider, func.count()).group_by(day, UsageEvent.provider)
    ).all()
    by_model = db.execute(
        base.add_columns(UsageEvent.model, func.count()).group_by(UsageEvent.model).order_by(func.count().desc())
    ).all()
    by_kind = db.execute(base.add_columns(UsageEvent.kind, func.count()).group_by(UsageEvent.kind)).all()
    series, totals = {}, {}
    for d, provider, n in per_day:
        series.setdefault(d.date().isoformat(), {})[provider] = n
        totals[provider] = totals.get(provider, 0) + n
    # Seriya kalitlari: o'rnatilganlar, "whisper" (ovoz) va custom provayder turlari (openrouter, groq, ollama...).
    # UI har qanday kalitni ko'rsata olishi uchun nomlari ham beriladi.
    names: dict[str, list[str]] = {}
    for cp in db.scalars(select(CustomProvider).where(CustomProvider.user_id == user.id).order_by(CustomProvider.created_at)):
        names.setdefault(cp.kind, []).append(cp.name)
    labels = {
        p: STAT_LABELS.get(p) or ", ".join(dict.fromkeys(names.get(p, []))) or PRESETS.get(p, {}).get("name") or p
        for p in totals
    }
    return {
        "days": [(since + timedelta(days=i)).date().isoformat() for i in range(days)],
        "series": series,
        "providers": sorted(totals, key=lambda p: (-totals[p], p)),  # ko'pdan kamga
        "labels": labels,
        "total": sum(totals.values()),
        "by_model": [{"model": m, "count": n} for m, n in by_model],
        "by_kind": {k: n for k, n in by_kind},
        "quota": {"month": current_month(), "used": used_this_month(db, user), "limit": settings.free_monthly_requests},
    }
