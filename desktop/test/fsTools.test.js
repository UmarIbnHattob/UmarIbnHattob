"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runTool, MAX_READ } = require("../src/fsTools");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omni-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "app.js"), "const a = 1;\nconsole.log('TODO salom');\n");
  fs.writeFileSync(path.join(root, "README.md"), "# Loyiha\n");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules", "x.js"), "TODO yashirin");
  return root;
}

test("list/read/search ishlaydi, node_modules o'tkazib yuboriladi", async () => {
  const root = project();
  assert.match((await runTool(root, "list_dir", { path: "." })).output, /src\/\n/);
  assert.equal((await runTool(root, "read_file", { path: "README.md" })).output, "# Loyiha\n");
  const s = (await runTool(root, "search_files", { query: "todo" })).output;
  assert.match(s, /src[\\/]app\.js:2:/);
  assert.doesNotMatch(s, /node_modules/);
});

test("papkadan tashqariga chiqish bloklanadi", async () => {
  const root = project();
  for (const p of ["../etc/passwd", "/etc/passwd", "src/../../x", "a\0b"]) {
    const r = await runTool(root, "read_file", { path: p });
    assert.equal(r.isError, true, p);
  }
  const w = await runTool(root, "write_file", { path: "../evil.txt", content: "x" });
  assert.equal(w.isError, true);
  assert.equal(fs.existsSync(path.join(root, "..", "evil.txt")), false);
});

test("symlink orqali tashqariga chiqish bloklanadi", { skip: process.platform === "win32" }, async () => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "SIR");
  fs.symlinkSync(outside, path.join(root, "link"));
  assert.equal((await runTool(root, "read_file", { path: "link/secret.txt" })).isError, true);
  assert.equal((await runTool(root, "write_file", { path: "link/new.txt", content: "x" })).isError, true);
  assert.equal(fs.existsSync(path.join(outside, "new.txt")), false);
});

test("write va edit", async () => {
  const root = project();
  await runTool(root, "write_file", { path: "lib/util.js", content: "export const x = 1;\n" });
  assert.equal(fs.readFileSync(path.join(root, "lib/util.js"), "utf8"), "export const x = 1;\n");
  const ok = await runTool(root, "edit_file", { path: "src/app.js", old_text: "const a = 1;", new_text: "const a = 2;" });
  assert.equal(ok.isError, false);
  assert.match(fs.readFileSync(path.join(root, "src/app.js"), "utf8"), /const a = 2;/);
  const missing = await runTool(root, "edit_file", { path: "src/app.js", old_text: "yo'q", new_text: "x" });
  assert.match(missing.output, /topilmadi/);
  fs.writeFileSync(path.join(root, "dup.txt"), "a a");
  assert.match((await runTool(root, "edit_file", { path: "dup.txt", old_text: "a", new_text: "b" })).output, /2 marta/);
  // "$&" kabi maxsus belgilar so'zma-so'z yoziladi
  await runTool(root, "edit_file", { path: "README.md", old_text: "# Loyiha", new_text: "narx: $& $1" });
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), "narx: $& $1\n");
});

test("katta va ikkilik fayllar", async () => {
  const root = project();
  fs.writeFileSync(path.join(root, "big.txt"), "x".repeat(MAX_READ + 10));
  assert.match((await runTool(root, "read_file", { path: "big.txt" })).output, /faqat birinchi/);
  fs.writeFileSync(path.join(root, "img.bin"), Buffer.from([1, 0, 2, 3]));
  assert.match((await runTool(root, "read_file", { path: "img.bin" })).output, /ikkilik/);
});

test("run_command loyiha papkasida ishlaydi", async () => {
  const root = project();
  const r = await runTool(root, "run_command", { command: process.platform === "win32" ? "cd" : "pwd && echo salom" });
  assert.match(r.output, /exit code: 0/);
  assert.match(r.output, new RegExp(path.basename(root)));
});

test("noma'lum asbob", async () => {
  const root = project();
  // Object.prototype dagi nomlar ham noma'lum (avval "constructor" papka yo'lini qaytarardi)
  for (const name of ["rm_rf", "constructor", "toString", "hasOwnProperty", "__proto__", ["read_file"]]) {
    const r = await runTool(root, name, { path: "README.md" });
    assert.equal(r.isError, true, String(name));
    assert.match(r.output, /Noma'lum asbob/, String(name));
  }
});
