// OmniAI Workspace — desktop ilova (Electron asosiy jarayoni).
// Veb-ilovani oynada ochadi va "Agent" rejimiga kompyuterdagi papka bilan ishlash imkonini beradi.
"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell, session } = require("electron");
const path = require("node:path");
const { runTool, NEEDS_APPROVAL } = require("./fsTools");

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
  state.set(win.webContents.id, { root: null, autoApprove: new Set() });
  win.on("closed", () => state.delete(win.webContents.id));

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

  win.loadURL(APP_URL).catch(() => {
    dialog.showErrorBox("Ulanib bo'lmadi", `Server ochilmadi: ${APP_URL}\nInternet yoki OMNIAI_URL ni tekshiring.`);
  });
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

function describe(name, args) {
  if (name === "run_command") return { title: "Buyruqni ishga tushirish", detail: String(args.command ?? "") };
  if (name === "write_file") {
    const preview = String(args.content ?? "");
    return {
      title: `Faylni yozish: ${args.path}`,
      detail: preview.length > 1500 ? `${preview.slice(0, 1500)}\n… (${preview.length} belgi)` : preview,
    };
  }
  return {
    title: `Faylni o'zgartirish: ${args.path}`,
    detail: `− ${String(args.old_text ?? "").slice(0, 700)}\n\n+ ${String(args.new_text ?? "").slice(0, 700)}`,
  };
}

ipcMain.handle("omni:tool", async (event, name, args) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  if (!s?.root) return { output: "Avval papka tanlang.", isError: true };
  args = args && typeof args === "object" ? args : {};

  // Yozish va buyruqlar uchun ruxsat MAHALLIY oynada so'raladi — veb-sahifa buni chetlab o'ta olmaydi
  if (NEEDS_APPROVAL.has(name) && !s.autoApprove.has(name)) {
    const { title, detail } = describe(name, args);
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showMessageBox(win, {
      type: name === "run_command" ? "warning" : "question",
      title: "AI ruxsat so'rayapti",
      message: title,
      detail: `Papka: ${s.root}\n\n${detail}`,
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
