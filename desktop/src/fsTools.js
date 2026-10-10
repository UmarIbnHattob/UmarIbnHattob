// Agent asboblari: faqat foydalanuvchi tanlagan papka ICHIDA ishlaydi.
// Bu modul Electron'ga bog'liq emas — alohida testlanadi (test/fsTools.test.js).
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { tr } = require("./i18n");

const MAX_READ = 256 * 1024; // 256 KB
const MAX_LIST = 500;
const MAX_MATCHES = 200;
const MAX_CMD_OUTPUT = 20 * 1024;
const CMD_TIMEOUT_MS = 120_000;
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__", ".cache"]);

/** Foydalanuvchiga ko'rsatiladigan xato. `key` — i18n kaliti: matn keyin foydalanuvchi tilida olinadi (errorText). */
class ToolError extends Error {
  constructor(key, vars) {
    super(tr("uz", key, vars));
    this.key = key;
    this.vars = vars;
  }
}

/** Xato matni foydalanuvchi tilida (kutilmagan xatolar "Xato: ..." ko'rinishida). */
function errorText(err, lang) {
  return err instanceof ToolError ? tr(lang, err.key, err.vars) : tr(lang, "fs.error", { msg: err.message });
}

/**
 * Nisbiy yo'lni ildiz ichidagi absolyut yo'lga aylantiradi.
 * `../` yoki symlink orqali ildizdan tashqariga chiqish taqiqlanadi.
 */
function resolveInside(root, rel, { mustExist = false } = {}) {
  if (typeof rel !== "string" || rel.includes("\0")) throw new ToolError("fs.badPath");
  if (path.isAbsolute(rel)) throw new ToolError("fs.relativeOnly");
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, rel || ".");
  const inside = (p) => p === realRoot || p.startsWith(realRoot + path.sep);
  if (!inside(target)) throw new ToolError("fs.outside");

  // Mavjud eng yaqin ota-papkaning haqiqiy yo'lini tekshiramiz (symlink tashqariga olib chiqmasin).
  // lstat (existsSync emas): nishoni yo'q (osilib qolgan) symlink ham "mavjud" — aks holda yozish uni kuzatib,
  // papkadan tashqarida fayl yaratadi.
  const exists = (p) => {
    try {
      fs.lstatSync(p);
      return true;
    } catch {
      return false;
    }
  };
  let probe = target;
  while (!exists(probe)) {
    if (mustExist) throw new ToolError("fs.notFound", { path: rel });
    probe = path.dirname(probe);
  }
  let real;
  try {
    real = fs.realpathSync(probe);
  } catch {
    throw new ToolError("fs.danglingSymlink", { path: path.relative(realRoot, probe) });
  }
  if (!inside(real)) throw new ToolError("fs.symlinkOutside");
  return target;
}

const relOf = (root, abs) => path.relative(fs.realpathSync(root), abs) || ".";

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Asboblar: (root, args, T) — T(kalit, qiymatlar) natija matnini foydalanuvchi tilida beradi.
// Argumentlar oldindan checkArgs da tekshirilgan bo'ladi.
async function listDir(root, { path: rel }, T) {
  const abs = resolveInside(root, rel ?? ".", { mustExist: true });
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const lines = entries.slice(0, MAX_LIST).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  if (entries.length > MAX_LIST) lines.push(T("fs.moreEntries", { n: entries.length - MAX_LIST }));
  return lines.join("\n") || T("fs.emptyDir");
}

async function readFile(root, { path: rel }, T) {
  const abs = resolveInside(root, rel, { mustExist: true });
  const stat = await fsp.stat(abs);
  if (stat.isDirectory()) throw new ToolError("fs.isDir");
  const fh = await fsp.open(abs, "r");
  try {
    const buf = Buffer.alloc(Math.min(stat.size, MAX_READ));
    await fh.read(buf, 0, buf.length, 0);
    if (looksBinary(buf)) return T("fs.binary", { size: stat.size });
    const text = buf.toString("utf8");
    return stat.size > MAX_READ ? `${text}\n\n${T("fs.truncated", { size: stat.size, max: MAX_READ })}` : text;
  } finally {
    await fh.close();
  }
}

async function writeFile(root, { path: rel, content }, T) {
  const abs = resolveInside(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, "utf8");
  return T("fs.written", { path: relOf(root, abs), n: Buffer.byteLength(content) });
}

async function editFile(root, { path: rel, old_text: oldText, new_text: newText }, T) {
  const abs = resolveInside(root, rel, { mustExist: true });
  const text = await fsp.readFile(abs, "utf8");
  const count = text.split(oldText).length - 1;
  if (count === 0) throw new ToolError("fs.oldTextMissing");
  if (count > 1) throw new ToolError("fs.oldTextMany", { n: count });
  await fsp.writeFile(abs, text.replace(oldText, () => String(newText ?? "")), "utf8");
  return T("fs.edited", { path: relOf(root, abs) });
}

async function searchFiles(root, { query, path: rel }, T) {
  const start = resolveInside(root, rel ?? ".", { mustExist: true });
  const q = String(query).toLowerCase();
  const out = [];
  async function walk(dir) {
    if (out.length >= MAX_MATCHES) return;
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (out.length >= MAX_MATCHES) return;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; // symlink'larga kirmaymiz
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(abs);
        continue;
      }
      const stat = await fsp.stat(abs);
      if (stat.size > MAX_READ) continue;
      const buf = await fsp.readFile(abs);
      if (looksBinary(buf)) continue;
      buf.toString("utf8").split("\n").forEach((line, i) => {
        if (out.length < MAX_MATCHES && line.toLowerCase().includes(q)) {
          out.push(`${relOf(root, abs)}:${i + 1}: ${line.trim().slice(0, 200)}`);
        }
      });
    }
  }
  await walk(start);
  if (!out.length) return T("fs.noMatches");
  return out.join("\n") + (out.length >= MAX_MATCHES ? `\n${T("fs.firstMatches", { n: MAX_MATCHES })}` : "");
}

/** `signal` — foydalanuvchi To'xtatish ni bossa (yoki sahifa qayta yuklansa) buyruq o'ldiriladi. */
function runCommand(root, { command }, T, signal) {
  if (signal?.aborted) return T("fs.cancelled");
  return new Promise((resolve) => {
    // POSIX: alohida jarayonlar guruhi — to'xtatilganda shell ichidagi dasturlar (npm, sleep...) ham o'ldiriladi
    const posix = process.platform !== "win32";
    const child = spawn(command, { cwd: fs.realpathSync(root), shell: true, windowsHide: true, detached: posix });
    let output = "";
    const add = (d) => {
      if (output.length < MAX_CMD_OUTPUT) output += d.toString();
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const kill = (note) => {
      try {
        if (posix) process.kill(-child.pid, "SIGKILL");
        else spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }).on("error", () => child.kill("SIGKILL"));
      } catch {
        child.kill("SIGKILL");
      }
      add(`\n${note}`);
    };
    const timer = setTimeout(() => kill(T("fs.timeout", { s: CMD_TIMEOUT_MS / 1000 })), CMD_TIMEOUT_MS);
    const onAbort = () => kill(T("fs.cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    child.on("close", (code) => {
      done();
      const trimmed = output.length >= MAX_CMD_OUTPUT ? `${output.slice(0, MAX_CMD_OUTPUT)}\n${T("fs.outputCut")}` : output;
      resolve(`exit code: ${code}\n${trimmed}`);
    });
    child.on("error", (err) => {
      done();
      resolve(T("fs.cmdFailed", { msg: err.message }));
    });
  });
}

const TOOLS = {
  list_dir: listDir,
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  search_files: searchFiles,
  run_command: runCommand,
};

// Foydalanuvchi ruxsatini talab qiladigan asboblar (ruxsat main.js da, mahalliy oynada so'raladi)
const NEEDS_APPROVAL = new Set(["write_file", "edit_file", "run_command"]);

// Argumentlar turi: "path" — loyiha ichidagi yo'l, "text" — bo'sh bo'lmagan matn, "str" — istalgan matn;
// "?" bilan tugasa — ixtiyoriy.
const ARGS = {
  list_dir: { path: "path?" },
  read_file: { path: "path" },
  write_file: { path: "path", content: "str" },
  edit_file: { path: "path", old_text: "text", new_text: "str?" },
  search_files: { query: "text", path: "path?" },
  run_command: { command: "text" },
};

/**
 * Argumentlarni bajarishdan (va ruxsat so'rashdan) OLDIN tekshiradi: yaroqsiz JSON, yetishmayotgan maydon yoki
 * papkadan tashqari yo'l uchun foydalanuvchi bezovta qilinmaydi. Xato bo'lsa ToolError tashlaydi.
 */
function checkArgs(root, name, args) {
  // Object.hasOwn: "constructor", "toString" kabi Object.prototype nomlari asbob deb qabul qilinmasin.
  // Nom faqat matn: ["run_command"] kabi massiv kalit sifatida matnga aylanib asbobni topardi, lekin
  // NEEDS_APPROVAL.has() uni tanimay ruxsat oynasi chiqmasdi.
  if (typeof name !== "string") throw new ToolError("fs.unknownTool", { name: typeof name });
  if (!Object.hasOwn(TOOLS, name)) throw new ToolError("fs.unknownTool", { name });
  // Server JSON bo'lmagan argumentlarni {"__invalid_json__": "..."} ko'rinishida yuboradi
  if (!args || typeof args !== "object" || Array.isArray(args) || "__invalid_json__" in args) throw new ToolError("fs.invalidArgs");
  for (const [arg, kind] of Object.entries(ARGS[name])) {
    const v = args[arg];
    if (v === undefined || v === null) {
      if (kind.endsWith("?")) continue;
      throw new ToolError(kind === "str" ? "fs.argString" : "fs.argRequired", { arg });
    }
    if (typeof v !== "string") throw new ToolError("fs.argString", { arg });
    if (v === "" && (kind === "path" || kind === "text")) throw new ToolError("fs.argRequired", { arg });
    // write_file yangi fayl yaratishi mumkin; qolganlari mavjud yo'l bilan ishlaydi
    if (kind.startsWith("path")) resolveInside(root, v, { mustExist: name !== "write_file" });
  }
}

/** Asbobni bajaradi. Natija: { output, isError }, matnlar `lang` tilida. Hech qachon istisno tashlamaydi. */
async function runTool(root, name, args, lang = "uz", signal = undefined) {
  const T = (key, vars) => tr(lang, key, vars);
  try {
    checkArgs(root, name, args ?? {});
    return { output: await TOOLS[name](root, args ?? {}, T, signal), isError: false };
  } catch (err) {
    return { output: errorText(err, lang), isError: true };
  }
}

module.exports = { runTool, checkArgs, errorText, resolveInside, NEEDS_APPROVAL, ToolError, MAX_READ };
