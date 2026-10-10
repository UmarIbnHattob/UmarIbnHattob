// Media Studio, kirish/?next=, ochiq yo'naltirish, oynalar, hisob menyusi, 404, eksport
import { browser, userCtx, check, summary, SHOTS, WEB, API, sleep } from "./h.mjs";

const b = await browser();
const errors = [];

// ---------- Media ----------
{
  const { ctx } = await userCtx(b, { tag: "media", prefs: { theme: "light" } });
  await ctx.request.put(`${API}/keys/gemini`, { data: { key: "good-media-gemini-key" } });
  const models = await (await ctx.request.get(`${API}/media/models`)).json();
  for (let i = 1; i <= 62; i++) await ctx.request.post(`${API}/media/images`, { data: { prompt: `rasm ${i}`, model: models[0].id } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(WEB + "/media");
  await page.waitForLoadState("networkidle");
  const cards = page.locator("button[aria-label='Rasmni kattalashtirish']");
  check("media: birinchi sahifa 60 ta", (await cards.count()) === 60, String(await cards.count()));
  await page.getByRole("button", { name: "Ko‘proq yuklash" }).click();
  await sleep(1000);
  check("media: 'Ko'proq yuklash' — 62 ta", (await cards.count()) === 62, String(await cards.count()));
  // Ctrl+Enter, sanagich, maxLength
  const ta = page.locator("textarea");
  await ta.fill("x".repeat(4100));
  check("media: prompt 4000 belgi bilan cheklangan", (await ta.inputValue()).length === 4000);
  check("media: sanagich ko'rinadi", await page.getByText("4000 / 4000").isVisible());
  await ta.fill("Ctrl Enter bilan kofe logotipi");
  await ta.press("Control+Enter");
  await page.locator("[role=status]", { hasText: /s$/ }).first().waitFor({ timeout: 3000 }).catch(() => {});
  await page.screenshot({ path: `${SHOTS}media-generating-light.png` });
  await page.locator("img[alt='Ctrl Enter bilan kofe logotipi']").first().waitFor({ timeout: 15000 });
  check("media: Ctrl+Enter yaratdi, rasm boshida", (await cards.count()) === 63);
  // Lightbox
  await cards.first().click();
  const dlg = page.getByRole("dialog");
  check("lightbox: ochildi, fokus 'Yopish' da", (await dlg.isVisible()) && (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Yopish");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  check("lightbox: Tab oyna ichida qoladi", await dlg.evaluate((d) => d.contains(document.activeElement)));
  await page.keyboard.press("Escape");
  await sleep(300);
  check("lightbox: Esc yopdi, fokus rasmga qaytdi", !(await dlg.isVisible()) && (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Rasmni kattalashtirish");
  // O'chirish tasdiq bilan
  const firstCard = page.locator("div.group").first();
  await firstCard.getByRole("button", { name: "O‘chirish" }).click();
  check("media: o'chirishda tasdiq", await firstCard.getByText("Rasm o‘chirilsinmi?").isVisible());
  await firstCard.locator("button.bg-red-600").click();
  await sleep(1000);
  check("media: o'chirildi + toast", (await cards.count()) === 62 && (await page.getByText("Rasm o‘chirildi").isVisible()));
  // Kesh: rasm fayli no-cache (logoutdan keyin keshdan ko'rinmasin)
  const items = await (await ctx.request.get(`${API}/media?limit=1`)).json();
  const head = await ctx.request.get(`${API}/media/${items[0].id}/file`);
  check("media fayl: Cache-Control private, no-cache", (head.headers()["cache-control"] ?? "").includes("no-cache"), head.headers()["cache-control"]);
  await ctx.close();
}

// ---------- Kirish: ?next= va ochiq yo'naltirish himoyasi ----------
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  const email = `next-${Date.now()}@example.com`;
  await ctx.request.post(`${API}/auth/register`, { data: { email, password: "parol12345" } });
  await ctx.clearCookies();
  await page.goto(WEB + "/settings?tab=account");
  await page.waitForURL("**/login?next=**");
  check("logout holatida: /login?next=<sahifa>", decodeURIComponent(page.url()).includes("next=/settings?tab=account"), page.url());
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Parol (kamida 8 belgi)").fill("parol12345");
  await page.getByRole("button", { name: "Kirish", exact: true }).click();
  await page.waitForURL("**/settings?tab=account");
  check("kirgandan keyin o'sha sahifaga qaytdi", page.url().endsWith("/settings?tab=account"));
  // Ochiq yo'naltirish urinishlari (kirgan foydalanuvchi /login ga kelganda va kirish formasi)
  for (const evil of ["//evil.example", "/%09/evil.example", "/\\evil.example", "https://evil.example", "/login?next=//evil.example", "/%0a/evil.example"]) {
    await page.goto(`${WEB}/login?next=${evil}`);
    await sleep(1500);
    const u = new URL(page.url());
    check(`ochiq yo'naltirish yo'q: next=${evil}`, u.origin === WEB && u.pathname === "/chat", page.url());
  }
  await ctx.clearCookies();
  await page.goto(`${WEB}/login?next=/%09/evil.example`);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Parol (kamida 8 belgi)").fill("parol12345");
  await page.getByRole("button", { name: "Kirish", exact: true }).click();
  await page.waitForURL(/\/chat/);
  check("kirish formasi: xavfli next -> /chat", new URL(page.url()).origin === WEB && new URL(page.url()).pathname === "/chat", page.url());

  // ---------- 404 ----------
  await page.goto(WEB + "/yoq-sahifa");
  check("404: o'zbekcha sarlavha", await page.getByText("Sahifa topilmadi").isVisible());
  check("404: chatga qaytish havolasi", await page.getByRole("link", { name: "Chatga qaytish" }).isVisible());

  // ---------- Hisob menyusi: klaviatura ----------
  await page.goto(WEB + "/chat");
  await page.waitForLoadState("networkidle");
  const acc = page.getByRole("button", { name: "Hisob menyusi" });
  await acc.focus();
  await page.keyboard.press("Enter");
  await sleep(300);
  check("menyu: Enter ochadi, fokus birinchi bandda", (await page.evaluate(() => document.activeElement?.getAttribute("role"))) === "menuitem");
  const theme = page.getByRole("menuitem", { name: /Mavzu/ });
  await theme.focus();
  check("menyu: aria-haspopup / aria-expanded=false", (await theme.getAttribute("aria-haspopup")) === "menu" && (await theme.getAttribute("aria-expanded")) === "false");
  await page.keyboard.press("ArrowRight");
  await sleep(300);
  check("menyu: → yon menyuni ochadi, fokus ichida", (await theme.getAttribute("aria-expanded")) === "true" && (await page.evaluate(() => document.activeElement?.getAttribute("role"))) === "menuitemradio");
  await page.keyboard.press("Escape");
  await sleep(200);
  check("menyu: Esc faqat yon menyuni yopadi", (await acc.getAttribute("aria-expanded")) === "true" && (await theme.getAttribute("aria-expanded")) === "false");
  await page.keyboard.press("Escape");
  await sleep(200);
  check("menyu: ikkinchi Esc menyuni yopadi, fokus tugmada", (await acc.getAttribute("aria-expanded")) === "false" && (await acc.evaluate((el) => el === document.activeElement)));
  // Hover qayta mount qilmaydi: band elementi o'sha DOM tuguni bo'lib qoladi
  await acc.click();
  const h1 = await page.getByRole("menuitem", { name: "Sozlamalar" }).elementHandle();
  await page.getByRole("menuitem", { name: /Til/ }).hover();
  await sleep(300);
  await page.getByRole("menuitem", { name: "Yordam" }).hover();
  check("menyu: hover bandlarni qayta yaratmaydi", await h1.evaluate((el) => el.isConnected));

  // ---------- Oynalar (modal) ----------
  await page.getByRole("menuitem", { name: "Yordam" }).click();
  const dlg = page.getByRole("dialog");
  check("modal: role=dialog, aria-modal", (await dlg.getAttribute("aria-modal")) === "true");
  check("modal: fokus oyna ichida", await dlg.evaluate((d) => d.contains(document.activeElement)));
  check("modal: Yordam — birinchi savol ochiq", (await page.getByRole("button", { name: /API kalitni qayerdan olaman/ }).getAttribute("aria-expanded")) === "true");
  for (let i = 0; i < 9; i++) await page.keyboard.press("Tab");
  check("modal: Tab oyna ichida aylanadi", await dlg.evaluate((d) => d.contains(document.activeElement)));
  check("modal: 'Yopish' tugmasi tarjimada", await dlg.getByRole("button", { name: "Yopish" }).isVisible());
  await page.keyboard.press("Escape");
  await sleep(300);
  check("modal: Esc yopdi, fokus hisob tugmasiga qaytdi", !(await dlg.isVisible()) && (await acc.evaluate((el) => el === document.activeElement)));
  await page.keyboard.press("Control+/");
  await sleep(300);
  check("modal: Ctrl+/ tezkor tugmalar oynasi", await page.getByRole("dialog").isVisible());
  await page.keyboard.press("Control+,");
  await page.waitForURL("**/settings");
  await sleep(300);
  check("modal: Ctrl+, oynani yopib sozlamalarga o'tadi", !(await page.getByRole("dialog").isVisible().catch(() => false)));

  // ---------- Telefon: menyu drawer ichida hisob menyusi Esc ----------
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto(WEB + "/chat");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Menyuni ochish" }).click();
  await sleep(300);
  await acc.click();
  await page.getByRole("menuitem", { name: /Mavzu/ }).click();
  await sleep(300);
  const sub = await page.getByRole("menuitemradio").first().boundingBox();
  check("telefon: yon menyu tap bilan ochiladi va ekran ichida", !!sub && sub.x >= 0 && sub.x + sub.width <= 375, JSON.stringify(sub));
  await page.screenshot({ path: `${SHOTS}menu-phone.png` });
  await page.mouse.click(10, 700); // menyu ichidagi bo'sh joy emas — tashqarida? menyuni yopish uchun Esc ishlatamiz
  await acc.click().catch(() => {});
  await page.keyboard.press("Escape");
  await sleep(300);
  check("telefon: Esc hisob menyusini yopdi, chap panel ochiq qoldi", (await page.getByRole("button", { name: "Menyuni ochish" }).getAttribute("aria-expanded")) === "true" || (await page.locator("#app-sidebar").isVisible()));

  // ---------- Eksport: Blob orqali; sessiya tugaganda toast ----------
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(WEB + "/settings?tab=privacy");
  await page.waitForLoadState("networkidle");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.getByRole("button", { name: "JSON" }).click()]);
  check("eksport: fayl yuklab olindi", /\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  check("eksport: sahifa o'zgarmadi", page.url().includes("/settings"));
  await ctx.clearCookies();
  await page.getByRole("button", { name: "JSON" }).click();
  await sleep(500);
  check("eksport: sessiya tugaganda tarjima qilingan toast", await page.getByText("Sessiya tugagan. Qaytadan kiring.").isVisible());
  await page.waitForURL("**/login**", { timeout: 8000 });
  check("eksport: keyin kirish sahifasiga o'tdi", page.url().includes("/login"));
  await ctx.close();
}

check("sahifada JS xatosi yo'q", errors.length === 0, errors.join(" | ").slice(0, 300));
await b.close();
summary();
