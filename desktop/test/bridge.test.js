"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { newState, cancelJobs, resetFolder, resetOnNavigation, callTool, saveImage } = require("../src/bridge");
const { runTool, checkArgs } = require("../src/fsTools");
const { describe } = require("../src/approval");
const { DICTS, normLang } = require("../src/i18n");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omni-br-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Loyiha\n");
  return root;
}

/** Soxta ruxsat oynasi: chaqiruvlarni yozib boradi va berilgan javobni qaytaradi. */
function fakeAsk(answer = { approved: true, remember: false }) {
  const calls = [];
  const ask = async (req) => {
    calls.push(req);
    return typeof answer === "function" ? answer(req) : answer;
  };
  return { ask, calls };
}

const PNG = Buffer.from("89504e470d0a1a0a0000", "hex").toString("base64");

test("yaroqsiz yoki noto'g'ri argumentlar uchun ruxsat oynasi chiqmaydi", async () => {
  const root = project();
  const s = newState();
  s.root = root;
  const { ask, calls } = fakeAsk();
  const cases = [
    ["write_file", { __invalid_json__: "{not json" }, /yaroqsiz/],
    ["write_file", {}, /path argumenti/],
    ["write_file", { path: "a.txt" }, /content argumenti matn/],
    ["write_file", { path: "", content: "x" }, /path argumenti bo'sh/],
    ["write_file", { path: 5, content: "x" }, /path argumenti matn/],
    ["write_file", ["a.txt", "x"], /yaroqsiz/],
    ["write_file", { path: "../evil.txt", content: "x" }, /tashqariga/],
    ["write_file", { path: "sub/../../evil.txt", content: "x" }, /tashqariga/],
    ["write_file", { path: "/etc/evil.txt", content: "x" }, /nisbiy/],
    ["edit_file", { path: "README.md", old_text: "", new_text: "x" }, /old_text argumenti bo'sh/],
    ["edit_file", { path: "yoq.md", old_text: "a", new_text: "b" }, /Topilmadi/],
    ["run_command", { command: "" }, /command argumenti bo'sh/],
    ["run_command", { __invalid_json__: "echo" }, /yaroqsiz/],
  ];
  for (const [name, args, re] of cases) {
    const r = await callTool(s, name, args, ask);
    assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.match(r.output, re, `${name} ${JSON.stringify(args)}`);
  }
  assert.equal(calls.length, 0, "hech qanday oyna chiqmasligi kerak");
  assert.equal(fs.existsSync(path.join(root, "..", "evil.txt")), false);
});

test("symlink orqali tashqariga yozish ruxsat so'ralmasdan rad etiladi", { skip: process.platform === "win32" }, async () => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "omni-out-"));
  fs.symlinkSync(outside, path.join(root, "lnk"));
  const s = newState();
  s.root = root;
  const { ask, calls } = fakeAsk();
  const r = await callTool(s, "write_file", { path: "lnk/x.txt", content: "x" }, ask);
  assert.equal(r.isError, true);
  assert.match(r.output, /Symlink/);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(path.join(outside, "x.txt")), false);
});

test("to'g'ri chaqiruv: ruxsat so'raladi, keyin bajariladi; rad etilsa bajarilmaydi", async () => {
  const root = project();
  const s = newState();
  s.root = root;
  const yes = fakeAsk();
  const ok = await callTool(s, "write_file", { path: "a.txt", content: "salom" }, yes.ask);
  assert.deepEqual(ok, { output: "Yozildi: a.txt (5 bayt)", isError: false });
  assert.equal(yes.calls.length, 1);
  assert.match(yes.calls[0].title, /Yangi fayl yaratish: a\.txt/);
  assert.equal(yes.calls[0].root, root);

  const no = fakeAsk({ approved: false, remember: false });
  const denied = await callTool(s, "write_file", { path: "b.txt", content: "x" }, no.ask);
  assert.deepEqual(denied, { output: "Foydalanuvchi bu amalni rad etdi.", isError: true });
  assert.equal(fs.existsSync(path.join(root, "b.txt")), false);

  // O'qish asboblari ruxsatsiz ishlaydi
  const read = fakeAsk();
  assert.equal((await callTool(s, "read_file", { path: "a.txt" }, read.ask)).output, "salom");
  assert.equal(read.calls.length, 0);
});

test("sahifa qayta yuklansa yoki renderer qulasa: papka va 'qayta so'rama' ruxsatlari bekor qilinadi", async () => {
  for (const event of ["did-navigate", "render-process-gone"]) {
    const root = project();
    const wc = new EventEmitter();
    const s = newState();
    resetOnNavigation(wc, s);
    s.root = root;
    const first = fakeAsk({ approved: true, remember: true });
    await callTool(s, "write_file", { path: "a.txt", content: "1" }, first.ask);
    assert.equal(s.autoApprove.has("write_file"), true);

    wc.emit(event);
    assert.equal(s.root, null, event);
    assert.equal(s.autoApprove.size, 0, event);
    const after = fakeAsk();
    const r = await callTool(s, "write_file", { path: "after-reload.txt", content: "x" }, after.ask);
    assert.equal(r.isError, true);
    assert.match(r.output, /Avval papka tanlang/);
    assert.equal(after.calls.length, 0);
    assert.equal(fs.existsSync(path.join(root, "after-reload.txt")), false);

    // Papka qayta tanlansa, ruxsat yana so'raladi
    s.root = root;
    const again = fakeAsk();
    await callTool(s, "write_file", { path: "b.txt", content: "2" }, again.ask);
    assert.equal(again.calls.length, 1, event);
  }
});

test("ruxsat oynasi ochiq turganda sahifa qayta yuklansa, amal bajarilmaydi va ruxsat eslab qolinmaydi", async () => {
  const root = project();
  const wc = new EventEmitter();
  const s = newState();
  resetOnNavigation(wc, s);
  s.root = root;
  const r = await callTool(s, "write_file", { path: "late.txt", content: "x" }, async () => {
    wc.emit("did-navigate");
    return { approved: true, remember: true };
  });
  assert.equal(r.isError, true);
  assert.match(r.output, /qayta yuklandi/);
  assert.equal(fs.existsSync(path.join(root, "late.txt")), false);
  assert.equal(s.autoApprove.size, 0);
});

test("To'xtatish, sahifa qayta yuklanishi va oyna yopilishi ishlayotgan buyruqni o'ldiradi", { skip: process.platform === "win32" }, async () => {
  // resetFolder — main.js da oyna "closed" va ilova "will-quit" hodisalarida chaqiriladi
  for (const stop of ["cancel", "did-navigate", "resetFolder"]) {
    const root = project();
    const wc = new EventEmitter();
    const s = newState();
    resetOnNavigation(wc, s);
    s.root = root;
    s.autoApprove.add("run_command");
    const t0 = Date.now();
    const pending = callTool(s, "run_command", { command: "sleep 5; echo tugadi > done.txt" }, fakeAsk().ask);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(s.jobs.size, 1);
    if (stop === "cancel") cancelJobs(s);
    else if (stop === "resetFolder") resetFolder(s);
    else wc.emit("did-navigate");
    const r = await pending;
    assert.ok(Date.now() - t0 < 3000, `${stop}: buyruq darhol to'xtashi kerak`);
    assert.match(r.output, /foydalanuvchi to'xtatdi/, stop);
    assert.equal(s.jobs.size, 0);
    await new Promise((ok) => setTimeout(ok, 200));
    assert.equal(fs.existsSync(path.join(root, "done.txt")), false, stop);
  }
});

test("saveImage: kengaytma va yo'l ruxsatdan oldin tekshiriladi", async () => {
  const root = project();
  const s = newState();
  s.root = root;
  const { ask, calls } = fakeAsk();
  assert.match((await saveImage(s, "logo.exe", PNG, ask)).output, /Faqat \.png/);
  assert.match((await saveImage(s, "../escape.png", PNG, ask)).output, /tashqariga/);
  assert.equal(calls.length, 0);
  const ok = await saveImage(s, "assets/logo.png", PNG, ask);
  assert.equal(ok.isError, false);
  assert.match(ok.output, /Rasm saqlandi: assets\/logo\.png/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].image, true);
  assert.ok(fs.existsSync(path.join(root, "assets", "logo.png")));
});

test("saveImage: mavjud faylni qayta yozish uchun 'qayta so'rama' bo'lsa ham ruxsat so'raladi", async () => {
  const root = project();
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "logo.png"), "MENING LOGOTIPIM");
  const s = newState();
  s.root = root;
  s.autoApprove.add("save_image");

  // Yangi fayl — so'ralmaydi
  const fresh = fakeAsk();
  assert.equal((await saveImage(s, "assets/new.png", PNG, fresh.ask)).isError, false);
  assert.equal(fresh.calls.length, 0);

  // Mavjud fayl — rad etilsa, fayl o'zgarmaydi; "qayta so'rama" belgisi yo'q
  const no = fakeAsk({ approved: false, remember: true });
  const denied = await saveImage(s, "assets/logo.png", PNG, no.ask);
  assert.equal(denied.isError, true);
  assert.equal(no.calls.length, 1);
  assert.equal(no.calls[0].overwrite, true);
  assert.match(no.calls[0].title, /Mavjud rasmni qayta yozish: assets\/logo\.png/);
  assert.match(no.calls[0].detail, /eski mazmun almashtiriladi/);
  assert.equal(fs.readFileSync(path.join(root, "assets", "logo.png"), "utf8"), "MENING LOGOTIPIM");

  // Ruxsat berilsa yoziladi, lekin keyingi qayta yozish yana so'raladi
  const yes = fakeAsk({ approved: true, remember: true });
  assert.equal((await saveImage(s, "assets/logo.png", PNG, yes.ask)).isError, false);
  assert.equal(fs.readFileSync(path.join(root, "assets", "logo.png")).toString("base64"), PNG);
  const again = fakeAsk();
  await saveImage(s, "assets/logo.png", PNG, again.ask);
  assert.equal(again.calls.length, 1);
});

test("saveImage unique: ilova o'zgartirgan nom band bo'lsa bo'sh nom tanlanadi (logo-1.png)", async () => {
  const root = project();
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "logo.png"), "MENING LOGOTIPIM");
  const s = newState();
  s.root = root;
  s.autoApprove.add("save_image");
  const { ask, calls } = fakeAsk();
  const r1 = await saveImage(s, "assets/logo.png", PNG, ask, { unique: true });
  assert.equal(r1.isError, false);
  assert.equal(r1.path, "assets/logo-1.png");
  assert.match(r1.output, /Rasm saqlandi: assets\/logo-1\.png/);
  const r2 = await saveImage(s, "assets/logo.png", PNG, ask, { unique: true });
  assert.equal(r2.path, "assets/logo-2.png");
  assert.equal(calls.length, 0, "yangi fayllar — ruxsat eslab qolingan");
  assert.equal(fs.readFileSync(path.join(root, "assets", "logo.png"), "utf8"), "MENING LOGOTIPIM");
  assert.ok(fs.existsSync(path.join(root, "assets", "logo-1.png")));
  assert.ok(fs.existsSync(path.join(root, "assets", "logo-2.png")));
  // Nom bo'sh bo'lsa o'zgarmaydi
  assert.equal((await saveImage(s, "assets/icon.png", PNG, ask, { unique: true })).path, "assets/icon.png");
});

test("nishoni yo'q symlink orqali papkadan tashqarida fayl yaratilmaydi", { skip: process.platform === "win32" }, async () => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "omni-out-"));
  fs.symlinkSync(path.join(outside, "created.txt"), path.join(root, "dangling.txt"));
  fs.symlinkSync(path.join(outside, "created.png"), path.join(root, "dangling.png"));
  const s = newState();
  s.root = root;
  const { ask, calls } = fakeAsk();
  const w = await callTool(s, "write_file", { path: "dangling.txt", content: "x" }, ask);
  assert.equal(w.isError, true);
  assert.match(w.output, /nishoni mavjud bo'lmagan symlink/);
  const img = await saveImage(s, "dangling.png", PNG, ask);
  assert.equal(img.isError, true);
  // Oraliq papka o'rnidagi nishonsiz symlink: xabar aynan shu symlinkni ko'rsatadi
  fs.symlinkSync(path.join(outside, "newdir"), path.join(root, "dlink"));
  const deep = await callTool(s, "write_file", { path: "dlink/sub/x.txt", content: "x" }, ask);
  assert.equal(deep.isError, true);
  assert.match(deep.output, /^dlink — nishoni mavjud bo'lmagan symlink/);
  assert.equal(calls.length, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
  // Fayl ichidan yo'l — avvalgidek "Topilmadi" (ENOTDIR xom xatosi emas)
  assert.equal((await callTool(s, "read_file", { path: "README.md/x.txt" }, ask)).output, "Topilmadi: README.md/x.txt");
  // Loyiha ichidagi oddiy symlink avvalgidek ishlaydi
  fs.symlinkSync(path.join(root, "README.md"), path.join(root, "readme-link.md"));
  assert.equal((await callTool(s, "read_file", { path: "readme-link.md" }, ask)).output, "# Loyiha\n");
});

test("Object.prototype nomlari va matn bo'lmagan nomlar asbob emas (ruxsatsiz bajarilmaydi)", async () => {
  const root = project();
  const s = newState();
  s.root = root;
  const { ask, calls } = fakeAsk();
  for (const name of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__", "isPrototypeOf"]) {
    assert.throws(() => checkArgs(root, name, {}), /Noma'lum asbob/, name);
    const r = await callTool(s, name, {}, ask);
    assert.deepEqual(r, { output: `Noma'lum asbob: ${name}`, isError: true }, name);
  }
  // ["run_command"] matnga aylanib asbobni topardi, lekin ruxsat ro'yxatida yo'q — oynasiz bajarilardi
  for (const name of [["run_command"], ["write_file"], { toString: null }, 5, null]) {
    const r = await callTool(s, name, { command: "echo x > ran.txt", path: "README.md", content: "buzildi" }, ask);
    assert.equal(r.isError, true, JSON.stringify(name));
    assert.match(r.output, /Noma'lum asbob/);
  }
  assert.equal(calls.length, 0);
  await new Promise((ok) => setTimeout(ok, 200));
  assert.equal(fs.existsSync(path.join(root, "ran.txt")), false);
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), "# Loyiha\n");
});

test("matnlar interfeys tilida (en/ru), noma'lum til -> o'zbekcha", async () => {
  const root = project();
  const s = newState();
  s.root = root;
  s.lang = "en";
  const en = fakeAsk({ approved: false, remember: false });
  assert.equal((await callTool(s, "write_file", { path: "a.txt", content: "x" }, en.ask)).output, "The user denied this action.");
  assert.equal(en.calls[0].title, "Create new file: a.txt");
  assert.match((await callTool(s, "write_file", { __invalid_json__: "{" }, en.ask)).output, /^Invalid tool arguments/);
  assert.equal((await callTool(s, "read_file", { path: "../x" }, en.ask)).output, "Going outside the project folder is not allowed");

  s.lang = "ru";
  assert.equal((await callTool(s, "read_file", { path: "../x" }, en.ask)).output, "Выходить за пределы папки проекта нельзя");
  assert.match((await runTool(root, "write_file", { path: "b.txt", content: "abc" }, "ru")).output, /^Записано: b\.txt \(3 Б\)/);
  assert.match(describe(root, "run_command", { command: "ls" }, "ru").title, /Запустить команду/);

  assert.equal(normLang("en-US"), "en");
  assert.equal(normLang("de"), "uz");
  for (const bad of ["constructor", "toString", "__proto__"]) assert.equal(normLang(bad), "uz", bad);
  assert.equal(normLang(undefined), "uz");
});

test("barcha tillarda bir xil kalitlar va {o'zgaruvchilar}", () => {
  const keys = Object.keys(DICTS.uz).sort();
  for (const lang of ["en", "ru"]) {
    assert.deepEqual(Object.keys(DICTS[lang]).sort(), keys, lang);
    for (const k of keys) {
      const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(vars(DICTS[lang][k]), vars(DICTS.uz[k]), `${lang} ${k}`);
    }
  }
});

test("checkArgs to'g'ri chaqiruvlarni o'tkazadi", () => {
  const root = project();
  checkArgs(root, "list_dir", {});
  checkArgs(root, "list_dir", { path: null });
  checkArgs(root, "write_file", { path: "new/dir/file.txt", content: "" });
  checkArgs(root, "edit_file", { path: "README.md", old_text: "# Loyiha" });
  checkArgs(root, "search_files", { query: "x" });
  checkArgs(root, "run_command", { command: "ls" });
  assert.throws(() => checkArgs(root, "rm_rf", {}), /Noma'lum asbob/);
});
