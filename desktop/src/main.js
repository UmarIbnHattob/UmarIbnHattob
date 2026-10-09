// OmniAI Workspace — desktop ilova (Electron asosiy jarayoni).
// Veb-ilovani oynada ochadi va "Agent" rejimiga kompyuterdagi papka bilan ishlash imkonini beradi.
"use strict";

const { app, BrowserWindow, dialog, ipcMain, net, shell, session } = require("electron");
const path = require("node:path");
const { runTool, resolveInside, NEEDS_APPROVAL } = require("./fsTools");
const { describe } = require("./approval");

// Qaysi serverga ulanish: OMNIAI_URL muhit o'zgaruvchisi > package.json dagi standart
const APP_URL = process.env.OMNIAI_URL || require("../package.json").omniai.appUrl;
const APP_ORIGIN = new URL(APP_URL).origin;

/**
 * Har bir oyna uchun holat: tanlangan papka va "bu sessiyada qayta so'rama" ruxsatlari.
 * Papkani FAQAT mahalliy dialog orqali tanlash mumkin — sahifa o'zi yo'l bera olmaydi.
 */
const state = new Map(); // webContents.id -> { root, autoApprove: Set<string> }

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#171717",
    title: "OmniAI Workspace",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // id ni oldindan olamiz: "closed" hodisasida oyna allaqachon yo'q qilingan bo'ladi
  // (win.webContents ga murojaat "Object has been destroyed" xatosini beradi)
  const wcId = win.webContents.id;
  state.set(wcId, { root: null, autoApprove: new Set() });
  win.on("closed", () => {
    state.delete(wcId);
    stopRetry(win);
  });

  // Ilova faqat o'z serverida qoladi; tashqi havolalar odatiy brauzerda ochiladi
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  // Asosiy sahifa yuklanmasa (server o'chiq, internet yo'q) — kutish sahifasi.
  // -3 (ERR_ABORTED) xato emas: sahifa o'zi boshqa manzilga o'tganda (masalan /login) shunday bo'ladi.
  win.webContents.on("did-fail-load", (_e, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    showOffline(win, description);
  });

  openApp(win);
}

function openApp(win) {
  stopRetry(win);
  // Xatolar did-fail-load da ko'riladi; bu yerda faqat "ushlanmagan promise" bo'lmasin
  win.loadURL(APP_URL).catch(() => {});
}

/** Server tayyor bo'lguncha chiroyli kutish sahifasi; har 2 soniyada tekshirib, o'zi ulanadi. */
const retryTimers = new WeakMap();

function showOffline(win, reason) {
  if (win.isDestroyed()) return;
  win.loadFile(path.join(__dirname, "offline.html"), { query: { url: APP_URL, reason: String(reason || "") } }).catch(() => {});
  if (retryTimers.has(win)) return;
  const timer = setInterval(async () => {
    if (win.isDestroyed()) return stopRetry(win);
    try {
      const res = await net.fetch(APP_URL, { method: "HEAD", cache: "no-store" });
      if (res.status < 500) openApp(win);
    } catch {
      /* hali ham ishlamayapti */
    }
  }, 2000);
  retryTimers.set(win, timer);
}

function stopRetry(win) {
  clearInterval(retryTimers.get(win));
  retryTimers.delete(win);
}

/** Faqat ilova serveridan kelgan so'rovlarga javob beramiz (boshqa sahifa ko'prikdan foydalana olmasin). */
function trusted(event) {
  try {
    return new URL(event.senderFrame.url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

ipcMain.handle("omni:pickFolder", async (event) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, {
    title: "AI ishlaydigan papkani tanlang",
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const s = state.get(event.sender.id);
  s.root = res.filePaths[0];
  s.autoApprove.clear(); // yangi papka — ruxsatlar qaytadan so'raladi
  return { name: path.basename(s.root), path: s.root };
});

ipcMain.handle("omni:tool", async (event, name, args) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  if (!s?.root) return { output: "Avval papka tanlang.", isError: true };
  args = args && typeof args === "object" ? args : {};

  // Yozish va buyruqlar uchun ruxsat MAHALLIY oynada so'raladi — veb-sahifa buni chetlab o'ta olmaydi
  if (NEEDS_APPROVAL.has(name) && !s.autoApprove.has(name)) {
    const { title, detail } = describe(s.root, name, args);
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showMessageBox(win, {
      type: name === "run_command" ? "warning" : "question",
      title: "AI ruxsat so'rayapti",
      message: title,
      detail: `Papka: ${s.root}\n\n${detail}`,
      noLink: true,
      buttons: ["Ruxsat berish", "Rad etish"],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: "Bu papkada shu turdagi amallar uchun qayta so'rama",
    });
    if (res.response !== 0) return { output: "Foydalanuvchi bu amalni rad etdi.", isError: true };
    if (res.checkboxChecked) s.autoApprove.add(name);
  }
  return runTool(s.root, name, args);
});

// Agent yaratgan faylni odatiy dasturda ochish (masalan HTML -> brauzer).
// Faqat xavfsiz turlar: skript/dastur fayllari ochilmaydi (ular ishga tushib ketishi mumkin).
const OPENABLE = new Set([".html", ".htm", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".md", ".txt", ".csv"]);

ipcMain.handle("omni:open", async (event, rel) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  if (!s?.root) return { ok: false, error: "Papka tanlanmagan" };
  try {
    const abs = resolveInside(s.root, String(rel), { mustExist: true });
    if (!OPENABLE.has(path.extname(abs).toLowerCase())) return { ok: false, error: "Bu turdagi faylni ochib bo'lmaydi" };
    const err = await shell.openPath(abs);
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Mikrofon: faqat ilova serveriga ruxsat (ovozli buyruqlar uchun)
function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = (() => {
      try {
        return new URL(details.requestingUrl).origin;
      } catch {
        return "";
      }
    })();
    callback(origin === APP_ORIGIN && (permission === "media" || permission === "clipboard-sanitized-write"));
  });
}

// Bitta nusxa: ikkinchi marta ochilsa, mavjud oyna oldinga chiqadi
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    setupPermissions();
    createWindow();
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
  app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
}
