// Responsive layout: har bir kenglik va mavzuda sahifalar sig'adimi, asosiy boshqaruvlar ko'rinadimi
import { browser, userCtx, check, summary, hOverflow, inView, SHOTS, WEB, sleep } from "./h.mjs";

const WIDTHS = [375, 768, 1024, 1280];
const b = await browser();
for (const theme of ["light", "dark"]) {
  const { ctx } = await userCtx(b, { tag: `layout-${theme}`, prefs: { theme } });
  const page = await ctx.newPage();
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const path of ["/chat", "/agent", "/media", "/settings"]) {
      await page.goto(WEB + path);
      await page.waitForLoadState("networkidle");
      await sleep(300);
      const ov = await hOverflow(page);
      check(`${theme} ${w}px ${path}: gorizontal aylantirish yo'q`, ov <= 0, `ortiqcha=${ov}px`);
      await page.screenshot({ path: `${SHOTS}layout-${theme}-${w}${path.replace("/", "-")}.png` });
      // md dan tor: chap menyu yashirin, hamburger ko'rinadi
      const burger = page.getByRole("button", { name: "Menyuni ochish" });
      if (w < 768) check(`${theme} ${w}px ${path}: hamburger ko'rinadi`, await burger.isVisible());
      else check(`${theme} ${w}px ${path}: chap panel doimiy`, await page.locator("#app-sidebar").isVisible() && !(await burger.isVisible()));
    }
    // Chat: yozish maydoni, mikrofon, yuborish, model tanlagich ko'rinish oynasida va chat ustuni ishlatsa bo'ladigan kenglikda
    await page.goto(WEB + "/chat");
    await page.waitForLoadState("networkidle");
    const ta = page.locator("textarea");
    const send = page.getByRole("button", { name: "Yuborish" });
    const mic = page.getByRole("button", { name: "Ovozli xabar" });
    const picker = page.locator('button[aria-haspopup="listbox"]');
    check(`${theme} ${w}px chat: textarea ko'rinadi`, await inView(ta));
    check(`${theme} ${w}px chat: yuborish ko'rinadi`, await inView(send));
    check(`${theme} ${w}px chat: mikrofon ko'rinadi`, await inView(mic));
    check(`${theme} ${w}px chat: model tanlagich ko'rinadi`, await inView(picker));
    const taW = (await ta.boundingBox())?.width ?? 0;
    check(`${theme} ${w}px chat: textarea kengligi yetarli`, taW >= Math.min(180, w * 0.4), `${Math.round(taW)}px`);
    // Preview paneli: xl dan kichikda yopiq, kengda ochiq
    const panelOpen = await page.getByRole("button", { name: "Panelni ochish/yopish" }).getAttribute("aria-expanded");
    check(`${theme} ${w}px chat: preview paneli ${w >= 1280 ? "ochiq" : "yopiq"}`, (panelOpen === "true") === w >= 1280);
    if (w >= 1280) {
      // Panel ochiq bo'lsa ham chat ustuni ishlatsa bo'ladi (>= 360px)
      const colW = await page.evaluate(() => document.querySelector("textarea")?.closest(".flex-col")?.getBoundingClientRect().width ?? 0);
      check(`${theme} ${w}px chat: panel ochiq, chat ustuni >= 360px`, colW >= 360, `${Math.round(colW)}px`);
    } else {
      // Panelni ochish: tor ekranda chat ustidan to'liq kenglikda (overlay), yopish tugmasi bilan
      await page.getByRole("button", { name: "Panelni ochish/yopish" }).click();
      await sleep(200);
      await page.screenshot({ path: `${SHOTS}layout-${theme}-${w}-chat-panel.png` });
      check(`${theme} ${w}px chat: panel ochilganda gorizontal aylantirish yo'q`, (await hOverflow(page)) <= 0);
      await page.getByRole("button", { name: "Panelni ochish/yopish" }).click().catch(async () => {
        await page.getByRole("button", { name: "Panelni yopish" }).click();
      });
    }
    if (w < 1024) {
      // Suhbatlar ro'yxati drawer: tugma bilan ochiladi, Esc bilan yopiladi, fokus qaytadi
      const listBtn = page.getByRole("button", { name: "Suhbatlar" });
      check(`${theme} ${w}px chat: suhbatlar tugmasi ko'rinadi`, await listBtn.isVisible());
      await listBtn.click();
      await sleep(300);
      check(`${theme} ${w}px chat: suhbatlar paneli ochildi`, await inView(page.getByRole("button", { name: "Yangi suhbat" })));
      await page.keyboard.press("Escape");
      await sleep(300);
      check(`${theme} ${w}px chat: Esc paneli yopdi`, (await listBtn.getAttribute("aria-expanded")) === "false");
      check(`${theme} ${w}px chat: fokus tugmaga qaytdi`, await listBtn.evaluate((el) => el === document.activeElement));
    }
    if (w < 768) {
      // Chap menyu drawer: hamburger -> ochiladi, havola bosilsa yopiladi
      const burger = page.getByRole("button", { name: "Menyuni ochish" });
      await burger.click();
      await sleep(300);
      check(`${theme} ${w}px: menyu ochildi`, await inView(page.locator("#app-sidebar a[href='/settings']")));
      await page.screenshot({ path: `${SHOTS}layout-${theme}-${w}-drawer.png` });
      await page.locator("#app-sidebar a[href='/settings']").click();
      await page.waitForURL("**/settings");
      await sleep(300);
      check(`${theme} ${w}px: navigatsiyadan keyin menyu yopildi`, (await burger.getAttribute("aria-expanded")) === "false");
    }
  }
  await ctx.close();
}
await b.close();
summary();
