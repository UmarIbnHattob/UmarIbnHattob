// Agent asboblari: faqat foydalanuvchi tanlagan papka ICHIDA ishlaydi.
// Bu modul Electron'ga bog'liq emas — alohida testlanadi (test/fsTools.test.js).
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MAX_READ = 256 * 1024; // 256 KB
const MAX_LIST = 500;
const MAX_MATCHES = 200;
const MAX_CMD_OUTPUT = 20 * 1024;
const CMD_TIMEOUT_MS = 120_000;
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__", ".cache"]);

class ToolError extends Error {}

/**
 * Nisbiy yo'lni ildiz ichidagi absolyut yo'lga aylantiradi.
 * `../` yoki symlink orqali ildizdan tashqariga chiqish taqiqlanadi.
 */
function resolveInside(root, rel, { mustExist = false } = {}) {
  if (typeof rel !== "string" || rel.includes("\0")) throw new ToolError("Yo'l noto'g'ri");
  if (path.isAbsolute(rel)) throw new ToolError("Faqat nisbiy yo'l ishlatiladi (masalan 'src/app.js')");
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, rel || ".");
  const inside = (p) => p === realRoot || p.startsWith(realRoot + path.sep);
  if (!inside(target)) throw new ToolError("Loyiha papkasidan tashqariga chiqish mumkin emas");

  // Mavjud eng yaqin ota-papkaning haqiqiy yo'lini tekshiramiz (symlink tashqariga olib chiqmasin)
  let probe = target;
  while (!fs.existsSync(probe)) {
    if (mustExist) throw new ToolError(`Topilmadi: ${rel}`);
    probe = path.dirname(probe);
  }
  if (!inside(fs.realpathSync(probe))) throw new ToolError("Symlink loyiha papkasidan tashqariga olib chiqadi");
  return target;
}

const relOf = (root, abs) => path.relative(fs.realpathSync(root), abs) || ".";

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

async function listDir(root, { path: rel = "." }) {
  const abs = resolveInside(root, rel, { mustExist: true });
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const lines = entries.slice(0, MAX_LIST).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  if (entries.length > MAX_LIST) lines.push(`… yana ${entries.length - MAX_LIST} ta`);
  return lines.join("\n") || "(bo'sh papka)";
}

async function readFile(root, { path: rel }) {
  const abs = resolveInside(root, rel, { mustExist: true });
  const stat = await fsp.stat(abs);
  if (stat.isDirectory()) throw new ToolError("Bu papka, fayl emas — list_dir ishlating");
  const fh = await fsp.open(abs, "r");
  try {
    const buf = Buffer.alloc(Math.min(stat.size, MAX_READ));
    await fh.read(buf, 0, buf.length, 0);
    if (looksBinary(buf)) return `(ikkilik fayl, ${stat.size} bayt — o'qilmadi)`;
    const text = buf.toString("utf8");
    return stat.size > MAX_READ ? `${text}\n\n… (fayl ${stat.size} bayt, faqat birinchi ${MAX_READ} bayt ko'rsatildi)` : text;
  } finally {
    await fh.close();
  }
}

async function writeFile(root, { path: rel, content }) {
  if (typeof content !== "string") throw new ToolError("content matn bo'lishi kerak");
  const abs = resolveInside(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, "utf8");
  return `Yozildi: ${relOf(root, abs)} (${Buffer.byteLength(content)} bayt)`;
}

async function editFile(root, { path: rel, old_text: oldText, new_text: newText }) {
  if (typeof oldText !== "string" || !oldText) throw new ToolError("old_text bo'sh bo'lmasligi kerak");
  const abs = resolveInside(root, rel, { mustExist: true });
  const text = await fsp.readFile(abs, "utf8");
  const count = text.split(oldText).length - 1;
  if (count === 0) throw new ToolError("old_text faylda topilmadi — avval faylni o'qing");
  if (count > 1) throw new ToolError(`old_text faylda ${count} marta uchradi — kengroq, noyob bo'lak bering`);
  await fsp.writeFile(abs, text.replace(oldText, () => String(newText ?? "")), "utf8");
  return `O'zgartirildi: ${relOf(root, abs)}`;
}

async function searchFiles(root, { query, path: rel = "." }) {
  if (!query) throw new ToolError("query bo'sh");
  const start = resolveInside(root, rel, { mustExist: true });
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
  if (!out.length) return "Hech narsa topilmadi";
  return out.join("\n") + (out.length >= MAX_MATCHES ? `\n… (birinchi ${MAX_MATCHES} ta natija)` : "");
}

function runCommand(root, { command }) {
  if (!command || typeof command !== "string") throw new ToolError("command bo'sh");
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: fs.realpathSync(root), shell: true, windowsHide: true });
    let output = "";
    const add = (d) => {
      if (output.length < MAX_CMD_OUTPUT) output += d.toString();
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      add(`\n(${CMD_TIMEOUT_MS / 1000}s vaqt tugadi — to'xtatildi)`);
    }, CMD_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      const trimmed = output.length >= MAX_CMD_OUTPUT ? output.slice(0, MAX_CMD_OUTPUT) + "\n… (chiqish qisqartirildi)" : output;
      resolve(`exit code: ${code}\n${trimmed}`);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(`Buyruqni ishga tushirib bo'lmadi: ${err.message}`);
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

/** Asbobni bajaradi. Natija: { output, isError }. Hech qachon istisno tashlamaydi. */
async function runTool(root, name, args) {
  const fn = TOOLS[name];
  if (!fn) return { output: `Noma'lum asbob: ${name}`, isError: true };
  try {
    return { output: await fn(root, args || {}), isError: false };
  } catch (err) {
    return { output: err instanceof ToolError ? err.message : `Xato: ${err.message}`, isError: true };
  }
}

module.exports = { runTool, resolveInside, NEEDS_APPROVAL, ToolError, MAX_READ };
