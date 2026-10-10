// Sozlamalar: AiTab + ModelSelector, kalitlar, provayderlar, statistika, xato tarjimalari, segment, 768px qatorlar
import { browser, userCtx, check, summary, SHOTS, WEB, API, sleep, hOverflow } from "./h.mjs";

const b = await browser();
const { ctx } = await userCtx(b, { tag: "settings", prefs: { theme: "light" } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const toastText = () => page.locator('[role="status"][aria-live="polite"]').innerText();
const req = (method, part) => {
  const list = [];
  page.on("request", (r) => r.method() === method && r.url().includes(part) && list.push(r.url()));
  return list;
};

// ---------- AI tab: standart model (Auto belgilangan), klaviatura, mavjud emaslar belgisi ----------
await page.goto(WEB + "/settings?tab=ai");
await page.waitForLoadState("networkidle");
const trigger = page.locator('button[aria-haspopup="listbox"]');
check("AI: standart null -> Auto ko'rinadi", (await trigger.innerText()).includes("Auto"));
await trigger.click();
const combo = page.getByRole("combobox", { name: "Model qidirish…" });
check("picker: ochilganda qidiruvga fokus", await combo.evaluate((el) => el === document.activeElement));
check("picker: listbox/option rollari", (await page.getByRole("listbox").count()) === 1 && (await page.getByRole("option").count()) > 3);
const ad0 = await combo.getAttribute("aria-activedescendant");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
const ad1 = await combo.getAttribute("aria-activedescendant");
check("picker: ↓ faol bandni o'zgartiradi (aria-activedescendant)", ad0 !== ad1 && !!ad1);
const activeLabel = await page.locator(`#${ad1.replace(/:/g, "\\:")}`).innerText();
await page.keyboard.press("Enter");
await sleep(800);
const me1 = await (await ctx.request.get(`${API}/me`)).json();
check("picker: Enter tanlaydi va saqlaydi", !!me1.preferences.default_model && activeLabel.includes((await trigger.innerText()).split("\n")[0].trim()), `${me1.preferences.default_model} / ${activeLabel.replace(/\n/g, " ")}`);
check("picker: tanlagandan keyin fokus tugmaga qaytdi", await trigger.evaluate((el) => el === document.activeElement));
check("AI: 'kalit yo'q' modeli uchun ogohlantirish", me1.preferences.default_model.startsWith("claude") ? await page.getByText("API kalitlar").first().isVisible() : true, me1.preferences.default_model);
await trigger.click();
await combo.fill("zzz-yoq");
check("picker: natija yo'q xabari", await page.getByText("Hech narsa topilmadi").isVisible());
check("picker: sanoq mos keladiganlarni ko'rsatadi", /^0 \/ \d+$/.test((await page.locator(".tabular-nums").first().innerText()).trim()), await page.locator(".tabular-nums").first().innerText());
await combo.fill("claude");
const claudeOpt = page.getByRole("option", { name: /Claude Sonnet/ });
check("picker: kalitsiz model 'kalit yo'q' belgisi bilan", (await claudeOpt.innerText()).includes("kalit yo‘q"));
await combo.fill("auto");
await page.keyboard.press("Enter");
await sleep(800);
check("AI: Auto qayta tanlansa default_model=null", (await (await ctx.request.get(`${API}/me`)).json()).preferences.default_model === null);
await page.screenshot({ path: `${SHOTS}settings-ai.png` });

// Saqlanmagan ko'rsatmalar: boshqa bo'limga o'tganda avtomatik saqlanadi
await page.getByRole("textbox", { name: "Shaxsiy ko‘rsatmalar" }).or(page.locator("textarea")).first().fill("Doim qisqa javob ber.");
check("AI: 'saqlanmagan' belgisi", await page.getByText("Saqlanmagan o‘zgarishlar bor").isVisible());
await page.locator('[data-tab="keys"]').click();
await sleep(1000);
check("AI: bo'lim almashganda ko'rsatma saqlandi", (await (await ctx.request.get(`${API}/me`)).json()).preferences.custom_instructions === "Doim qisqa javob ber.");

// ---------- Kalitlar ----------
await page.waitForLoadState("networkidle");
const puts = req("PUT", "/keys/");
const dsInput = page.getByLabel("Deepseek: ", { exact: false }).first();
await dsInput.fill("qisqa");
await dsInput.press("Enter");
await sleep(400);
check("kalit: qisqa kalit — mijozda tarjima qilingan xato, so'rov yo'q", puts.length === 0 && (await page.getByText("API kalit: kamida 8 belgi").isVisible()));
await dsInput.fill("sk-good-settings-deepseek");
await page.locator("form").filter({ has: dsInput }).getByRole("button").dblclick();
await sleep(1500);
check("kalit: ikki marta 'Saqlash' — bitta so'rov", puts.length === 1, String(puts.length));
check("kalit: saqlandi, •••• last4 ko'rinadi", await page.getByText("•••• ek").first().isVisible().catch(() => false) || (await page.getByText(/•••• /).count()) >= 1);
const del = page.getByRole("button", { name: "O‘chirish" }).first();
await del.click();
check("kalit: o'chirishda tasdiq", await page.getByText("Kalit o‘chirilsinmi?").isVisible());
await page.getByRole("button", { name: "O‘chirish", exact: true }).filter({ hasText: "O‘chirish" }).click();
await sleep(1000);
check("kalit: o'chirildi + toast", (await toastText()).includes("Kalit o‘chirildi"));
// 422 ro'yxat -> tarjima qilingan xabar (server javobini soxtalashtiramiz)
await page.route("**/api/keys/gemini", (r) =>
  r.fulfill({ status: 422, contentType: "application/json", headers: { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" },
    body: JSON.stringify({ detail: [{ type: "string_too_long", loc: ["body", "key"], msg: "x", ctx: { max_length: 500 } }] }) }));
const gInput = page.getByLabel("Gemini: ", { exact: false }).first();
await gInput.fill("sk-good-settings-gemini-xx");
await gInput.press("Enter");
await sleep(800);
check("api.ts: 422 tafsiloti tarjima qilingan", (await toastText()).includes("API kalit: ko‘pi bilan 500 belgi"), await toastText());
await page.unroute("**/api/keys/gemini");
// platform_exhausted
await page.route("**/api/keys", async (r) => {
  const res = await r.fetch();
  const data = (await res.json()).map((k) => (k.provider === "gemini" ? { ...k, configured: false, platform_available: false, platform_exhausted: true } : k));
  await r.fulfill({ response: res, json: data });
});
await page.reload();
await page.waitForLoadState("networkidle");
check("kalit: platform_exhausted -> 'Bepul limit tugadi'", await page.getByText("Bepul limit tugadi").isVisible());
await page.unroute("**/api/keys");

// ---------- Provayderlar ----------
await page.goto(WEB + "/settings?tab=providers");
await page.waitForLoadState("networkidle");
await sleep(1500);
const ph = await page.locator("#providers").boundingBox();
check("?tab=providers: sarlavhagacha aylantirildi", !!ph && ph.y >= -5 && ph.y < 300, JSON.stringify(ph));
const openaiCard = page.locator("div.rounded-xl.border.p-4", { hasText: "OpenAI" }).first();
await openaiCard.getByRole("button", { name: "Qo‘shish" }).click();
await openaiCard.getByPlaceholder("API kalit").fill("sk-good-settings-openai");
await openaiCard.getByPlaceholder("API kalit").press("Enter");
await page.getByText(/ta model/).first().waitFor({ timeout: 10000 });
await sleep(800);
check("provayder: Enter bilan qo'shildi", (await (await ctx.request.get(`${API}/providers`)).json()).length === 1);
// Takror qo'shish -> 409 + "Tahrirlash"
await openaiCard.getByRole("button", { name: "Qo‘shish" }).click();
await openaiCard.getByPlaceholder("API kalit").fill("sk-good-settings-openai2");
await openaiCard.getByPlaceholder("API kalit").press("Enter");
await sleep(1200);
check("provayder: takror qo'shishda 409 xabari", await openaiCard.getByRole("alert").isVisible(), await openaiCard.getByRole("alert").innerText().catch(() => ""));
await openaiCard.getByRole("alert").getByRole("button", { name: "Tahrirlash" }).click();
const nameInput = page.getByLabel("Nomi", { exact: true });
await nameInput.fill("Mening OpenAI");
await nameInput.press("Enter");
await sleep(1200);
const provs = await (await ctx.request.get(`${API}/providers`)).json();
check("provayder: tahrirlash (PATCH) nomni saqladi", provs[0]?.name === "Mening OpenAI", provs[0]?.name);
// O'chirish: tasdiq + toast
const yours = page.locator("section", { hasText: "Mening OpenAI" });
await yours.getByRole("button", { name: "O‘chirish" }).click();
check("provayder: o'chirishda tasdiq", await page.getByText("Provayder va uning kaliti o‘chirilsinmi?").isVisible());
await yours.locator("button.bg-red-600").click();
await sleep(1200);
check("provayder: o'chirildi + toast", (await (await ctx.request.get(`${API}/providers`)).json()).length === 0 && (await toastText()).includes("Provayder o‘chirildi"));
check("provayder: lokal kartada 'Yuklab olish' matni", await page.locator("div.rounded-xl.border.p-4", { hasText: "Ollama" }).getByText("Yuklab olish").isVisible());
await page.screenshot({ path: `${SHOTS}settings-providers.png`, fullPage: true });

// Ruscha ko'plik va preset tarjimasi
await ctx.request.patch(`${API}/me`, { data: { preferences: { language: "ru" } } });
await ctx.request.post(`${API}/providers`, { data: { kind: "groq", api_key: "sk-good-settings-groq" } });
await page.reload();
await page.waitForLoadState("networkidle");
await sleep(800);
const ruBadge = await page.locator("span.rounded-full", { hasText: /модел/ }).first().innerText();
check("ru: ko'plik shakli (2 модели / 5 моделей)", /^\d+ модел(ь|и|ей)$/.test(ruBadge), ruBadge);
check("ru: lokal preset nomi tarjimada", await page.getByText("Ollama (локально)").isVisible());
check("ru: '(ixtiyoriy)' tarjimada", !(await page.content()).includes("ixtiyoriy"));
await ctx.request.patch(`${API}/me`, { data: { preferences: { language: "uz" } } });

// ---------- Statistika: providers/labels/total ----------
await page.route("**/api/usage/stats*", (r) =>
  r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" },
    body: JSON.stringify({
      days: ["2026-10-09", "2026-10-10"],
      series: { "2026-10-09": { gemini: 2, whisper: 1 }, "2026-10-10": { groq: 3, custom: 1 } },
      by_model: [{ model: "llama-3.3-70b-versatile", count: 3 }], by_kind: { chat: 6, voice: 1 },
      providers: ["groq", "gemini", "whisper", "custom"], labels: { groq: "Groq", gemini: "Gemini", whisper: "Whisper", custom: "Mening serverim" }, total: 7,
    }) }));
await page.goto(WEB + "/settings?tab=usage");
await page.waitForLoadState("networkidle");
await sleep(800);
check("usage: jami (custom va Whisper bilan) = 7", (await page.locator(".text-3xl").innerText()).trim() === "7");
const legend = await page.locator("div.flex.items-center.gap-1\\.5.text-sm").allInnerTexts();
for (const [l, n] of [["Groq", 3], ["Gemini", 2], ["Whisper", 1], ["Mening serverim", 1]]) check(`usage: legendada '${l} ${n}'`, legend.some((x) => x.replace(/\s+/g, " ").trim() === `${l} ${n}`), legend.join(" | "));
await page.locator(".flex-1.flex-col.justify-end").last().hover();
await sleep(400);
check("usage: maslahatda o'zbekcha sana", await page.getByText("10-okt").isVisible());
await page.unroute("**/api/usage/stats*");

// ---------- Hisob: o'zbekcha sana; Tezkor tugmalar: sarlavha va send_with_enter ----------
await page.goto(WEB + "/settings?tab=account");
await page.waitForLoadState("networkidle");
check("hisob: o'zbekcha sana (M10 emas)", await page.getByText(/^\d{1,2}-(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr), \d{4}$/).isVisible());
await page.goto(WEB + "/settings?tab=shortcuts");
await page.waitForLoadState("networkidle");
check("tezkor tugmalar: bo'lim sarlavhasi", await page.getByRole("heading", { name: "Tezkor tugmalar" }).isVisible());
const sendRow = async () => page.locator("div", { hasText: /^Xabar yuborish/ }).last().locator("kbd").allInnerTexts();
check("tezkor tugmalar: Enter yuboradi", JSON.stringify(await sendRow()) === '["Enter"]', JSON.stringify(await sendRow()));
await ctx.request.patch(`${API}/me`, { data: { preferences: { send_with_enter: false } } });
await page.reload();
await page.waitForLoadState("networkidle");
check("tezkor tugmalar: send_with_enter=false -> Ctrl+Enter", JSON.stringify(await sendRow()) === '["Ctrl","Enter"]', JSON.stringify(await sendRow()));
await ctx.request.patch(`${API}/me`, { data: { preferences: { send_with_enter: true } } });

// ---------- Segment "tabletkasi" har tilda faol tugma ostida ----------
await page.goto(WEB + "/settings?tab=general");
for (const lang of ["uz", "en", "ru"]) {
  await ctx.request.patch(`${API}/me`, { data: { preferences: { language: lang } } });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await sleep(500);
  const diffs = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-pressed="true"]')]
      .filter((b) => b.parentElement.querySelector("span[aria-hidden]"))
      .map((b) => {
        const pill = b.parentElement.querySelector("span[aria-hidden]").getBoundingClientRect();
        const r = b.getBoundingClientRect();
        return Math.max(Math.abs(pill.left - r.left), Math.abs(pill.width - r.width));
      }));
  check(`segment (${lang}): tabletka faol tugma ostida (≤1px)`, diffs.length >= 2 && diffs.every((d) => d <= 1), JSON.stringify(diffs));
}
await ctx.request.patch(`${API}/me`, { data: { preferences: { language: "uz" } } });

// ---------- 768px: qatorlarda yorliq va boshqaruv ustma-ust chiqmaydi ----------
await page.setViewportSize({ width: 768, height: 900 });
for (const tab of ["general", "ai", "keys", "account", "privacy"]) {
  await page.goto(WEB + `/settings?tab=${tab}`);
  await page.waitForLoadState("networkidle");
  await sleep(400);
  const overlaps = await page.evaluate(() => {
    const bad = [];
    for (const row of document.querySelectorAll(".flex.flex-wrap.items-center.justify-between")) {
      const [a, c] = row.children;
      if (!a || !c) continue;
      const r1 = a.getBoundingClientRect(), r2 = c.getBoundingClientRect();
      const inter = !(r1.right <= r2.left + 1 || r2.right <= r1.left + 1 || r1.bottom <= r2.top + 1 || r2.bottom <= r1.top + 1);
      if (inter || r2.right > row.getBoundingClientRect().right + 1) bad.push(a.innerText.slice(0, 30));
    }
    return bad;
  });
  check(`768px ${tab}: yorliq/boshqaruv ustma-ust emas`, overlaps.length === 0, overlaps.join(" | "));
  check(`768px ${tab}: gorizontal aylantirish yo'q`, (await hOverflow(page)) <= 0);
  await page.screenshot({ path: `${SHOTS}settings-768-${tab}.png`, fullPage: true });
}

// ---------- Tarmoq xatosi en tilida, "uvicorn" yo'q ----------
await ctx.request.patch(`${API}/me`, { data: { preferences: { language: "en" } } });
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(WEB + "/settings?tab=keys");
await page.waitForLoadState("networkidle");
await ctx.setOffline(true);
const ds = page.getByLabel("Deepseek: ", { exact: false }).first();
await ds.fill("sk-good-offline-key");
await ds.press("Enter");
await sleep(1200);
const off = await toastText();
check("tarmoq xatosi: inglizcha, 'uvicorn' yo'q", off.includes("Can’t reach the server") && !/uvicorn/i.test(off), off);
await ctx.setOffline(false);

check("sahifada JS xatosi yo'q", errors.length === 0, errors.join(" | ").slice(0, 300));
await b.close();
summary();
