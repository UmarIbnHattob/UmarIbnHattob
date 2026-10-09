"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe } = require("../src/approval");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "omni-ap-"));
fs.writeFileSync(path.join(root, "old.html"), "x");
const big = Array.from({ length: 400 }, (_, i) => `<p class="row-${i}">${"lorem ".repeat(40)}</p>`).join("\n");

test("katta fayl uchun oyna matni qisqa bo'ladi", () => {
  const d = describe(root, "write_file", { path: "landing.html", content: big });
  assert.match(d.title, /Yangi fayl yaratish: landing\.html/);
  assert.match(d.detail, /400 qator/);
  assert.match(d.detail, /yana 392 qator/);
  assert.ok(d.detail.length < 1500, `detail juda uzun: ${d.detail.length}`);
  assert.ok(d.detail.split("\n").length <= 13);
});

test("mavjud faylni almashtirish ogohlantiriladi", () => {
  const d = describe(root, "write_file", { path: "old.html", content: "<h1>yangi</h1>" });
  assert.match(d.title, /Mavjud faylni qayta yozish/);
  assert.match(d.detail, /eski mazmun almashtiriladi/);
});

test("edit va buyruq ham qisqa", () => {
  const e = describe(root, "edit_file", { path: "a.js", old_text: big, new_text: big });
  assert.ok(e.detail.length < 1600);
  const r = describe(root, "run_command", { command: "echo " + "x".repeat(2000) });
  assert.ok(r.detail.length <= 501);
});
