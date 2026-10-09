# OmniAI Workspace — Claude Code uchun yo'riqnoma

> Bu fayl har bir yangi Claude Code chatida avtomatik o'qiladi. Loyiha egasi: **Umar** (GitHub: UmarIbnHattob).
> Yangi chatda ishni shu yerdan davom ettiring.

## Foydalanuvchi bilan ishlash qoidalari (MUHIM)

- **Barcha izohlar va javoblar o'zbek tilida** (lotin). Kod, fayl nomlari, commit xabarlari — ingliz tilida.
  Koddagi izohlar (comments) — o'zbekcha, mavjud uslubda.
- Umar o'zini "yosh bola" deb tasavvur qilishni so'ragan: terminal buyruqlarini **bitta-bitta**, nima chiqishi
  kerakligini aytib, natijasini so'rab bering. Uzun buyruqlar ro'yxatini bir yo'la tashlamang.
- Umar Kali Linux'da ishlaydi (zsh, Python 3.14, Firefox/Chrome). Loyiha papkasi: `~/All-in-One AI Workspace`.
- Ish branchi: `claude/busy-planck-knbtir` (yoki sessiya bergan branch). Umar o'zida `git pull origin <branch>` qiladi.
- Har bir o'zgarishdan keyin: testlar → commit → push → Umarga qisqa o'zbekcha hisobot + uning kompyuterida
  yangilash buyruqlari (migratsiya bo'lsa `alembic upgrade head` ni eslating).
- Halollik: sinalmagan narsani "ishlaydi" demang. Haqiqiy API kalitlarisiz sinalgan joylarni alohida ayting.

## Loyiha nima

Bir joyda bir nechta AI modellar: chat (Claude, Deepseek, Gemini, OpenAI-mos provayderlar), agent rejimi
(desktop ilovada kompyuterdagi papka bilan ishlash), canvas + jonli HTML preview, rasm yaratish, ovozli buyruqlar,
ko'p foydalanuvchi (login), sozlamalar (mavzu, til uz/en/ru, shaxsiy ko'rsatmalar), foydalanish statistikasi.

## Arxitektura

```
backend/   FastAPI + SQLAlchemy 2 + PostgreSQL + Alembic (Python 3.13/3.14)
  app/main.py            routerlarni ulaydi
  app/routers/           auth, chat (SSE oqim), keys, me (profil/sozlamalar/eksport/statistika),
                         media (rasm), voice (ovoz->matn), agent (asbob chaqiruvli qadam), providers (custom)
  app/providers/         anthropic.py (RASMIY Anthropic SDK), deepseek.py, gemini.py, openai_compat.py,
                         registry.py (modellar ro'yxati), router_auto.py (Auto model tanlash)
  app/agent/             tools.py (asbob sxemalari), adapters.py (provayder formatlari)
  app/quota.py           kalit tanlash: o'z kaliti > platforma kaliti (oylik limit, atomar)
  app/personalize.py     foydalanuvchi sozlamalari -> system prompt
  tests/                 pytest (haqiqiy Postgres kerak: omniai_test bazasi)
frontend/  Next.js 14 (app router) + Tailwind + lucide-react
  src/lib/i18n.tsx       tarjimalar (uz asosiy; en, ru). Yangi matn qo'shsangiz — uchala tilga ham.
  src/components/AuthGate.tsx  login nazorati, profil, mavzu, tezkor tugmalar, oynalar
  src/app/{chat,agent,media,settings,login}
desktop/   Electron: src/main.js (oyna, menyu, IPC, ruxsat dialoglari), src/fsTools.js (papka ichida xavfsiz
           fayl asboblari), src/approval.js, src/preload.js (window.omniDesktop ko'prigi)
deploy/    Caddyfile, deploy.sh  (docker-compose.prod.yml — bitta domen, avtomatik HTTPS)
```

## Ishga tushirish (lokal)

```bash
# Postgres (Umarda o'rnatilgan): baza omniai / foydalanuvchi omniai / parol omniai
cd backend && .venv/bin/alembic upgrade head && .venv/bin/uvicorn app.main:app --reload   # :8000
cd frontend && npm run dev                                                                  # :3000
cd desktop && npm start                                                                     # Electron
```
`backend/.env` da `ENCRYPTION_KEY` (Fernet) va `SECRET_KEY` bo'lishi shart.

## Testlar

```bash
cd backend && .venv/bin/pytest -q          # omniai_test bazasi kerak (testlar jadvallarni tozalaydi!)
cd desktop && npm test                     # fayl asboblari xavfsizligi
cd frontend && npx tsc --noEmit && npx next lint && npm run build
```
Bulut sessiyada Postgres: `su postgres -c "pg_ctl -D /tmp/pgtest/data -o '-k /tmp/pgtest' start"` (initdb qilingan
bo'lsa). Brauzer sinovlari: Playwright (`/opt/pw-browsers/chromium`), Electron: `xvfb-run` + `--disable-gpu`.
**Diqqat:** `pkill -f mock_server` kabi buyruq o'z qobig'ini ham o'ldiradi — `pkill -f "[m]ock_server"` yozing.

## Qabul qilingan qarorlar (qayta muhokama qilmang)

1. **Obunalar (Claude Pro/Max, ChatGPT Plus, Google AI Pro) ilova ichida ishlatilmaydi.** Anthropic hujjati:
   "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate
   limits for their products". Obunalar API'ni o'z ichiga olmaydi; aylanib o'tish hisobni bloklatishi mumkin.
   Yechimlar: o'z API kaliti (BYOK), platforma kaliti + oylik limit, bepul/arzon yo'llar (Gemini API bepul darajasi,
   OpenRouter `:free` modellar, Groq, lokal Ollama/LM Studio, Deepseek arzon), va desktopda "Terminalda ochish"
   (foydalanuvchi o'z obunasi bilan rasmiy `claude` CLI ni O'ZI ishga tushiradi).
2. Claude chaqiruvlari faqat rasmiy Anthropic Python SDK orqali (`anthropic>=1`), `fallbacks: "default"` bilan.
3. Sessiya — httpOnly cookie (JWT, `token_version` bilan bekor qilinadi). Frontend va backend bitta domen ostida (Caddy).
4. Agent asboblari faqat desktopda bajariladi; yozish/buyruq uchun MAHALLIY dialogda ruxsat. Papkadan chiqish bloklangan.
5. Custom (OpenAI-mos) provayderlarda SSRF himoyasi: ichki/lokal manzillar faqat `ALLOW_LOCAL_PROVIDERS=true` bo'lsa.
6. Kulrang ranglar CSS o'zgaruvchilarida (`--n-*`) — yorug' mavzuda shkala teskari. Provayder ranglari `--p-*`.

## Keyingi ishlar (roadmap)

- To'lov tizimi (Payme/Click) bilan Pro tarif (platforma limitini oshirish).
- Video yaratish (Veo) — haqiqiy kalit bilan sinash kerak.
- Server xato xabarlarini ham tarjima qilish (hozir faqat o'zbekcha).
- Desktop ilovani imzolash (Windows/macOS sertifikatlari), avtomatik yangilanish.
- Haqiqiy API kalitlari bilan to'liq sinov (Claude/Gemini tool-calling, Gemini rasm, ovoz).

## Ish tarixi (qisqa)

Phase 1–5 (asos, baza, chat, canvas, media) → login → kod ko'rib chiqish + animatsiyalar → deploy (Docker+Caddy)
→ desktop + agent + ovoz + platforma kaliti → sozlamalar/menyu/mavzular/tillar → Auto model, 100+ model
(OpenRouter/OpenAI-mos/lokal), sayt yaratish ustasi. Batafsil: `git log`.
