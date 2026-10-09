// Veb-sahifaga faqat shu ikki funksiya ochiladi (Node.js yoki fayl tizimiga to'g'ridan-to'g'ri kirish yo'q).
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omniDesktop", {
  version: 4,
  platform: process.platform,
  /** Papka tanlash dialogi. Natija: { name, path } yoki null. */
  pickFolder: () => ipcRenderer.invoke("omni:pickFolder"),
  /** Agent asbobini bajarish. Yozish/buyruqlar uchun foydalanuvchidan ruxsat so'raladi. */
  tool: (name, args) => ipcRenderer.invoke("omni:tool", name, args),
  /** Papkadagi faylni odatiy dasturda ochish (HTML, rasm, PDF, matn). */
  open: (relPath) => ipcRenderer.invoke("omni:open", relPath),
  /** Faylni fayl menejerida ko'rsatish. */
  reveal: (relPath) => ipcRenderer.invoke("omni:reveal", relPath),
  /** AI yaratgan rasmni papkaga saqlash (ruxsat bilan). */
  saveImage: (relPath, base64) => ipcRenderer.invoke("omni:saveImage", relPath, base64),
  /** Tanlangan papkada tizim terminalini ochish. */
  openTerminal: () => ipcRenderer.invoke("omni:openTerminal"),
});
