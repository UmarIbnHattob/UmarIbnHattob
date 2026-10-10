// Chat oqimlari: yuborish, URL, reload, ikki marta bosish, to'xtatish, xatolar, oflayn, o'chirilgan suhbat, nusxa, preview
import { browser, userCtx, check, summary, SHOTS, WEB, API, sleep } from "./h.mjs";

const b = await browser();
// Uzun shaxsiy ko'rsatma: SYSTEMCHECK javobi ~1500 belgi (~3.5 s oqim) — To'xtatish sinovi uchun
const { ctx } = await userCtx(b, { tag: "chat", prefs: { theme: "light", custom_instructions: "Qisqa javob ber. ".repeat(150) } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const ta = page.locator("textarea");
const sendBtn = page.getByRole("button", { name: "Yuborish" });
const userBubbles = (txt) => page.locator("div.bg-blue-600 p", { hasText: txt });
const lastAssistant = () => page.locator("div.bg-neutral-800.rounded-lg").last();
const idle = () => page.waitForSelector('button[aria-label="Yuborish"]:not([disabled])', { timeout: 15000 });

async function send(text, how = "click") {
  await ta.fill(text);
  if (how === "dbl") await sendBtn.dblclick();
  else if (how === "enter") await ta.press("Enter");
  else await sendBtn.click();
}

await page.goto(WEB + "/chat");
await page.waitForLoadState("networkidle");

// 1) Yuborish (Auto -> platforma Gemini), URL da ?c=, reload'da suhbat qayta ochiladi
await send("salom dunyo", "enter");
await page.getByText("Javob: salom dunyo").waitFor({ timeout: 15000 });
await idle();
const url1 = new URL(page.url());
const cid = url1.searchParams.get("c");
check("chat: javob keldi va URL da ?c=<id>", /^[0-9a-f-]{36}$/.test(cid ?? ""), page.url());
check("chat: Auto yo'nalish yorlig'i (tarjima qilingan sabab)", await page.getByText(/Auto →.*·/).first().isVisible());
await page.reload();
await page.getByText("Javob: salom dunyo").waitFor({ timeout: 10000 });
check("chat: reloaddan keyin faol suhbat qayta ochildi", (await userBubbles("salom dunyo").count()) === 1);

// 2) Mavjud suhbatda "Yuborish" ni ikki marta bosish — javob bekor qilinmaydi, xabar bir marta
await send("ikki marta SYSTEMCHECK", "dbl");
await sleep(400);
check("dblclick: uchish paytida tugma o'chiq (Stop emas)", await sendBtn.isDisabled().catch(() => false));
await page.getByText("SYSTEM=<<").last().waitFor({ timeout: 15000 });
await idle();
check("dblclick: xabar bir marta yuborildi", (await userBubbles("ikki marta SYSTEMCHECK").count()) === 1);
check("dblclick: javob to'liq keldi (bekor qilinmadi)", (await lastAssistant().innerText()).includes(">>"));

// 3) To'xtatish: qisman javob saqlanadi, reloaddan keyin takror yo'q
await send("toxtat SYSTEMCHECK");
await page.getByRole("button", { name: "To‘xtatish" }).waitFor({ timeout: 5000 });
await sleep(1300);
await page.getByRole("button", { name: "To‘xtatish" }).click();
await idle();
const partial = await lastAssistant().innerText();
check("stop: qisman javob ko'rinib qoldi", partial.includes("SYSTEM=<<") && !partial.includes(">>"), partial.slice(-40));
await sleep(500);
await page.reload();
await page.getByText("toxtat SYSTEMCHECK").waitFor();
check("stop: reloaddan keyin xabar bir marta", (await userBubbles("toxtat SYSTEMCHECK").count()) === 1);
check("stop: reloaddan keyin qisman javob saqlangan", (await page.locator("div.bg-neutral-800.rounded-lg", { hasText: "SYSTEM=<<" }).count()) >= 2);

// 4) Provayder xatosi (500): pufakchalar olinadi, matn kiritish maydoniga qaytadi, tarjima qilingan xabar
await send("xato500 sinov");
await sleep(2500);
check("xato: foydalanuvchi pufakchasi olib tashlandi", (await userBubbles("xato500 sinov").count()) === 0);
check("xato: matn kiritish maydoniga qaytdi", (await ta.inputValue()) === "xato500 sinov");
const errBox = page.locator("div.bg-red-500\\/10");
check("xato: xabar ko'rindi", await errBox.isVisible(), (await errBox.innerText().catch(() => "")).slice(0, 120));
await page.reload();
await page.getByText("toxtat SYSTEMCHECK").waitFor();
check("xato: reloaddan keyin ham savol tarixda yo'q", (await userBubbles("xato500 sinov").count()) === 0);

// 5) Yangi suhbatning birinchi yuborishi muvaffaqiyatsiz: ro'yxatda bo'sh "Yangi suhbat" qolmaydi
const before = (await (await ctx.request.get(`${API}/conversations`)).json()).length;
await page.getByRole("button", { name: "Yangi suhbat" }).click();
await send("xato500 birinchi");
await sleep(2500);
const after = (await (await ctx.request.get(`${API}/conversations`)).json()).length;
check("birinchi xato: bo'sh suhbat yaratilib qolmadi", after === before, `${before} -> ${after}`);
check("birinchi xato: URL da ?c= yo'q", !new URL(page.url()).searchParams.get("c"));
check("birinchi xato: matn qaytdi", (await ta.inputValue()) === "xato500 birinchi");

// 6) Oflayn: tarjima qilingan xabar, matn qaytadi
await ctx.setOffline(true);
await send("oflayn xabar");
await sleep(1500);
const offText = await errBox.innerText().catch(() => "");
check("oflayn: do'stona xabar", offText.includes("Internet aloqasi yo‘q"), offText.slice(0, 100));
check("oflayn: matn qaytdi va pufakcha yo'q", (await ta.inputValue()) === "oflayn xabar" && (await userBubbles("oflayn xabar").count()) === 0);
await ctx.setOffline(false);

// 7) Boshqa joyda o'chirilgan suhbat: yangi suhbatga o'tadi va ogohlantiradi
await ta.fill("");
await send("o'chiriladigan suhbat");
await page.getByText("Javob: o'chiriladigan suhbat").waitFor({ timeout: 15000 });
await idle();
const gone = new URL(page.url()).searchParams.get("c");
await ctx.request.delete(`${API}/conversations/${gone}`);
await send("bu suhbat yo'q");
await sleep(2500);
const goneText = await errBox.innerText().catch(() => "");
check("o'chirilgan suhbat: ogohlantirish", goneText.includes("o‘chirilgan"), goneText.slice(0, 120));
check("o'chirilgan suhbat: URL tozalandi", !new URL(page.url()).searchParams.get("c"));
check("o'chirilgan suhbat: matn qaytdi", (await ta.inputValue()) === "bu suhbat yo'q");

// 8) Kod bloki: "Kodni nusxalash", javob "Nusxa olish", Preview iframe
await ta.fill("");
await send("html sahifa yoz");
await page.locator("pre").first().waitFor({ timeout: 15000 });
await idle();
await page.locator("pre").first().hover();
await page.getByRole("button", { name: "Kodni nusxalash" }).first().click();
const clip = await page.evaluate(() => navigator.clipboard.readText());
check("nusxa: kod bloki buferga", clip.includes("<!DOCTYPE html>"), clip.slice(0, 30));
check("nusxa: 'Nusxa olindi' belgisi", await page.getByRole("button", { name: "Nusxa olindi" }).first().isVisible());
await page.getByRole("button", { name: "Nusxa olish" }).last().click();
const clip2 = await page.evaluate(() => navigator.clipboard.readText());
check("nusxa: butun javob buferga", clip2.includes("Mana sahifa") && clip2.includes("Tayyor."));
await page.getByRole("button", { name: "Preview" }).first().click();
const frame = page.frameLocator("iframe");
await frame.locator("#t").waitFor({ timeout: 5000 });
check("preview: iframe ichida sahifa", (await frame.locator("#t").innerText()) === "Salom OmniAI");
check("preview: iframe sarlavhasi tarjima qilingan", !!(await page.locator("iframe").getAttribute("title")));
check("preview: faol tab belgilangan", (await page.getByRole("button", { name: "Preview" }).first().getAttribute("aria-pressed")) === "true");
await page.screenshot({ path: `${SHOTS}chat-html.png` });

check("sahifada JS xatosi yo'q", errors.length === 0, errors.join(" | ").slice(0, 300));
await b.close();
summary();
