# OmniAI Workspace

Bir joyda Claude, Deepseek va Gemini: chat, kod ko'rinishi, canvas va rasm yaratish.

## Ishga tushirish

**1. PostgreSQL** (Docker yoki o'rnatilgan): baza `omniai`, foydalanuvchi `omniai`, parol `omniai`.

```bash
docker compose up -d db
```

**2. Backend**

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # ENCRYPTION_KEY va SECRET_KEY ni to'ldiring (.env.example da buyruqlar bor)
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload
```

**3. Frontend**

```bash
cd frontend
cp .env.example .env.local
npm install && npm run dev
```

http://localhost:3000 ni oching, ro'yxatdan o'ting, **Settings** da API kalitlarni kiriting.

## Muhim

- `ENCRYPTION_KEY` yo'qolsa, saqlangan API kalitlarni qayta o'qib bo'lmaydi.
- `SECRET_KEY` o'zgarsa, hamma foydalanuvchi qayta kirishi kerak bo'ladi.
- HTTPS da joylashtirganda `COOKIE_SECURE=true` qiling. Ro'yxatdan o'tishni yopish: `ALLOW_REGISTRATION=false`.
