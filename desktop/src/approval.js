// Ruxsat oynasi matni: QISQA va tushunarli bo'lishi kerak (butun fayl emas),
// aks holda oyna ekrandan uzun bo'lib, tugmalar ko'rinmay qoladi.
"use strict";

const fs = require("node:fs");
const { resolveInside } = require("./fsTools");

const PREVIEW_LINES = 8;
const LINE_CHARS = 110;

function head(text, lines = PREVIEW_LINES) {
  const all = String(text ?? "").split("\n");
  const shown = all.slice(0, lines).map((l) => (l.length > LINE_CHARS ? l.slice(0, LINE_CHARS) + "…" : l));
  if (all.length > lines) shown.push(`… (yana ${all.length - lines} qator)`);
  return shown.join("\n");
}

function size(text) {
  const s = String(text ?? "");
  const lines = s.split("\n").length;
  const kb = Buffer.byteLength(s) / 1024;
  return `${lines} qator, ${kb < 1 ? "<1" : kb.toFixed(1)} KB`;
}

function exists(root, rel) {
  try {
    return fs.existsSync(resolveInside(root, rel));
  } catch {
    return false;
  }
}

/** Ruxsat oynasi uchun { title, detail }. detail doim ~1500 belgidan qisqa. */
function describe(root, name, args) {
  if (name === "run_command") {
    const cmd = String(args.command ?? "");
    return { title: "Terminal buyrug'ini ishga tushirish", detail: cmd.length > 500 ? cmd.slice(0, 500) + "…" : cmd };
  }
  if (name === "write_file") {
    const replacing = exists(root, args.path);
    return {
      title: replacing ? `Mavjud faylni qayta yozish: ${args.path}` : `Yangi fayl yaratish: ${args.path}`,
      detail: `${size(args.content)}${replacing ? " — eski mazmun almashtiriladi" : ""}\n\nBoshlanishi:\n${head(args.content)}`,
    };
  }
  return {
    title: `Faylni o'zgartirish: ${args.path}`,
    detail: `Olib tashlanadi:\n${head(args.old_text, 6)}\n\nO'rniga yoziladi:\n${head(args.new_text, 6)}`,
  };
}

module.exports = { describe };
