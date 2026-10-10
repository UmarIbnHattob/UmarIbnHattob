# Brauzer va Electron E2E sinovlari

Butun ilovani **haqiqiy API kalitlarisiz** sinaydi: backend soxta AI serveri (`../fake_upstream.py`) bilan ishlaydi,
frontend — production build. Har bir skript o'z foydalanuvchisini yaratadi va `PASS/FAIL` qatorlarini chiqaradi.

| Skript | Nimani sinaydi |
|---|---|
| `layout.mjs` | 375/768/1024/1280 px, yorug'/qorong'i: gorizontal aylantirish yo'q, menyu va suhbatlar drawer'i, preview paneli |
| `chat.mjs` | yuborish, `?c=` va reload, ikki marta bosish, To'xtatish, provayder xatosi, oflayn, o'chirilgan suhbat, nusxa, preview |
| `chat2.mjs` | suhbatlar ro'yxati (qidiruv, sahifalash, nomlash, o'chirish), Markdown xavfsizligi, uzun satrlar, havola kontrasti, en/ru |
| `canvas.mjs` | foydalanuvchiga bog'liq saqlash, rasm fayllari, panel yopiq holda ilova, logout'da tozalash, shriftlar CDN siz |
| `settings.mjs` | ModelSelector klaviaturasi, AI/kalitlar/provayderlar/statistika, 422 va tarmoq xatolari tarjimasi, 768 px |
| `media_auth.mjs` | Media Studio (sahifalash, lightbox), `?next=` va ochiq yo'naltirish himoyasi, 404, hisob menyusi, oynalar, eksport |
| `voice.mjs` | soxta mikrofon: bitta oqim, sahifadan chiqish, eskirgan closure, Esc qatlamlari, xato turlari, telefon kengligi |
| `model_restore.mjs` | standart model + reload'da tanlangan modelning saqlanishi |
| `electron_agent.mjs` | desktop ilova: agent papkada fayl yozadi, ruxsat dialoglari, rasmni qayta yozishda doim so'rash |

## Ishga tushirish

```bash
# 1) Postgres (omniai bazasi), soxta AI va backend
backend/.venv/bin/uvicorn fake_upstream:app --app-dir tools/e2e --port 9100 &
(source tools/e2e/env.sh && cd backend && .venv/bin/alembic upgrade head && .venv/bin/python ../tools/e2e/run_backend.py &)
# 2) Frontend (production build)
cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000/api npm run build && npx next start -p 3000 &
# 3) Sinovlar
cd tools/e2e/browser && npm install
npm test                 # brauzer sinovlari
npm run test:electron    # Electron (xvfb-run kerak; desktop/node_modules/electron o'rnatilgan bo'lsin)
```

Chromium yo'li: `CHROMIUM_PATH` (standart `/opt/pw-browsers/chromium`). Skrinshotlar: `E2E_SHOTS` yoki vaqtinchalik
papkadagi `omniai-e2e-shots/`. Soxta server jurnali umumiy (`GET :9100/_log`), shuning uchun skriptlar har safar noyob
matn ishlatadi.
