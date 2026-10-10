// Umumiy yordamchilar: brauzer, ro'yxatdan o'tish, sozlamalar, natijalarni yig'ish
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const API = "http://localhost:8000/api";
export const WEB = "http://localhost:3000";
// Skrinshotlar repo ichiga emas: E2E_SHOTS yoki vaqtinchalik papka
export const SHOTS = (process.env.E2E_SHOTS || join(tmpdir(), "omniai-e2e-shots")) + "/";
mkdirSync(SHOTS, { recursive: true });

export async function browser() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
}

let n = 0;
/** Yangi foydalanuvchi bilan kirilgan kontekst. prefs — PATCH /me preferences. */
export async function userCtx(b, { tag = "t", prefs = {}, viewport = { width: 1280, height: 800 }, ...opts } = {}) {
  const ctx = await b.newContext({ viewport, permissions: ["microphone", "clipboard-read", "clipboard-write"], ...opts });
  const email = `${tag}-${Date.now()}-${n++}@example.com`;
  const r = await ctx.request.post(`${API}/auth/register`, { data: { email, password: "parol12345" } });
  if (!r.ok()) throw new Error(`register ${r.status()} ${await r.text()}`);
  if (Object.keys(prefs).length) {
    const p = await ctx.request.patch(`${API}/me`, { data: { preferences: prefs } });
    if (!p.ok()) throw new Error(`prefs ${p.status()} ${await p.text()}`);
  }
  return { ctx, email };
}

const results = [];
export function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
export function summary() {
  const fail = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} passed`);
  if (fail.length) process.exitCode = 1;
}

/** Sahifada gorizontal aylantirish bormi (kontent oynadan kengroq). */
export const hOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Element to'liq ko'rinish oynasi ichida va kengligi > 0. */
export async function inView(loc) {
  const box = await loc.boundingBox();
  const vp = loc.page().viewportSize();
  return !!box && box.width > 0 && box.x >= -1 && box.x + box.width <= vp.width + 1 && box.y >= -1 && box.y + box.height <= vp.height + 1;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Element matnida `text` paydo bo'lishini kutadi (asinxron yuklanish uchun); topilsa true. */
export async function waitText(loc, text, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await loc.innerText().catch(() => "")).includes(text)) return true;
    await sleep(100);
  }
  return false;
}
