// Electron: agent rejimi haqiqiy desktop ilovada (papka tanlash va ruxsat dialoglari asosiy jarayonda soxtalashtiriladi)
import { _electron as electron } from "playwright-core";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, summary, SHOTS, API, sleep } from "./h.mjs";

const DESKTOP = new URL("../../../desktop", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "omni-agent-"));
const profile = mkdtempSync(join(tmpdir(), "omni-profile-"));
const app = await electron.launch({
  executablePath: `${DESKTOP}/node_modules/electron/dist/electron`,
  args: [DESKTOP, "--no-sandbox", "--disable-gpu", `--user-data-dir=${profile}`],
  env: { ...process.env, OMNIAI_URL: "http://localhost:3000" },
});
// Native dialoglar: papka — tayyor vaqtinchalik papka; ruxsat — "Ruxsat berish" (sonini sanaymiz)
await app.evaluate(({ dialog }, dir) => {
  globalThis.__asks = [];
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  dialog.showMessageBox = async (_w, opts) => {
    globalThis.__asks.push({ message: opts.message, detail: opts.detail, checkbox: opts.checkboxLabel ?? null, defaultId: opts.defaultId });
    return { response: 0, checkboxChecked: false };
  };
}, work);
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.waitForLoadState("domcontentloaded");

// Ro'yxatdan o'tish (oyna cookie lari bilan)
const email = `electron-${Date.now()}@example.com`;
await page.waitForURL("**/login**", { timeout: 20000 });
await page.getByText("Hisobingiz yo‘qmi").click();
await page.getByPlaceholder("Email").fill(email);
await page.getByPlaceholder("Parol (kamida 8 belgi)").fill("parol12345");
await page.getByRole("button", { name: "Ro‘yxatdan o‘tish" }).click();
await page.waitForURL("**/chat", { timeout: 20000 });
check("electron: ro'yxatdan o'tib chatga kirdi", true);
check("electron: omniDesktop ko'prigi v6", (await page.evaluate(() => window.omniDesktop?.version)) === 6);

// Agent: papka -> vazifa -> list_dir -> write_file (ruxsat) -> yakun
await page.goto("http://localhost:3000/agent");
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: "Papka tanlash" }).first().click();
await sleep(500);
const input = page.locator("textarea");
await input.fill("papkani ko'rib hello fayl yoz");
await input.press("Enter");
await page.getByText("hello.txt yozildi").waitFor({ timeout: 30000 });
await sleep(500);
check("agent: hello.txt papkada yaratildi", existsSync(join(work, "hello.txt")) && readFileSync(join(work, "hello.txt"), "utf8") === "Salom OmniAI\n");
let asks = await app.evaluate(() => globalThis.__asks);
check("agent: yozishdan oldin ruxsat so'raldi", asks.some((a) => a.message.includes("hello.txt")), JSON.stringify(asks.map((a) => a.message)));
check("agent: ishlayotganda model tanlagich qulflangan (sessiya)", await page.locator('button[aria-haspopup="listbox"]').isDisabled());
await page.screenshot({ path: `${SHOTS}electron-agent.png` });

// Rasm: assets/logo.png mavjud bo'lsa — qayta yozish uchun ruxsat (har doim so'raladi, "qayta so'rama" yo'q)
mkdirSync(join(work, "assets"), { recursive: true });
writeFileSync(join(work, "assets", "logo.png"), "eski");
await page.getByRole("button", { name: "Yangi sessiya" }).click().catch(() => {});
await app.evaluate(() => (globalThis.__asks = []));
await input.fill("rasm yaratib ber");
await input.press("Enter");
await page.getByText("hello.txt yozildi").last().waitFor({ timeout: 30000 }).catch(() => {});
await sleep(1500);
asks = await app.evaluate(() => globalThis.__asks);
const ow = asks.find((a) => a.message.includes("logo"));
check("rasm: mavjud faylni qayta yozishda ruxsat so'raldi", !!ow, JSON.stringify(asks.map((a) => a.message)));
check("rasm: qayta yozishda 'qayta so'rama' belgisi yo'q, standart 'Rad etish'", ow && ow.checkbox === null && ow.defaultId === 1, JSON.stringify(ow));
check("rasm: fayl PNG bilan almashtirildi", readFileSync(join(work, "assets", "logo.png")).subarray(1, 4).toString() === "PNG");

// Ekspert kartasi: "undefined:" ko'rinmaydi
await page.getByRole("button", { name: "Yangi sessiya" }).click().catch(() => {});
await input.fill("ekspert bilan tekshir");
await input.press("Enter");
await sleep(4000);
check("ekspert: kartada 'undefined' yo'q", !(await page.locator("main").innerText()).includes("undefined"));

// Uzun bo'linmas matn gorizontal aylantirish yaratmaydi
await page.getByRole("button", { name: "Yangi sessiya" }).click().catch(() => {});
await input.fill("z".repeat(400));
await input.press("Enter");
await sleep(3000);
const ov = await page.evaluate(() => {
  const m = document.querySelector("main");
  return [...m.querySelectorAll("*")].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible" && !el.matches("pre, pre *, textarea")).length;
});
check("uzun matn: agent ro'yxatida gorizontal aylantirish yo'q", ov === 0, String(ov));

check("electron: sahifada JS xatosi yo'q", errors.length === 0, errors.join(" | ").slice(0, 300));
await app.close();
summary();
