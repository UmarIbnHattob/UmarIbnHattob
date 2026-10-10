// Ovozli xabar: soxta mikrofon (Chromium --use-fake-device-for-media-stream)
import { browser, userCtx, check, summary, SHOTS, WEB, API, sleep, inView } from "./h.mjs";

const b = await browser();
const RUN = Date.now().toString(36);
const fakeLog = async () => (await (await fetch("http://127.0.0.1:9100/_log?n=60")).json());
// getUserMedia ni kuzatamiz: chaqiruvlar soni, ochiq treklar; __gumFail bilan xato soxtalashtiriladi
const INIT = () => {
  window.__gum = { calls: 0, streams: [] };
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    window.__gum.calls++;
    if (window.__gumFail) throw new DOMException("x", window.__gumFail);
    await new Promise((r) => setTimeout(r, 400)); // ruxsat oynasi kabi kechikish
    const s = await orig(c);
    window.__gum.streams.push(s);
    return s;
  };
};
const live = (page) => page.evaluate(() => window.__gum.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length);

const { ctx } = await userCtx(b, { tag: "voice", prefs: { theme: "dark", voice_auto_send: false } });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const transcribes = [];
page.on("request", (r) => r.url().includes("/voice/transcribe") && transcribes.push(r.url()));
await page.goto(WEB + "/chat");
await page.waitForLoadState("networkidle");
const mic = page.getByRole("button", { name: "Ovozli xabar", exact: true });
const finish = page.getByRole("button", { name: /Tugatish|Yakunlash|To‘xtatish va yuborish|finish/i }).or(page.locator("button.bg-red-600"));
const ta = page.locator("textarea");

// 1) Ikki marta bosish -> bitta oqim; yozuv -> matn maydonga qo'shiladi
await mic.dblclick();
await page.locator("canvas").first().waitFor({ timeout: 5000 });
await sleep(1200);
check("mic dblclick: getUserMedia bir marta", (await page.evaluate(() => window.__gum.calls)) === 1, String(await page.evaluate(() => window.__gum.calls)));
const drawn = await page.locator("canvas").first().evaluate((c) => {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
});
check("to'lqin chizildi", drawn);
// Tor ekranda yozish vidjeti matn maydonini siqib qo'ymaydi
await page.setViewportSize({ width: 375, height: 760 });
await sleep(300);
const taW = (await ta.boundingBox()).width;
check("375px: yozish paytida textarea >= 160px", taW >= 160, `${Math.round(taW)}px`);
check("375px: yuborish tugmasi ko'rinadi", await inView(page.getByRole("button", { name: "Yuborish" })));
await page.screenshot({ path: `${SHOTS}voice-recording-375.png` });
await page.setViewportSize({ width: 1280, height: 800 });
// Esc: model tanlagich ochiq bo'lsa faqat uni yopadi
await page.locator('button[aria-haspopup="listbox"]').click();
await page.keyboard.press("Escape");
await sleep(300);
check("Esc: tanlagich yopildi, yozuv davom etmoqda", (await page.getByRole("listbox").count()) === 0 && (await page.locator("canvas").count()) >= 1);
await finish.first().click();
await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("Salom bu ovozli xabar"), null, { timeout: 15000 });
check("yozuv: matn maydonga qo'shildi", (await ta.inputValue()).includes("Salom bu ovozli xabar"));
await sleep(300);
check("yozuv tugagach mikrofon bo'shatildi", (await live(page)) === 0, String(await live(page)));

// 2) Auto-send: yozuv paytida yozilgan matn va tanlangan model ishlatiladi; yozuv boshlangan emas, ochiq suhbatga
await ctx.request.patch(`${API}/me`, { data: { preferences: { voice_auto_send: true } } });
await page.reload();
await page.waitForLoadState("networkidle");
await ta.fill(`birinchi suhbat ${RUN}`);
await ta.press("Enter");
await page.getByText(`Javob: birinchi suhbat ${RUN}`).waitFor({ timeout: 15000 });
const convA = new URL(page.url()).searchParams.get("c");
await sleep(800);
await mic.click();
await page.locator("canvas").first().waitFor({ timeout: 5000 });
await sleep(500);
await page.getByRole("button", { name: "Yangi suhbat" }).first().click(); // B: yangi suhbat
await ta.fill(`yozuv paytida ${RUN}`);
await page.locator('button[aria-haspopup="listbox"]').click();
await page.getByRole("combobox", { name: "Model qidirish…" }).fill("Gemini 2.5 Flash");
await page.keyboard.press("Enter");
await sleep(300);
await finish.first().click();
await page.getByText(`yozuv paytida ${RUN} Salom bu ovozli xabar`).first().waitFor({ timeout: 15000 });
await page.getByText(`Javob: yozuv paytida ${RUN}`).waitFor({ timeout: 15000 });
const entry = (await fakeLog()).find((e) => e.user?.includes(`yozuv paytida ${RUN}`));
check("auto-send: yozuv paytida yozilgan matn yo'qolmadi", !!entry, entry?.user);
check("auto-send: yozuv paytida tanlangan model ishlatildi", entry?.model === "gemini-2.5-flash", entry?.model);
const convB = new URL(page.url()).searchParams.get("c");
const msgsA = await (await ctx.request.get(`${API}/conversations/${convA}/messages`)).json();
check("auto-send: xabar ochiq (B) suhbatga ketdi, A ga emas", convB && convB !== convA && !msgsA.some((m) => m.content.includes("yozuv paytida")));

// 3) Yozuv paytida sahifadan chiqish: hech narsa yuborilmaydi, mikrofon bo'shaydi
const n0 = transcribes.length;
await mic.click();
await page.locator("canvas").first().waitFor({ timeout: 5000 });
await sleep(600);
await page.locator("a[href='/agent']").first().click();
await page.waitForURL("**/agent");
await sleep(2500);
check("sahifadan chiqish: transcribe so'rovi yuborilmadi", transcribes.length === n0, `${transcribes.length - n0}`);
check("sahifadan chiqish: mikrofon bo'shatildi", (await live(page)) === 0);

// 4) Xato turlari: NotFoundError / NotAllowedError; muvaffaqiyatdan keyin eski xabar tozalanadi
await ctx.request.patch(`${API}/me`, { data: { preferences: { voice_auto_send: false } } });
await page.goto(WEB + "/chat");
await page.waitForLoadState("networkidle");
await page.evaluate(() => (window.__gumFail = "NotFoundError"));
await mic.click();
await sleep(400);
check("NotFoundError: 'Mikrofon topilmadi'", await page.getByText("Mikrofon topilmadi").isVisible());
await page.evaluate(() => (window.__gumFail = "NotAllowedError"));
await mic.click();
await sleep(400);
check("NotAllowedError: 'ruxsat berilmadi'", await page.getByText("Mikrofonga ruxsat berilmadi").isVisible());
await page.evaluate(() => (window.__gumFail = null));
await mic.click();
await page.locator("canvas").first().waitFor({ timeout: 5000 });
await sleep(800);
await finish.first().click();
await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("Salom"), null, { timeout: 15000 });
check("muvaffaqiyatdan keyin eski 'ruxsat yo'q' xabari tozalandi", !(await page.getByText("Mikrofonga ruxsat berilmadi").isVisible()));

check("sahifada JS xatosi yo'q", errors.length === 0, errors.join(" | ").slice(0, 300));
await b.close();
summary();
