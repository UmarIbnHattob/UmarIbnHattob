export const meta = {
  name: 'omniai-full-e2e',
  description: 'Test every OmniAI feature end-to-end against fake providers, then adversarially re-verify each finding',
  phases: [
    { title: 'Test', detail: 'one tester per feature area (browser, API, Electron)' },
    { title: 'Verify', detail: 'independent reproduction of every reported problem' },
  ],
}

const FT = '<FT>'

const COMMON = `
You are testing the OmniAI Workspace app (repo /home/user/UmarIbnHattob; read CLAUDE.md there for architecture). Your job is to TEST and REPORT. Do NOT edit any file inside /home/user/UmarIbnHattob (no fixes, no commits). Write your own scripts/screenshots only under /tmp/pwrun/ft_${'${AREA}'}/ (create it).

SHARED RUNNING INFRASTRUCTURE — never stop, restart, or kill these (other testers use them concurrently):
- Postgres (socket /tmp/pgtest, db omniai), backend http://localhost:8000/api (FastAPI; launched by ${FT}/run_backend.py with env ${FT}/env.sh),
- frontend production build http://localhost:3000 (Next.js), fake AI upstream http://127.0.0.1:9100.
- If you ever need pkill, use the bracket trick: pkill -f "[x]yz" (plain pkill -f kills your own shell). Never kill uvicorn/next/postgres.
- Never call POST http://127.0.0.1:9100/_reset.

HOW PROVIDERS ARE FAKED: all outbound AI calls from the backend are transparently redirected to the fake upstream (${FT}/fake_upstream.py — read it, it documents the rules). The backend's real provider code (official Anthropic SDK, httpx Gemini/OpenAI-compatible clients) runs unchanged, so wire-format bugs are real bugs. Key rules: API key containing "bad" -> 401, containing "rate" -> 429. Last user message containing "html" -> reply has an html code block; "uzun" -> truncated (max tokens) reply; "xato500" -> upstream 500; "SYSTEMCHECK" -> reply echoes the system prompt; "refuse" -> Claude refusal. Agent (tool-calling) script: 0 tool results -> list_dir, 1 -> write_file hello.txt, 2 -> final text; message containing "rasm" -> generate_image first, "ekspert" -> ask_expert first, "reja" -> update_plan first. Replies look like "[provider:model] Javob: <your text>".
- Inspect what the backend actually sent upstream: curl -s 'http://127.0.0.1:9100/_log?n=50' (shared by all testers: ALWAYS filter entries by your own unique API key strings).
- Use API keys that contain your area name so you can filter the log, e.g. "sk-good-${'${AREA}'}-anthropic". Platform Gemini key is configured (PLATFORM_GEMINI_KEY=platform-gemini-ok, FREE_MONTHLY_REQUESTS=25), so new users can use Gemini (and Auto) without their own key, limited to 25 requests/month.
- Use unique emails for every account you create: ${'${AREA}'}-<n>@example.com, password "parol12345" (min length rules apply).

BROWSER TESTING: Playwright via playwright-core installed at /tmp/pwrun/node_modules — put your .mjs scripts in /tmp/pwrun/ft_${'${AREA}'}/ so the import resolves. Launch: chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }). Log in either through the UI (login page: link text "Hisobingiz yo‘qmi" then button "Ro‘yxatdan o‘tish"; note the apostrophe is U+2018 ‘) or via ctx.request.post("http://localhost:8000/api/auth/register"|"/login") and then copy cookies to domain "localhost" (await ctx.addCookies((await ctx.cookies("http://localhost:8000")).map(c => ({...c, domain: "localhost"})))). Look at /tmp/pwrun/*.mjs for earlier working examples (auto_e2e.mjs, settings_e2e.mjs, electron_e2e.mjs, site_e2e.mjs). Collect page errors (page.on("pageerror")) and console errors; take screenshots and LOOK at them (Read the png) — visual defects (overlaps, cut-off text, unreadable contrast in light AND dark theme, misaligned elements, untranslated strings) count as findings. Wrap long node runs with \`timeout 300 node script.mjs\`.
Read the relevant source (frontend/src, backend/app, desktop/src) to know what features exist and what each one SHOULD do, then exercise them like a real user would — including edge cases, error paths, double clicks, reload mid-way, empty input, very long input, switching language (uz/en/ru) and theme.

REPORTING: be precise and honest. A finding must be something you actually observed, with exact repro steps, expected vs actual, and evidence (script path, screenshot path, log excerpt). If something only fails because of the fake harness (not the product), do not report it as a product bug — mention it in harness_notes. Also list every feature you tested with pass/fail/blocked so coverage is visible. Severity: critical (data loss/security/feature totally broken), high (core flow broken for common case), medium (feature partly broken / confusing), low (cosmetic / minor). Where you can, point to the suspected source location (file:line) and the likely cause.
`

const AREAS = [
  {
    key: 'auth',
    focus: `AUTH, ACCOUNT, PRIVACY and MULTI-USER ISOLATION.
- Register (validation: bad email, short password, duplicate email), login (wrong password message), logout, session persistence on reload, redirect to /login when logged out for every page (/chat /agent /media /settings).
- Account tab: change display name/nickname/avatar color, change password (old sessions must be invalidated via token_version — verify a second browser context gets logged out), delete account (data really gone, cannot log in).
- Privacy tab: data export (download works, contains conversations, does NOT contain secrets like encrypted keys/password hash), delete all conversations.
- Cookie flags (httpOnly, SameSite), CORS: requests from a foreign Origin must not be allowed with credentials.
- IDOR sweep via API: with user A create conversations, messages, media items, custom providers, API keys; with user B try to read/modify/delete each of A's resources by id on EVERY backend route (read backend/app/routers/*.py and enumerate all routes). Any leak = critical.
- Rate/robustness: very long names, unicode, HTML/JS injection in display name/conversation title (XSS check in the UI).`,
  },
  {
    key: 'chat',
    focus: `CORE CHAT on /chat.
- Chat with each built-in model: Claude Sonnet 5.5, Claude Opus 5.5, Deepseek Chat, Deepseek Reasoner, Gemini 2.5 Pro, Gemini 2.5 Flash (set your own keys for anthropic/deepseek on the API keys settings page; Gemini works via platform key or set your own). Verify streaming renders progressively, final markdown rendering, code highlighting, copy button(s).
- Multi-turn: verify the full history is sent upstream (n_messages in /_log grows), switching model mid-conversation (handoff) works and history is preserved.
- Stop button mid-stream: partial reply is kept after reload; no duplicate messages.
- Conversation sidebar: new chat, list order, rename, delete, search (if present), reload persistence, very long titles.
- Error paths: bad key (e.g. "sk-bad-chat-anthropic") -> friendly Uzbek error shown in UI and the app stays usable; "rate" key -> 429 message; "xato500" message -> error; "uzun" -> truncation note; "refuse" with Claude -> refusal note. No raw stack traces/JSON in UI.
- Input: empty message, whitespace only, very long message (20k chars), Enter vs Shift+Enter with the send_with_enter preference on and off, double-click send (no duplicate sends), paste.
- System prompt personalization: set custom instructions + response language in Settings > AI behavior, then send "SYSTEMCHECK" and verify they appear in the system prompt the fake echoes.`,
  },
  {
    key: 'models',
    focus: `AUTO MODEL ROUTING, MODEL PICKER and CUSTOM PROVIDERS (the "API kalitlar" settings page now contains the provider cards; /settings?tab=providers is an alias that should open the keys tab and scroll to the providers section).
- Auto: in /chat with model "Auto" send a coding request, a general question, an image request ("kofe uchun logo chizib ber") and attach/vision if possible; verify the route label "Auto → …" and which upstream model was actually called (/_log).
- Model picker: search, grouping, keyboard navigation, the "add more models" link, selection persists after reload, default model preference.
- Add EVERY preset through the UI on Settings > API kalitlar: OpenAI (key "sk-good-models-openai"), OpenRouter, Groq, Mistral, xAI, Together, Ollama (local), LM Studio (local), Custom (base url https://custom.example.com/v1). Check model counts, free badges, refresh, delete, the 20-provider limit, bad-key error on add ("sk-bad-..."), empty key, duplicate add.
- Model list quality: OpenAI list must only contain chat models (no embeddings/whisper/tts/dall-e); check Groq list (does whisper-large-v3-turbo wrongly appear as a chat model?), OpenRouter image-only models excluded.
- Chat with custom models: gpt-5 (verify upstream got max_completion_tokens not max_tokens), gpt-5-codex (must go to /responses endpoint and stream correctly), o3, OpenRouter free model, Groq, Ollama, custom. Verify errors are friendly.
- Light theme and dark theme screenshots of the API keys page and the picker; check readability.`,
  },
  {
    key: 'canvas',
    focus: `CANVAS, LIVE HTML PREVIEW and MEDIA STUDIO.
- In chat, ask for html ("oddiy html sahifa yoz") -> open the code block in canvas/preview; verify the preview iframe renders and its button works (sandboxing: preview must not access parent cookies / window.parent), edit code in canvas, copy/download.
- Drawing canvas (Excalidraw) if present: draw something and send to a vision model; verify upstream received an image (has_image in /_log) for Claude/Gemini, and what happens for a non-vision model (Deepseek) — should be a clear message, not a silent drop.
- Media Studio (/media): generate image with Gemini image model (platform key), wait, verify gallery shows it, open, download, delete; prompt containing "rad" -> model returns no image -> friendly error; very long prompt; rapid double submit.
- Images in chat via Auto ("logo chizib ber") -> image rendered inline (omni-media:// URL), persists after reload, accessible only to the owner (try fetching the media URL as another user / logged out).
- Light/dark screenshots of /media and canvas.`,
  },
  {
    key: 'settings',
    focus: `SETTINGS PAGE, I18N, THEMES, LAYOUT.
- Every settings tab: Umumiy (theme light/dark/system, language uz/en/ru, font size sm/md/lg, avatar color, send_with_enter, voice_auto_send), AI xatti-harakati (default model, response language, custom instructions — persist after reload), API kalitlar (save/replace/delete key, last4 display, platform key label, quota meter), Foydalanish (usage stats/charts after a few requests — numbers correct?), Hisob, Maxfiylik, Tezkor tugmalar (do the listed keyboard shortcuts actually work anywhere in the app? test each one), Desktop ilova.
- The left tab indicator must sit exactly behind the active tab for every tab, in every font size and language, after clicking and after direct URL load; check focus rings with keyboard Tab navigation.
- Switch language to en and ru and walk through EVERY page (/chat /agent /media /settings all tabs, login page, account menu, modals): list any untranslated / mixed-language strings, overflowing text, truncated buttons. Also programmatically compare the key sets of the uz/en/ru dictionaries in frontend/src/lib/i18n.tsx and report missing keys.
- Theme: screenshot every page in light and dark; report low-contrast text, invisible borders, wrong colors.
- Responsive: viewport 375x740 and 768x1024 for every page — horizontal scroll, overlapping, unusable controls, sidebar behavior.
- Account menu (bottom-left), help/shortcut modals, upgrade modal if any.`,
  },
  {
    key: 'voice',
    focus: `VOICE INPUT and PLATFORM QUOTA.
- Chat page voice button (fake microphone is enabled via chromium flags): record, stop, verify transcription appears (fake Gemini returns "Salom bu ovozli xabar"), and with voice_auto_send on it is sent automatically; with it off it stays in the input. Cancel recording. Microphone permission denied path (launch a context without the fake-ui flag / deny permission) -> friendly message.
- Agent page voice input in the browser too (if present).
- Whisper fallback: a user who has a Groq or OpenAI custom provider but whose Gemini route is unavailable (read backend/app/routers/voice.py to understand when Whisper is used; e.g. the platform quota exhausted or a bad own Gemini key) -> transcription via /audio/transcriptions. Verify via /_log.
- Platform quota: a fresh user with no own keys has 25 free requests/month. Exhaust it (API calls are fine to speed up), verify the friendly limit message in the chat UI, the QuotaMeter numbers on Settings > API kalitlar, and that adding the user's own Gemini key bypasses the limit. Check concurrency (fire 10 requests in parallel at the boundary — must not exceed 25).
- Usage tab numbers reflect these requests.`,
  },
  {
    key: 'agent',
    focus: `AGENT MODE: browser and the Electron DESKTOP app.
- In the plain browser, /agent should explain that the desktop app is needed (check text, buttons, no errors).
- Run the desktop test suite: cd /home/user/UmarIbnHattob/desktop && npm test.
- Electron app via Playwright _electron: executablePath /home/user/UmarIbnHattob/desktop/node_modules/electron/dist/electron, args [desktopDir, "--no-sandbox", "--disable-gpu", fake media flags], env OMNIAI_URL=http://localhost:3000 with proxy env vars removed; run under \`xvfb-run -a\`. Stub native dialogs in the main process (see /tmp/pwrun/electron_e2e.mjs: dialog.showOpenDialog returns your temp project folder under /tmp/pwrun/ft_agent/proj, dialog.showMessageBox auto-approves or denies). Use a fresh temp project folder per run.
- Run the scripted agent (list_dir -> write_file hello.txt -> done) with EACH model family: Claude (own anthropic key), Gemini (platform key), Deepseek, OpenAI gpt-5 (chat completions tools) and gpt-5-codex (Responses API: verify via /_log that the 2nd and 3rd calls go to /responses and that has_reasoning_input is true, i.e. the reasoning item round-trips), Auto. Verify hello.txt really exists with the right content and the approval dialog was shown for the write.
- Deny the write approval -> agent receives an error result and continues gracefully.
- "reja" -> plan panel updates; "rasm" -> generate_image saves an image file into the project; "ekspert" -> ask_expert answered by another model.
- Stop button mid-run, new session, switching model family mid-session (should be blocked or handled), path traversal attempts are blocked by fsTools (covered by npm test; just confirm).
- Desktop menus (Uzbek native menu), "Terminalda ochish" button behavior (don't actually need a terminal emulator; just make sure no crash), window reload.`,
  },
  {
    key: 'quality',
    focus: `AUTOMATED SUITES, STATIC CHECKS and CODE REVIEW of the newest changes.
- Run: backend pytest (cd backend && .venv/bin/pytest -q — it uses the separate omniai_test database at the default localhost socket; Postgres is already running; if it can't connect, try TEST_DATABASE_URL=postgresql+psycopg://omniai:omniai@localhost:5432/omniai_test or the /tmp/pgtest socket), desktop npm test, frontend: npx tsc --noEmit --incremental false and npx next lint. Do NOT run "npm run build" or "next dev" in /home/user/UmarIbnHattob/frontend — that would overwrite the .next build the shared frontend server is serving. Report any failure.
- Careful code review for real bugs (not style) of: backend/app/providers/openai_compat.py (new Responses API code paths, model filtering, max_completion_tokens logic — e.g. does max_completion_tokens break any non-OpenAI provider? does Responses streaming handle error events / response.failed / incomplete correctly? is the reasoning item round-trip valid per the OpenAI Responses API? what if raw from an older session lacks fields?), frontend/src/app/settings/page.tsx (indicator measuring, ResizeObserver, scroll on ?tab=providers), frontend/src/components/settings/KeysTab.tsx + ProvidersTab.tsx (embedded, duplicate ids?), backend/app/routers/agent.py + chat.py + catalog.py interplay with custom providers.
- Run every claim you make: write a small script against the running backend (http://localhost:8000) or a unit-level python snippet (backend/.venv/bin/python) to demonstrate the bug. Unproven suspicions go in harness_notes, not findings.
- Check backend logs for exceptions produced while other testers work: ${FT}/backend.log (read-only).`,
  },
]

const FINDINGS = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    tested: {
      type: 'array',
      items: {
        type: 'object',
        properties: { feature: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'blocked'] }, note: { type: 'string' } },
        required: ['feature', 'result'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string', enum: ['bug', 'ux', 'i18n', 'visual', 'security', 'performance'] },
          steps: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          evidence: { type: 'string' },
          suspected_location: { type: 'string' },
        },
        required: ['title', 'severity', 'category', 'steps', 'expected', 'actual'],
      },
    },
    harness_notes: { type: 'string' },
  },
  required: ['area', 'tested', 'findings'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'not_reproduced', 'harness_artifact', 'by_design'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          root_cause: { type: 'string', description: 'file:line and explanation' },
          proposed_fix: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['title', 'verdict', 'root_cause'],
      },
    },
  },
  required: ['verdicts'],
}

const results = await pipeline(
  AREAS,
  a => agent(COMMON.split('${AREA}').join(a.key) + `\n\nYOUR AREA (AREA=${a.key}):\n${a.focus}\n\nBe thorough: aim to exercise every listed item. Return the structured report.`,
    { label: `test:${a.key}`, phase: 'Test', schema: FINDINGS }),
  (rep, a) => {
    if (!rep || !rep.findings || rep.findings.length === 0) return { area: a.key, report: rep, verdicts: [] }
    return agent(COMMON.split('${AREA}').join(a.key + '_verify') + `\n\nYou are an independent, skeptical VERIFIER. Another tester reported the problems below for area "${a.key}". For EACH one, try hard to reproduce it yourself from scratch (new accounts, your own scripts) and read the source to find the real root cause. Default to not_reproduced if you cannot observe it. Mark harness_artifact if it only happens because of the fake upstream/test setup, by_design if the behavior is intentional per CLAUDE.md decisions or code comments. For confirmed ones give the exact root cause (file:line) and a concrete minimal fix. Re-assess severity honestly.\n\nREPORTED FINDINGS:\n${JSON.stringify(rep.findings, null, 1)}`,
      { label: `verify:${a.key}`, phase: 'Verify', schema: VERDICTS })
      .then(v => ({ area: a.key, report: rep, verdicts: v ? v.verdicts : null }))
  },
)

return results
