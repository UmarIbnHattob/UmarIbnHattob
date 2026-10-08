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

## Testlar

```bash
cd backend
.venv/bin/pip install -r requirements-dev.txt
# alohida test bazasi kerak (testlar jadvallarni tozalaydi!)
sudo -u postgres psql -c "CREATE DATABASE omniai_test OWNER omniai;"
.venv/bin/pytest -q
```

## Deploy (internetga chiqarish)

Kerak: Docker o'rnatilgan Linux server (VPS) va unga yo'naltirilgan domen (DNS `A` yozuvi → server IP).

```bash
git clone <repo> omniai && cd omniai
./deploy/deploy.sh sizning-domen.uz
```

Skript birinchi marta `.env.prod` ni yaratadi (barcha maxfiy kalitlar avtomatik), so'ng
PostgreSQL, backend, frontend va Caddy (avtomatik HTTPS) ni ishga tushiradi.
Yangilash: `git pull && ./deploy/deploy.sh`.

- `.env.prod` ni **zaxiralang**: unda `ENCRYPTION_KEY` bor — yo'qolsa, foydalanuvchilarning API kalitlari o'qilmaydi.
- Bazani zaxiralash: `docker compose -f docker-compose.prod.yml exec db pg_dump -U omniai omniai > backup.sql`
- Birinchi bo'lib o'zingiz ro'yxatdan o'ting; keyin kerak bo'lsa `ALLOW_REGISTRATION=false`.

## API kalitlar: kim to'laydi?

Claude Pro/Max kabi **obunalarni boshqa ilovaga ulab bo'lmaydi**: Anthropic uchinchi tomon ilovalariga
claude.ai login yoki obuna limitlarini taklif qilishni ruxsatsiz taqiqlaydi. Ilova faqat API kalit bilan ishlaydi.
Ikki rejim bor (birga ishlaydi):

1. **O'z kaliti (BYOK)** — foydalanuvchi Settings sahifasida o'z kalitini kiritadi va o'zi to'laydi.
2. **Platforma kaliti** — siz `.env.prod` da `PLATFORM_*_KEY` ni to'ldirasiz; kaliti yo'q foydalanuvchilar
   oyiga `FREE_MONTHLY_REQUESTS` ta so'rovni bepul ishlatadi (Settings da progress ko'rinadi).
   Pullik tariflar (Payme/Click) keyingi bosqichda shu limit ustiga quriladi.

## Desktop ilova va Agent rejimi

`desktop/` — Electron ilova. U veb-ilovani ochadi va **Agent** sahifasiga kompyuterdagi papka bilan ishlash
imkonini beradi: AI fayllarni ko'radi, o'qiydi, qidiradi, yozadi va buyruq ishga tushiradi.

- Papka faqat **mahalliy dialog** orqali tanlanadi; AI undan tashqariga chiqa olmaydi (`../`, symlink bloklangan).
- Har bir yozish va buyruq uchun **kompyuterning o'z oynasida** ruxsat so'raladi (veb-sahifa buni chetlab o'ta olmaydi).

```bash
cd desktop
npm install
OMNIAI_URL=http://localhost:3000 npm start   # ishlab chiqishda
npm test                                     # fayl asboblari xavfsizlik testlari
```

O'rnatish fayllari (Windows `.exe`, macOS `.dmg`, Linux `.AppImage/.deb`): GitHub > Actions > **Desktop build** >
Run workflow (server manzilini kiriting). Tayyor fayllar workflow artefaktlarida bo'ladi.

## Ovozli buyruqlar

Chat va Agent'da mikrofon tugmasi: gapiring, to'xtating — matn kiritish maydoniga tushadi (o'zbek, rus, ingliz).
Ovoz brauzerda 16 kHz WAV ga aylantiriladi va Gemini orqali matnga o'giriladi (Gemini kaliti yoki platforma kaliti kerak).
