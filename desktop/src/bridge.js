// Ko'prik mantiqi (Electron'ga bog'liq emas — test/bridge.test.js da testlanadi):
// oyna holati, sahifa almashganda tozalash va asbob chaqiruvi tartibi (tekshiruv -> ruxsat -> bajarish).
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { runTool, checkArgs, errorText, resolveInside, NEEDS_APPROVAL } = require("./fsTools");
const { describe } = require("./approval");
const { tr } = require("./i18n");

/** Har bir oyna uchun holat: tanlangan papka, "qayta so'rama" ruxsatlari, interfeys tili va ishlayotgan asboblar. */
function newState() {
  return { root: null, autoApprove: new Set(), lang: "uz", jobs: new Set() };
}

/** To'xtatish: ishlayotgan asboblar (masalan uzoq buyruq) bekor qilinadi. */
function cancelJobs(s) {
  for (const job of s.jobs) job.abort();
  s.jobs.clear();
}

function resetFolder(s) {
  s.root = null;
  s.autoApprove.clear();
  cancelJobs(s);
}

/**
 * Yangi hujjat yuklansa (qayta yuklash, boshqa sahifa) yoki renderer jarayoni qulasa — papka va avtomatik
 * ruxsatlar bekor qilinadi, ishlayotgan buyruqlar to'xtatiladi: yangi sahifa avvalgi papkaga ruxsatsiz yoza olmasin.
 * SPA ichidagi o'tishlar (pushState) "did-navigate" bermaydi — ular tozalamaydi.
 */
function resetOnNavigation(webContents, s) {
  webContents.on("did-navigate", () => resetFolder(s));
  webContents.on("render-process-gone", () => resetFolder(s));
}

/**
 * Agent asbobini bajaradi. Argumentlar ruxsat so'rashdan OLDIN tekshiriladi: yaroqsiz JSON, bo'sh maydon yoki
 * papkadan tashqari yo'l uchun oyna chiqmaydi.
 * ask({ title, detail, root }) -> Promise<{ approved, remember }> — mahalliy ruxsat oynasi.
 */
async function callTool(s, name, args, ask) {
  const T = (key, vars) => tr(s.lang, key, vars);
  if (!s.root) return { output: T("pickFirst"), isError: true };
  const root = s.root;
  args = args ?? {};
  try {
    checkArgs(root, name, args);
  } catch (e) {
    return { output: errorText(e, s.lang), isError: true };
  }
  if (NEEDS_APPROVAL.has(name) && !s.autoApprove.has(name)) {
    const { approved, remember } = await ask({ ...describe(root, name, args, s.lang), root });
    if (!approved) return { output: T("denied"), isError: true };
    // Oyna ochiq turganda sahifa qayta yuklangan yoki papka almashgan bo'lsa — bajarilmaydi
    if (s.root !== root) return { output: T("folderChanged"), isError: true };
    if (remember) s.autoApprove.add(name);
  }
  const job = new AbortController();
  s.jobs.add(job);
  try {
    return await runTool(root, name, args, s.lang, job.signal);
  } finally {
    s.jobs.delete(job);
  }
}

// generate_image asbobi: faqat rasm formatlari
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_IMAGE = 15 * 1024 * 1024;

/** "assets/logo.png" band bo'lsa — birinchi bo'sh nom: "assets/logo-1.png", "assets/logo-2.png", ... */
function freeName(root, rel) {
  const ext = path.extname(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const name = `${stem}-${i}${ext}`;
    if (!fs.existsSync(resolveInside(root, name))) return name;
  }
  return rel; // bo'sh nom topilmadi — mavjud faylni qayta yozish uchun ruxsat so'raladi
}

/**
 * Server yaratgan rasmni papkaga saqlaydi (ruxsat bilan). Mavjud faylni qayta yozish uchun ruxsat HAR DOIM
 * so'raladi ("rasmlar uchun qayta so'rama" tanlangan bo'lsa ham).
 * unique: nomni AI emas, ilova o'zgartirgan (masalan logo.webp -> logo.png, rasm PNG bo'lib keldi) — bunday nom
 * band bo'lsa foydalanuvchining fayli ustiga yozilmaydi, bo'sh nom (logo-1.png) tanlanadi.
 * Natijadagi `path` — rasm qaysi nom bilan saqlangani.
 */
async function saveImage(s, rel, b64, ask, { unique = false } = {}) {
  const T = (key, vars) => tr(s.lang, key, vars);
  if (!s.root) return { output: T("pickFirst"), isError: true };
  const root = s.root;
  try {
    rel = String(rel);
    let abs = resolveInside(root, rel);
    if (!IMAGE_EXT.has(path.extname(abs).toLowerCase())) return { output: T("image.extOnly"), isError: true };
    const data = Buffer.from(String(b64), "base64");
    if (data.length > MAX_IMAGE) return { output: T("image.tooBig"), isError: true };
    const kb = (data.length / 1024).toFixed(0);
    if (unique && fs.existsSync(abs)) {
      rel = freeName(root, rel);
      abs = resolveInside(root, rel);
    }
    const overwrite = fs.existsSync(abs);
    if (overwrite || !s.autoApprove.has("save_image")) {
      const { approved, remember } = await ask({
        title: T(overwrite ? "image.overwrite" : "image.title", { path: rel }),
        detail: T("image.detail", { kb }) + (overwrite ? T("ap.replaced") : ""),
        root,
        image: true,
        overwrite,
      });
      if (!approved) return { output: T("image.denied"), isError: true };
      if (s.root !== root) return { output: T("folderChanged"), isError: true };
      if (remember && !overwrite) s.autoApprove.add("save_image");
    }
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, data);
    return { output: T("image.saved", { path: rel, kb }), isError: false, path: rel };
  } catch (e) {
    return { output: errorText(e, s.lang), isError: true };
  }
}

module.exports = { newState, resetFolder, cancelJobs, resetOnNavigation, callTool, saveImage };
