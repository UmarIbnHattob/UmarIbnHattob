// OmniAI Workspace — desktop ilova (Electron asosiy jarayoni).
// Veb-ilovani oynada ochadi va "Agent" rejimiga kompyuterdagi papka bilan ishlash imkonini beradi.
"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, net, shell, session } = require("electron");
const path = require("node:path");
const { resolveInside, errorText } = require("./fsTools");
const { newState, cancelJobs, resetOnNavigation, callTool, saveImage } = require("./bridge");
const { tr, normLang } = require("./i18n");

// Qaysi serverga ulanish: OMNIAI_URL muhit o'zgaruvchisi > package.json dagi standart
const APP_URL = process.env.OMNIAI_URL || require("../package.json").omniai.appUrl;
const APP_ORIGIN = new URL(APP_URL).origin;

/**
 * Har bir oyna uchun holat: tanlangan papka, "bu sessiyada qayta so'rama" ruxsatlari va interfeys tili.
 * Papkani FAQAT mahalliy dialog orqali tanlash mumkin — sahifa o'zi yo'l bera olmaydi.
 */
const state = new Map(); // webContents.id -> { root, autoApprove: Set<string>, lang }

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
  const s = newState();
  state.set(wcId, s);
  // Sahifa qayta yuklansa yoki renderer qulasa: papka va "qayta so'rama" ruxsatlari bekor qilinadi
  resetOnNavigation(win.webContents, s);
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

// Interfeys tili (preload.js sahifadagi <html lang> ni yuboradi): mahalliy oynalar, menyu va asbob natijalari shu tilda
ipcMain.on("omni:lang", (event, lang) => {
  if (!trusted(event)) return;
  const s = state.get(event.sender.id);
  if (!s || s.lang === normLang(lang)) return;
  s.lang = normLang(lang);
  Menu.setApplicationMenu(buildMenu(s.lang));
});

/** Ruxsat oynasi (bridge.callTool / saveImage uchun): { approved, remember } qaytaradi. */
function askApproval(event, s, kind, { title, detail, root, image }) {
  const T = (key, vars) => tr(s.lang, key, vars);
  const win = BrowserWindow.fromWebContents(event.sender);
  return dialog
    .showMessageBox(win, {
      type: kind === "run_command" ? "warning" : "question",
      title: T("dialog.title"),
      message: title,
      detail: `${T("dialog.folder", { root })}\n\n${detail}`,
      noLink: true,
      buttons: [T("dialog.allow"), T("dialog.deny")],
      defaultId: image ? 0 : 1,
      cancelId: 1,
      checkboxLabel: T(image ? "dialog.dontAskImages" : "dialog.dontAsk"),
    })
    .then((res) => ({ approved: res.response === 0, remember: res.checkboxChecked }));
}

ipcMain.handle("omni:pickFolder", async (event) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, {
    title: tr(s.lang, "dialog.pickFolder"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  s.root = res.filePaths[0];
  s.autoApprove.clear(); // yangi papka — ruxsatlar qaytadan so'raladi
  return { name: path.basename(s.root), path: s.root };
});

// Yozish va buyruqlar uchun ruxsat MAHALLIY oynada so'raladi — veb-sahifa buni chetlab o'ta olmaydi
ipcMain.handle("omni:tool", async (event, name, args) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  return callTool(s, name, args, (req) => askApproval(event, s, name, req));
});

// To'xtatish tugmasi: shu oynada ishlayotgan asboblar (uzoq buyruqlar) bekor qilinadi
ipcMain.handle("omni:cancel", (event) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  if (s) cancelJobs(s);
});

// Agent yaratgan faylni odatiy dasturda ochish (masalan HTML -> brauzer).
// Faqat xavfsiz turlar: skript/dastur fayllari ochilmaydi (ular ishga tushib ketishi mumkin).
const OPENABLE = new Set([".html", ".htm", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".md", ".txt", ".csv"]);

ipcMain.handle("omni:open", async (event, rel) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  if (!s?.root) return { ok: false, error: tr(s?.lang, "noFolder") };
  try {
    const abs = resolveInside(s.root, String(rel), { mustExist: true });
    if (!OPENABLE.has(path.extname(abs).toLowerCase())) return { ok: false, error: tr(s.lang, "cantOpenType") };
    const err = await shell.openPath(abs);
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, s.lang) };
  }
});

// generate_image asbobi: server yaratgan rasmni papkaga saqlash (ruxsat bilan, faqat rasm formatlari)
ipcMain.handle("omni:saveImage", async (event, rel, b64) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  return saveImage(s, rel, b64, (req) => askApproval(event, s, "save_image", req));
});

// Papkada tizim terminalini ochish (foydalanuvchi u yerda o'zi buyruq yozadi, masalan rasmiy "claude" CLI)
const { spawn, spawnSync } = require("node:child_process");

function openTerminal(cwd, lang) {
  const run = (cmd, args = []) => {
    const child = spawn(cmd, args, { cwd, detached: true, stdio: "ignore" });
    child.unref();
  };
  if (process.platform === "darwin") return run("open", ["-a", "Terminal", cwd]);
  if (process.platform === "win32") return run("cmd.exe", ["/c", "start", "cmd.exe"]);
  const candidates = [
    ["x-terminal-emulator", []], ["qterminal", []], ["gnome-terminal", [`--working-directory=${cwd}`]],
    ["konsole", ["--workdir", cwd]], ["xfce4-terminal", [`--working-directory=${cwd}`]], ["kitty", []], ["alacritty", []], ["xterm", []],
  ];
  for (const [cmd, args] of candidates) {
    if (spawnSync("which", [cmd]).status === 0) return run(cmd, args);
  }
  throw new Error(tr(lang, "noTerminal"));
}

ipcMain.handle("omni:openTerminal", async (event) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  if (!s?.root) return { ok: false, error: tr(s?.lang, "pickFirst") };
  try {
    openTerminal(s.root, s.lang);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Faylni fayl menejerida belgilangan holda ko'rsatish (har qanday tur uchun xavfsiz: hech narsa ishga tushmaydi)
ipcMain.handle("omni:reveal", async (event, rel) => {
  if (!trusted(event)) throw new Error("Ruxsat yo'q");
  const s = state.get(event.sender.id);
  if (!s?.root) return { ok: false, error: tr(s?.lang, "noFolder") };
  try {
    shell.showItemInFolder(resolveInside(s.root, String(rel), { mustExist: true }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, s.lang) };
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

/**
 * Ilova menyusi: sahifaga faqat oldindan belgilangan hodisalarni yuboradi (ixtiyoriy kod emas).
 * Sahifa ularni AuthGate'da eshitadi: omni:navigate, omni:new-chat, omni:modal.
 */
function send(event, detail) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  const js = `window.dispatchEvent(new CustomEvent(${JSON.stringify(event)}, { detail: ${JSON.stringify(detail ?? null)} }))`;
  win.webContents.executeJavaScript(js).catch(() => {});
}

/** Menyu interfeys tilida (standart rollar ham aniq yorliq bilan — aks holda Electron ularni inglizcha ko'rsatadi). */
function buildMenu(lang = "uz") {
  const T = (key) => tr(lang, key);
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "OmniAI",
      submenu: [
        { label: T("menu.newChat"), accelerator: "CmdOrCtrl+Shift+O", click: () => { send("omni:new-chat"); send("omni:navigate", "/chat"); } },
        { label: T("menu.agent"), accelerator: "CmdOrCtrl+Shift+A", click: () => send("omni:navigate", "/agent") },
        { label: T("menu.media"), click: () => send("omni:navigate", "/media") },
        { type: "separator" },
        { label: T("menu.settings"), accelerator: "CmdOrCtrl+,", click: () => send("omni:navigate", "/settings") },
        { label: T("menu.usage"), click: () => send("omni:navigate", "/settings?tab=usage") },
        { type: "separator" },
        isMac ? { role: "close", label: T("menu.closeWindow") } : { role: "quit", label: T("menu.quit") },
      ],
    },
    {
      label: T("menu.edit"),
      submenu: [
        { role: "undo", label: T("menu.undo") },
        { role: "redo", label: T("menu.redo") },
        { type: "separator" },
        { role: "cut", label: T("menu.cut") },
        { role: "copy", label: T("menu.copy") },
        { role: "paste", label: T("menu.paste") },
        { role: "delete", label: T("menu.delete") },
        { type: "separator" },
        { role: "selectAll", label: T("menu.selectAll") },
      ],
    },
    {
      label: T("menu.view"),
      submenu: [
        { role: "reload", label: T("menu.reload") },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools", label: T("menu.devTools") }]),
        { type: "separator" },
        { role: "zoomIn", label: T("menu.zoomIn") },
        { role: "zoomOut", label: T("menu.zoomOut") },
        { role: "resetZoom", label: T("menu.resetZoom") },
        { type: "separator" },
        { role: "togglefullscreen", label: T("menu.fullscreen") },
      ],
    },
    {
      label: T("menu.window"),
      submenu: [
        { role: "minimize", label: T("menu.minimize") },
        { role: "zoom", label: T("menu.zoom") },
        ...(isMac ? [{ type: "separator" }, { role: "front", label: T("menu.front") }] : [{ role: "close", label: T("menu.close") }]),
      ],
    },
    {
      label: T("menu.help"),
      submenu: [
        { label: T("menu.help"), click: () => send("omni:modal", "help") },
        { label: T("menu.shortcuts"), accelerator: "CmdOrCtrl+/", click: () => send("omni:modal", "shortcuts") },
        { type: "separator" },
        { label: T("menu.about"), click: () => send("omni:modal", "about") },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
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
    Menu.setApplicationMenu(buildMenu());
    createWindow();
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
  app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
}
