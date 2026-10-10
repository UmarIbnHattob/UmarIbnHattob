// Ruxsat oynasi matni: QISQA va tushunarli bo'lishi kerak (butun fayl emas),
// aks holda oyna ekrandan uzun bo'lib, tugmalar ko'rinmay qoladi.
"use strict";

const fs = require("node:fs");
const { resolveInside } = require("./fsTools");
const { tr } = require("./i18n");

const PREVIEW_LINES = 8;
const LINE_CHARS = 110;

function head(T, text, lines = PREVIEW_LINES) {
  const all = String(text ?? "").split("\n");
  const shown = all.slice(0, lines).map((l) => (l.length > LINE_CHARS ? l.slice(0, LINE_CHARS) + "…" : l));
  if (all.length > lines) shown.push(T("ap.more", { n: all.length - lines }));
  return shown.join("\n");
}

function size(T, text) {
  const s = String(text ?? "");
  const lines = s.split("\n").length;
  const kb = Buffer.byteLength(s) / 1024;
  return T("ap.size", { lines, kb: kb < 1 ? "<1" : kb.toFixed(1) });
}

function exists(root, rel) {
  try {
    return fs.existsSync(resolveInside(root, rel));
  } catch {
    return false;
  }
}

/**
 * Ruxsat oynasi uchun { title, detail } (`lang` tilida). detail doim ~1500 belgidan qisqa.
 * Argumentlar oldindan fsTools.checkArgs da tekshirilgan bo'ladi.
 */
function describe(root, name, args, lang = "uz") {
  const T = (key, vars) => tr(lang, key, vars);
  if (name === "run_command") {
    const cmd = String(args.command ?? "");
    return { title: T("ap.run"), detail: cmd.length > 500 ? cmd.slice(0, 500) + "…" : cmd };
  }
  if (name === "write_file") {
    const replacing = exists(root, args.path);
    return {
      title: T(replacing ? "ap.overwrite" : "ap.create", { path: args.path }),
      detail: `${size(T, args.content)}${replacing ? T("ap.replaced") : ""}\n\n${T("ap.start")}\n${head(T, args.content)}`,
    };
  }
  return {
    title: T("ap.edit", { path: args.path }),
    detail: `${T("ap.removed")}\n${head(T, args.old_text, 6)}\n\n${T("ap.inserted")}\n${head(T, args.new_text, 6)}`,
  };
}

module.exports = { describe };
