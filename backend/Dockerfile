# Backend (FastAPI) — ishlab chiqarish obrazi
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY migrations ./migrations
COPY app ./app

# root bo'lmagan foydalanuvchi
RUN useradd --create-home --uid 10001 omniai
USER omniai

EXPOSE 8000
# Ishga tushishda migratsiyalar avtomatik qo'llanadi.
# --proxy-headers: Caddy ortida foydalanuvchining haqiqiy IP sini ko'rish (login cheklovi uchun)
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*' --workers ${WEB_CONCURRENCY:-2}"]
