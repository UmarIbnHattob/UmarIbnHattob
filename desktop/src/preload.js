// Veb-sahifaga faqat shu ikki funksiya ochiladi (Node.js yoki fayl tizimiga to'g'ridan-to'g'ri kirish yo'q).
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omniDesktop", {
  version: 1,
  platform: process.platform,
  /** Papka tanlash dialogi. Natija: { name, path } yoki null. */
  pickFolder: () => ipcRenderer.invoke("omni:pickFolder"),
  /** Agent asbobini bajarish. Yozish/buyruqlar uchun foydalanuvchidan ruxsat so'raladi. */
  tool: (name, args) => ipcRenderer.invoke("omni:tool", name, args),
});
