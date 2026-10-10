// Veb-sahifaga faqat shu ikki funksiya ochiladi (Node.js yoki fayl tizimiga to'g'ridan-to'g'ri kirish yo'q).
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omniDesktop", {
  version: 6,
  platform: process.platform,
  /** Papka tanlash dialogi. Natija: { name, path } yoki null. */
  pickFolder: () => ipcRenderer.invoke("omni:pickFolder"),
  /** Agent asbobini bajarish. Yozish/buyruqlar uchun foydalanuvchidan ruxsat so'raladi. */
  tool: (name, args) => ipcRenderer.invoke("omni:tool", name, args),
  /** Papkadagi faylni odatiy dasturda ochish (HTML, rasm, PDF, matn). */
  open: (relPath) => ipcRenderer.invoke("omni:open", relPath),
  /** Faylni fayl menejerida ko'rsatish. */
  reveal: (relPath) => ipcRenderer.invoke("omni:reveal", relPath),
  /**
   * AI yaratgan rasmni papkaga saqlash (ruxsat bilan). opts.unique: nom band bo'lsa yangi nom tanlanadi (logo-1.png).
   * Natija: { output, isError, path } — path: rasm qaysi nom bilan saqlangani.
   */
  saveImage: (relPath, base64, opts) => ipcRenderer.invoke("omni:saveImage", relPath, base64, { unique: opts?.unique === true }),
  /** Tanlangan papkada tizim terminalini ochish. */
  openTerminal: () => ipcRenderer.invoke("omni:openTerminal"),
  /** To'xtatish: ishlayotgan asboblarni (masalan uzoq buyruqni) bekor qilish. */
  cancel: () => ipcRenderer.invoke("omni:cancel"),
});

// Interfeys tili: sahifa <html lang> ni o'zgartirganda (uz/en/ru) mahalliy oynalar, menyu va asbob natijalari ham
// shu tilga o'tadi. Faqat til kodi yuboriladi; asosiy jarayon noma'lum qiymatni o'zbekchaga aylantiradi.
window.addEventListener("DOMContentLoaded", () => {
  const html = document.documentElement;
  const sendLang = () => ipcRenderer.send("omni:lang", html.lang);
  sendLang();
  new MutationObserver(sendLang).observe(html, { attributes: true, attributeFilter: ["lang"] });
});
