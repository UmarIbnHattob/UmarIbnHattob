// Canvas: foydalanuvchiga bog'liq saqlash, logout'da tozalash, panel yopiq holda ilova, ikki marta yuborish,
// qo'yilgan rasm fayllari (IndexedDB), vision ogohlantirishi, shriftlar o'z serverimizdan
import { browser, check, summary, SHOTS, WEB, API, sleep } from "./h.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const cdn = [];
page.on("request", (r) => /esm\.sh|unpkg|jsdelivr/.test(r.url()) && cdn.push(r.url()));
const RUN = Date.now().toString(36);
const fakeLog = async () => (await (await fetch("http://127.0.0.1:9100/_log?n=40")).json());

const emailA = `canvasA-${Date.now()}@example.com`;
await ctx.request.post(`${API}/auth/register`, { data: { email: emailA, password: "parol12345" } });
await ctx.request.patch(`${API}/me`, { data: { preferences: { theme: "light", default_model: "gemini-2.5-flash" } } });
const meA = await (await ctx.request.get(`${API}/me`)).json();
await page.goto(WEB + "/chat");
await page.waitForLoadState("networkidle");

// Chizish
await page.getByRole("button", { name: "Canvas", exact: true }).first().click();
await page.locator("canvas.excalidraw__canvas.interactive").waitFor({ timeout: 20000 });
await sleep(1000);
check("canvas: faol tab belgilangan", (await page.getByRole("button", { name: "Canvas", exact: true }).first().getAttribute("aria-pressed")) === "true");
const cv = await page.locator("canvas.excalidraw__canvas.interactive").boundingBox();
await page.mouse.click(cv.x + 300, cv.y + 320); // fokus canvasga
await page.keyboard.press("r");
await page.mouse.move(cv.x + 80, cv.y + 120);
await page.mouse.down();
await page.mouse.move(cv.x + 260, cv.y + 260, { steps: 8 });
await page.mouse.up();
// Rasm faylini sudrab tashlash (drop) — u IndexedDB ga saqlanishi kerak
await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = c.height = 40;
  const g = c.getContext("2d");
  g.fillStyle = "#e11d48";
  g.fillRect(0, 0, 40, 40);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "qizil.png", { type: "image/png" }));
  const target = document.querySelector("canvas.excalidraw__canvas.interactive");
  const r = target.getBoundingClientRect();
  for (const type of ["dragover", "drop"]) {
    target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.x + 350, clientY: r.y + 200 }));
  }
});
await sleep(2500);
const stored = await page.evaluate((id) => {
  const raw = localStorage.getItem(`omniai-canvas-v1:${id}`);
  return { keys: Object.keys(localStorage).filter((k) => k.startsWith("omniai-canvas")), types: raw ? JSON.parse(raw).map((e) => e.type) : [] };
}, meA.id);
check("canvas: foydalanuvchi kaliti bilan saqlandi", stored.keys.length === 1 && stored.keys[0] === `omniai-canvas-v1:${meA.id}`, JSON.stringify(stored));
check("canvas: to'rtburchak va rasm elementi saqlandi", stored.types.includes("rectangle") && stored.types.includes("image"), stored.types.join(","));
const files = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open("omniai-canvas", 1);
  req.onsuccess = () => {
    const db = req.result;
    const g = db.transaction("files").objectStore("files").getAll();
    g.onsuccess = () => res(g.result.map((x) => Object.keys(x).length));
    g.onerror = () => res(null);
  };
  req.onerror = () => res(null);
}));
check("canvas: qo'yilgan rasm IndexedDB da", Array.isArray(files) && files[0] >= 1, JSON.stringify(files));
await page.screenshot({ path: `${SHOTS}canvas-drawn.png` });

// Panel yopiq, "ilova qilish" belgilangan, ikki marta yuborish: bitta xabar va rasm bilan
await page.getByRole("button", { name: "Panelni ochish/yopish" }).click();
await page.getByLabel("Canvasni AI ga ko‘rsatish (rasm sifatida ilova qilinadi)").check();
await page.locator("textarea").fill(`canvas birinchi ${RUN}`);
await page.getByRole("button", { name: "Yuborish" }).dblclick();
await page.getByText(`Javob: canvas birinchi ${RUN}`).waitFor({ timeout: 15000 });
await sleep(1500);
check("canvas: ikki marta bosish — bitta xabar", (await page.locator("div.bg-blue-600 p", { hasText: `canvas birinchi ${RUN}` }).count()) === 1);
let log = (await fakeLog()).filter((e) => e.user?.includes(`canvas birinchi ${RUN}`));
check("canvas: panel yopiq bo'lsa ham rasm ilova qilindi (1 marta)", log.length === 1 && log[0].has_image === true, JSON.stringify(log.map((e) => e.has_image)));

// Reload: panel umuman ochilmagan — saqlangan chizmadan eksport
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByLabel("Canvasni AI ga ko‘rsatish (rasm sifatida ilova qilinadi)").check();
await page.locator("textarea").fill(`canvas reloaddan keyin ${RUN}`);
await page.locator("textarea").press("Enter");
await page.getByText(`Javob: canvas reloaddan keyin ${RUN}`).waitFor({ timeout: 15000 });
log = (await fakeLog()).filter((e) => e.user?.includes(`canvas reloaddan keyin ${RUN}`));
check("canvas: reloaddan keyin (panel ochilmagan) rasm ilova qilindi", log.length === 1 && log[0].has_image === true);
// Reloaddan keyin rasm elementi tiklanadi (fayl bilan)
await page.getByRole("button", { name: "Canvas", exact: true }).first().click();
await page.locator("canvas.excalidraw__canvas.interactive").waitFor({ timeout: 20000 });
await sleep(1500);
await page.screenshot({ path: `${SHOTS}canvas-after-reload.png` });

// Vision ogohlantirishi bir marta (rasm ko'rmaydigan model)
await ctx.request.put(`${API}/keys/deepseek`, { data: { key: "sk-good-canvas-deepseek" } });
await page.reload();
await page.waitForLoadState("networkidle");
await page.locator('button[aria-haspopup="listbox"]').click();
await page.getByRole("combobox").fill("Deepseek Chat");
await page.keyboard.press("Enter");
await page.getByLabel("Canvasni AI ga ko‘rsatish (rasm sifatida ilova qilinadi)").check();
await sleep(300);
console.log("tanlangan model:", await page.locator('button[aria-haspopup="listbox"]').innerText());
const warn = await page.getByText("rasmni ko‘ra olmaydi", { exact: false }).count();
check("vision: ogohlantirish bir marta", warn === 1, String(warn));
await page.locator("textarea").fill("deepseek canvas");
await page.locator("textarea").press("Enter");
await sleep(1500);
check("vision: ogohlantirish turganda yuborilmadi", (await page.locator("div.bg-blue-600 p", { hasText: "deepseek canvas" }).count()) === 0);
await page.getByLabel("Canvasni AI ga ko‘rsatish (rasm sifatida ilova qilinadi)").uncheck();

check("shriftlar/assetlar CDN dan yuklanmadi", cdn.length === 0, cdn.slice(0, 3).join(","));

// Logout: canvas ma'lumotlari tozalanadi; B foydalanuvchi bo'sh canvas ko'radi
await page.getByRole("button", { name: "Hisob menyusi" }).click();
await page.getByRole("menuitem", { name: "Chiqish" }).click();
await page.waitForURL("**/login**");
await sleep(800);
const left = await page.evaluate(async () => ({
  keys: Object.keys(localStorage).filter((k) => k.startsWith("omniai-canvas")),
  dbs: (await indexedDB.databases()).map((d) => d.name),
}));
check("logout: canvas localStorage tozalandi", left.keys.length === 0, JSON.stringify(left));
check("logout: canvas IndexedDB o'chirildi", !left.dbs.includes("omniai-canvas"), JSON.stringify(left.dbs));
check("logout: /login da next yo'q (o'zi chiqdi)", !page.url().includes("next="), page.url());
const emailB = `canvasB-${Date.now()}@example.com`;
await ctx.request.post(`${API}/auth/register`, { data: { email: emailB, password: "parol12345" } });
await page.goto(WEB + "/chat");
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: "Canvas", exact: true }).first().click();
await page.locator("canvas.excalidraw__canvas.interactive").waitFor({ timeout: 20000 });
await sleep(800);
const bKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("omniai-canvas")));
check("B foydalanuvchi: A ning chizmasi yo'q", bKeys.every((k) => !k.endsWith(meA.id)));
await page.screenshot({ path: `${SHOTS}canvas-userB.png` });

check("sahifada JS xatosi yo'q", errors.length === 0, errors.join(" | ").slice(0, 300));
await b.close();
summary();
