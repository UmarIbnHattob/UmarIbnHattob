# HANDOFF — ishni davom ettirish yo'riqnomasi (Claude uchun)

> Bu faylni o'qiyotgan Claude: oldingi sessiya (boshqa profil) limit tugagani sababli to'xtadi.
> Umar ishni **aynan shu joydan, kamchiliksiz** davom ettirishni so'radi. Avval `CLAUDE.md` ni, keyin shu faylni
> to'liq o'qing. Umar bilan o'zbek tilida, buyruqlarni bitta-bitta berib gaplashing (CLAUDE.md qoidalari).
> Ish branchi: `claude/busy-planck-knbtir` (PR: UmarIbnHattob/UmarIbnHattob#1). Faqat shu branchga push qiling.

## 1. Umar nima so'radi

"Barcha funksiyalarni o'zing test qilib chiq" → to'liq E2E sinov kampaniyasi o'tkazildi (soxta AI provayderlar bilan),
141 ta topilma chiqdi (`handoff/findings.json`), ular tuzatilmoqda. Maqsad: **hamma topilmalar tuzatilgan, qayta
sinalgan, push qilingan** holat va Umarga o'zbekcha hisobot + yangilash buyruqlari.

## 2. Hozirgi holat (shu commitgacha)

| Bosqich | Holat |
|---|---|
| E2E sinov (8 bo'lim: auth, chat, models, canvas, settings, voice, agent, quality) | ✅ tugagan. Natijalar: `handoff/findings.json` (`reports` — 8 hisobot, `verdicts` — auth/chat/models/canvas uchun mustaqil tasdiq; settings/voice/agent/quality topilmalari mustaqil tasdiqlanmagan — tuzatishdan oldin qayta tekshiring) |
| 1-bosqich backend tuzatishlari (`0b741e9`) | ✅ merge qilingan |
| 1-bosqich agent/desktop tuzatishlari (`bc3bcf9`) | ✅ merge qilingan |
| 2-bosqich backend (review izohlari) (`aea6c06`) | ✅ merge qilingan, **lekin mustaqil code review hali qilinmagan** → 4-bo'lim, 1-qadam |
| 2-bosqich agent/desktop (review izohlari) (`4440bd2`) | ✅ merge qilingan, **mustaqil review hali qilinmagan** |
| 2-bosqich **chat-ui** (responsive layout, chat, canvas, ovoz…) | 🔄 CHALA. Qisman ish: `handoff/wip/chat-ui.patch` (commit qilinmagan, sinalmagan) |
| 2-bosqich **settings-ui** (sozlamalar, model tanlagich, media, i18n, kontrast…) | 🔄 CHALA (deyarli boshlanmagan). Qisman ish: `handoff/wip/settings-ui.patch` |
| Yakuniy to'liq qayta sinov (E2E) | ⏳ qilinmagan |
| Umarga yakuniy hisobot | ⏳ qilinmagan |

Backend testlari: 2-bosqichdan keyin hammasi o'tishi kerak (`cd backend && .venv/bin/pytest -q`; 1-bosqichdan keyin 160 ta edi).
Yangi migratsiya: `6a868a3c4f0f` (model ustunlari 300 belgi + `ix_conversations_user_updated` indeksi) — Umar
`alembic upgrade head` qilishi shart.

Backend API o'zgarishlari (frontend shunga moslanishi kerak): **`handoff/api_changes.md`** — majburiy o'qing.

## 3. Qolgan ishlar — to'liq ro'yxat

Har bir guruhning **to'liq topshirig'i** (fayl egaligi, har bir band, tekshirish usuli) `handoff/round2_workflow.js`
ichidagi `GROUPS` massivida (`chatui` va `settingsui` elementlarining `task` matni). O'sha matnlarni aynan bajaring.
Qisqacha:

### 3.1 chat-ui (egalik: Sidebar.tsx, AuthGate.tsx, ChatView.tsx, Markdown.tsx, CodePreview.tsx, CanvasPanel.tsx, VoiceButton.tsx, useChat.ts, useResizable.ts, chatApi.ts, codeBlocks.ts, app/chat/**, app/layout.tsx)
1. **Responsive layout (HIGH)**: md dan kichikda sidebar → hamburger drawer; lg dan kichikda suhbatlar ro'yxati → drawer; xl dan kichikda preview panel yopiq/overlay; useResizable oyna o'lchamiga moslashsin. 375/768/1024/1280 da /chat /agent /media /settings ishlashi shart.
2. Ikki marta "Yuborish" bosish → Stop bosilib ketmasin (~500ms himoya); canvas bilan ikki marta yuborilmasin; "fly" animatsiyasi yuborishda.
3. `user_message_removed` SSE bayrog'i: xato/bekor qilinganda user+assistant pufaklarini olib tashlash va matnni inputga qaytarish; oflayn holat; yangi suhbatning birinchi yuborishi muvaffaqiyatsiz bo'lsa bo'sh suhbat qolmasin; "New chat" i18n.
4. Oqim xatolari (network error, ERR_INCOMPLETE_CHUNKED_ENCODING) → tarjima qilingan do'stona xabar; o'chirilgan suhbat (404) → yangi suhbat + ogohlantirish.
5. Suhbatlar ro'yxati: qidiruv (`?q=`), "yana yuklash" (`?before=&before_id=`), qayta nomlash (`PATCH /conversations/{id}`), o'chirishni tasdiqlash, klaviatura/sensorli ekranda ham ko'rinadigan tugmalar.
6. Faol suhbat URL'da (`/chat?c=<id>`), reload'da qayta ochilsin.
7. Kod bloklari va javoblar uchun "Nusxalash" tugmasi.
8. Uzun so'zlar pufakdan chiqib ketmasin (overflow-wrap:anywhere, min-w-0).
9. Markdown xavfsizligi: tashqi http(s) rasmlar avtomatik yuklanmasin; faqat `omni-media://<uuid>` (regex) va kichik `data:image/*`.
10. Yorug' mavzuda havolalar o'qiladigan rangda.
11. Preview: JS ichidagi `</script` va CSS ichidagi `</style` escape; iframe title tarjimasi.
12. Preview/Canvas tablarida faolini ko'rsatish; `chat.preview`/`chat.canvas` en/ru tarjimalari.
13. Canvas: localStorage kaliti foydalanuvchiga bog'liq (`omniai-canvas-v1:<userId>`), logout/hisob o'chirishda tozalash; Excalidraw fayllari (`getFiles`) saqlansin; `langCode`; panel yopiq bo'lsa ham canvas ilova qilinsin; vision ogohlantirishi bir marta.
14. Ovoz: eskirgan closure (onText ref orqali), sahifadan chiqilganda bekor qilish, ikki marta bosishda ikki oqim ochilmasin, eski "ruxsat yo'q" xabarini tozalash, NotFoundError vs NotAllowedError, Esc faqat boshqa qatlam ishlatmasa, waveform chizilishi, yozish vidjeti kengligi.
15. Auto route: SSE `kind` bo'yicha tarjima qilingan sabab; `gemini-2.5-flash-image` uchun to'g'ri nom/rang (reloaddan keyin ham).
16. AuthGate: logout bo'lganda `/login?next=<path>` (faqat `/` bilan boshlanadigan, `//` emas).

### 3.2 settings-ui (egalik: app/settings/**, components/settings/**, ModelSelector.tsx, AccountMenu.tsx, Modals.tsx, app/media/**, app/login/**, app/not-found.tsx, lib/api.ts, lib/me.ts, lib/providers.ts, lib/date.ts, globals.css)
1. `api.ts`: 422 `detail` massivini o'qiladigan tarjima xabarga; umumiy/tarmoq xatolari tarjima ("uvicorn" so'zi yo'q); `cache: 'no-store'`.
2. `me.ts` initials emoji-xavfsiz (`Array.from(w)[0]`).
3. O'zbekcha sanalar (`lib/date.ts`, Chromium'da uz-Latn oy nomlari yo'q): AccountTab, UsageTab.
4. Tarjima qilingan 404 sahifa.
5. PrivacyTab eksport: fetch+Blob, 401 da toast.
6. Login: `?next=` xavfsiz bo'lsa o'sha yerga, aks holda /chat.
7. Segmented control: pill faol tugmani o'lchab joylashsin.
8. Settings layout: ikki ustun lg dan; Row tor ekranda o'ralsin; kichik ekranda faol tab scrollIntoView; `?tab=providers` scroll ma'lumot yuklangach (≤3s, timerlar tozalansin).
9. AiTab: katta grid o'rniga ModelSelector + "Auto" varianti + mavjudlik (`available`/`unavailable_reason`); saqlanmagan ko'rsatmalar haqida ogohlantirish.
10. ModelSelector: strelka/Enter, listbox/option ARIA, "natija yo'q", sanoq, 200 cheklovi haqida xabar, kontrast, mavjud emaslar belgisi.
11. ProvidersTab: preset nomi/izohini frontendda kind bo'yicha tarjima; ru/en ko'plik shakllari; "(ixtiyoriy)" tarjimasi; `<form>` (Enter); maxLength 60; o'chirishda tasdiq + busy + toast; **tahrirlash (PATCH /providers/{pid})**; 409 xabari; lokal kartalarda "↗" o'rniga matn; kontrast.
12. KeysTab: saqlash paytida tugma o'chiq; uzunlik tekshiruvi; o'chirishda tasdiq + toast; `•••• last4` kontrasti; `platform_exhausted`.
13. UsageTab: `/usage/stats` dagi `providers`, `labels`, `total` — custom provayderlar va Whisper ham hisobga olinsin.
14. Tezkor tugmalar ro'yxati `send_with_enter` ga mos; Shortcuts tabida sarlavha.
15. AccountMenu: ichki Item komponentini tashqariga chiqarish; submenu click/Enter/Space/ArrowRight/tap bilan; aria; tor ekranda joylashuv.
16. Modals: fokus, Tab trap, fokusni qaytarish, role=dialog aria-modal, tarjima qilingan "yopish", Help birinchi savol ochiq, Ctrl+, modalni yopsin.
17. Media: "yana yuklash" (`?before=&before_id=`), prompt maxLength 4000 + sanagich, o'chirishda tasdiq, rasmni katta ko'rish (lightbox), Ctrl+Enter, "Media Studio" tarjimasi, yorug' mavzuda "yaratilmoqda" kartasi.
18. `globals.css` yorug' mavzu kontrasti (emerald/red/amber-400 matnlar), qorong'i mavzuda kichik hint matnlar (n-400), placeholderlar; `.markdown` uchun overflow-wrap:anywhere, min-width:0, `pre` overflow-x:auto.

### 3.3 Review qilinmagan commitlar
- `git diff 0b741e9..aea6c06` (backend 2-bosqich) va `git diff bc3bcf9..4440bd2` (agent/desktop 2-bosqich) ni qattiq ko'rib chiqing: race, xavfsizlik, API mosligi. Topilganini tuzating.

### 3.4 Yakuniy to'liq qayta sinov
`handoff/e2e_workflow.js` — 8 bo'limli E2E sinov ssenariysi (har bo'lim uchun nima sinalishi to'liq yozilgan).
`<FT>` o'rniga o'zingizning sinov papkangizni qo'ying. Har bir `findings.json` topilmasi yopilganini tasdiqlang,
regressiya bo'lsa tuzating.

### 3.5 Yakunlash
1. `handoff/wip/` ni o'chiring; `handoff/` qolgan hujjatlarini `docs/` ga ko'chiring yoki o'chiring; CLAUDE.md dagi
   "DAVOM ETTIRISH" bo'limini olib tashlang, "Ish tarixi" ni yangilang.
2. Testlar: `backend pytest`, `desktop npm test`, `frontend tsc + next lint + npm run build`.
3. Commit + `git push -u origin claude/busy-planck-knbtir`.
4. Umarga o'zbekcha qisqa hisobot (nima tuzatildi, nima sinaldi, haqiqiy API kalitsiz nima sinalmagan) va
   yangilash buyruqlarini **bitta-bitta**: `git pull origin claude/busy-planck-knbtir` →
   `cd backend && .venv/bin/pip install -r requirements.txt` → `.venv/bin/alembic upgrade head` → backend qayta ishga
   tushirish → `cd frontend && npm install` (agar package.json o'zgargan bo'lsa) → `npm run dev` → desktop `npm start`.

## 4. Qanday davom ettirish (amaliy)

### 4.1 Chala ishni tiklash
```bash
git checkout claude/busy-planck-knbtir && git pull
git apply --3way handoff/wip/chat-ui.patch      # ixtiyoriy: chala, sinalmagan ish
git apply --3way handoff/wip/settings-ui.patch  # ixtiyoriy
```
Patchlar to'liq emas va sinalmagan — har bir o'zgarishni ko'rib chiqing; kerak bo'lsa noldan qiling.

### 4.2 Sinov muhiti (soxta AI provayderlar) — `tools/e2e/`
Haqiqiy API kalitlarisiz butun ilovani sinash uchun:
```bash
# Postgres: omniai (dev), omniai_test (pytest) bazalari kerak; omniai/omniai foydalanuvchi
backend/.venv/bin/uvicorn fake_upstream:app --app-dir tools/e2e --port 9100 &     # soxta Claude/Gemini/OpenAI/...
(source tools/e2e/env.sh && cd backend && .venv/bin/alembic upgrade head && .venv/bin/python ../tools/e2e/run_backend.py &)  # :8000
cd frontend && npm run build && npx next start -p 3000 &
```
`run_backend.py` backenddagi barcha tashqi AI so'rovlarini `127.0.0.1:9100` ga yo'naltiradi (Anthropic SDK —
`ANTHROPIC_BASE_URL` orqali, qolganlari httpx transport orqali). Backend kodi o'zgarmaydi. `fake_upstream.py` boshidagi
docstring qoidalarni yozadi (kalitda "bad" → 401, "rate" → 429; xabarda "html", "uzun", "xato500", "SYSTEMCHECK",
"refuse"; agent ssenariysi: list_dir → write_file hello.txt → yakun; "rasm"/"ekspert"/"reja"). `GET :9100/_log` —
backend nima yuborganini ko'rsatadi. Brauzer sinovi: Playwright (`/opt/pw-browsers/chromium` bulutda), Electron:
`xvfb-run -a` + `--no-sandbox --disable-gpu`.

### 4.3 Parallel ishlash bo'yicha saboqlar (oldingi sessiyadan)
- Workflow `isolation: 'worktree'` **ishlatmang**: u `main` dagi "Initial commit" (faqat README) asosida worktree
  ochdi. Worktree'larni o'zingiz yarating: `git worktree add -b fix/x /home/user/wt-x HEAD` va unda
  `backend/.venv`, `frontend/node_modules`, `desktop/node_modules` ga symlink qiling (`.git/info/exclude` ga qo'shing).
  Worktree'larni repo ichida (`.claude/`) qoldirmang — stop-hook "untracked files" deydi.
- `pkill -f nom` o'z qobig'ini o'ldiradi; `pkill -f "[n]om"` yozing va o'sha buyruq qatorida `nom` boshqa joyda
  uchramasin (alohida buyruqda yuboring).
- `/home/user/UmarIbnHattob/frontend` da `next dev` ishlatilsa `.next` prod build'ni buzadi; prod serverdan oldin
  `npm run build` qiling.
- pytest `omniai_test` ni ishlatadi va `drop_all` qiladi; conftest endi baza nomi `_test` bilan tugamasa to'xtaydi.
  Hech qachon `TEST_DATABASE_URL` ni dev bazaga yo'naltirmang. Bir vaqtda ikki pytest ishlatmang.
- Agar dev bazada `ix_conversations_user_updated` allaqachon bo'lsa: migratsiya endi `if_not_exists` bilan; eski
  holatda `alembic stamp head` yordam beradi.
- Har bir tuzatuvchi agentdan keyin mustaqil code review qiling — 1-bosqichda review 6 ta jiddiy xatoni topdi.
- Limit tez tugaydi (2 parallel agent ≈ 5 soatlik limitning ~2%/daqiqa). Umar shunday iltimos qildi: limit
  tugashiga oz qolganda shu faylni yangilab, chala ishni `handoff/wip/*.patch` sifatida commit + push qiling.
