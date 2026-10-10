export const meta = {
  name: 'omniai-fix-round2',
  description: 'Apply review follow-ups (backend, agent/desktop) and fix frontend chat/layout and settings/models/media bugs in separate worktrees',
  phases: [
    { title: 'Fix', detail: '4 fixers in their own worktrees' },
    { title: 'Review', detail: 'independent review of each branch' },
  ],
}

const FT = '<FT>'
const TRAILER = `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_014JMtxsUziFc9Qt7fuo1Cnn`

const COMMON = `
You are fixing bugs in the OmniAI Workspace repo (read CLAUDE.md: code comments in Uzbek in the existing style, code/commit messages in English, every new UI string must be added to frontend/src/lib/i18n.tsx in uz, en AND ru). Your own git worktree is given below as YOUR WORKTREE (its branch is already checked out). cd into it for EVERY command and edit files only there. NEVER edit, commit or checkout anything in /home/user/UmarIbnHattob (the main checkout) or in another fixer's worktree (/home/user/wt-*). Other fixers work in parallel on other files; stay inside your file ownership list.

Background: an end-to-end test campaign produced findings in ${FT}/all_findings.json ("reports" with steps/evidence/suspected locations; "verdicts" = independent verification for the auth/chat/models/canvas areas; settings/voice/quality/agent findings were not independently verified — confirm before fixing). Evidence scripts are under /tmp/pwrun/ft_<area>/ and can be reused. Backend API changes already made (first fix round): ${FT}/api_changes.md — READ IT if you touch the frontend.

Environment:
- Postgres running (localhost:5432, omniai/omniai; DBs: omniai = shared dev DB used by the shared backend, omniai_test = pytest, omniai_fix = for a backend fixer's own server). NEVER point pytest or drop_all at omniai/omniai_fix.
- Shared fake AI upstream http://127.0.0.1:9100 (${FT}/fake_upstream.py documents its rules; GET /_log?n=50 shows what was sent upstream — filter by your own key strings; never call /_reset). Shared backend http://localhost:8000/api now runs the MERGED first-round code (main branch) with the fake upstream, CORS allows any localhost port. Never stop/restart it. If you pkill your own processes use the bracket trick (pkill -f "[x]yz") and make sure the pattern can't match anything else on your command line.
- Your worktree has git-excluded symlinks backend/.venv, frontend/node_modules, desktop/node_modules (never commit them).
- Frontend dev server from your worktree: cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000/api nohup npx next dev -p <your port> > /tmp/<you>_fe.log 2>&1 & (do NOT run next build in /home/user/UmarIbnHattob/frontend; building inside your own worktree is fine).
- Own backend from your worktree (backend fixer only): (source ${FT}/env.sh; export DATABASE_URL=postgresql+psycopg://omniai:omniai@localhost:5432/omniai_fix BACKEND_DIR=$PWD/backend BACKEND_PORT=<port>; cd backend && .venv/bin/alembic upgrade head && nohup .venv/bin/python ${FT}/run_backend.py > /tmp/<you>_be.log 2>&1 &).
- Playwright: playwright-core at /tmp/pwrun/node_modules; put .mjs scripts in /tmp/pwrun/fix2_<you>/ ; chromium executablePath "/opt/pw-browsers/chromium", args ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]. Electron: /home/user/UmarIbnHattob/desktop/node_modules/electron/dist/electron under xvfb-run -a with --no-sandbox --disable-gpu and a fresh --user-data-dir (see /tmp/pwrun/ft_agent/*.mjs).
- pytest shares the omniai_test DB: before running it check pgrep -f "[p]ytest" and wait if another run is active.

Rules:
- Fix root causes with minimal, idiomatic changes matching the surrounding code; don't refactor unrelated code; don't change CLAUDE.md decisions.
- Tests: backend changes -> pytest (cd backend && .venv/bin/pytest -q) with new tests; desktop -> npm test; frontend -> npx tsc --noEmit --incremental false && npx next lint must pass.
- Verify every fix by exercising it in a real browser/Electron/API script against your servers, in light AND dark theme and at 375px/768px/1280px widths where layout is involved. Look at your screenshots.
- When done: git add -A in your worktree (check git status first), commit on the checked-out branch. Commit message in English, ending with exactly these two trailer lines:
${TRAILER}
  Do NOT push. No model identifiers anywhere else.
- Stop the servers you started before finishing.
`

const GROUPS = [
  {
    key: 'backend2', wt: '/home/user/wt-backend', branch: 'fix/backend', ports: 'own backend 8101 (DB omniai_fix)',
    task: `You own backend/ only. A code review of your branch's first commit found these problems — fix them all (read the code first, the commit is 0b741e9):
1. chat.py: 'finished = True' is set before 'await run_in_threadpool(finish, parts)'; a client disconnect while waiting for a worker slot cancels it, finish() never runs and the reply is lost while the finally skips it. Make finishing robust (set the flag inside the worker, or shield the call with anyio.CancelScope(shield=True)). Add a test.
2. Quota refund policy is exploitable: client cancel (CancelledError/GeneratorExit) or an empty 200 reply must NOT refund the platform quota, because the provider already billed the request. Refund only when the upstream call clearly failed before producing output (ProviderError / HTTP error status / connection error before the first token) or when our own validation rejected it before calling upstream. In refund_on_error catch Exception, not BaseException. Keep deleting the user message on cancel-before-first-token (that's about history, not billing). Update tests.
3. Blocking DNS on the event loop: check_url() (socket.getaddrinfo) now runs inside resolve() on every custom-provider message and in voice._whisper_provider on every transcribe. Move it off the loop (run_in_threadpool or loop.getaddrinfo in an async variant), and in voice only look up/check the Whisper provider when the fallback is actually needed.
4. GET /conversations default limit went from 100 to 50 — restore default 100 (max 200) for compatibility.
5. DNS rebinding: the request-time check is TOCTOU. When ALLOW_LOCAL_PROVIDERS is false, enforce the address check at CONNECT time for custom-provider HTTP calls (stream_chat, step, list_models, transcribe): e.g. a custom httpcore network backend / httpx transport that resolves the host, rejects non-global addresses and connects to the validated IP while TLS SNI/Host stay the original hostname. Keep using the plain client when ALLOW_LOCAL_PROVIDERS is true (the test harness relies on that). Unit-test it with a fake resolver.
6. voice.py: Gemini returns HTTP 400 with reason API_KEY_INVALID ('API key not valid'/'API key expired') for bad keys — also fall back to Whisper in that case; add a test with a realistic 400 payload.
7. router_auto.py: _NOT_IMAGE vetoes any image request that merely mentions table/graph/chart ('draw a cat sitting on a table', 'mushukni stol ustida chizib ber, grafik uslubda' -> general). Only treat it as non-image when the table/chart/graph is the object being drawn. Add those cases to test_router_auto.py.
8. Keyset pagination skips rows sharing the boundary timestamp: use a composite cursor ?before=<ISO>&before_id=<uuid> with WHERE (updated_at, id) < (:ts, :id) for /conversations and (created_at, id) for /media; 'before' alone must keep working. Update ${FT}/api_changes.md.
9. providers.py: model_count in _out() must count only chat models (is_chat_model) so stale stored lists don't inflate it. The duplicate 409 message may keep pointing to 'edit' (the frontend fixer is adding an edit UI for PATCH /providers/{pid}) — make sure PATCH is documented in api_changes.md.
10. The new migration 6a868a3c4f0f must be safe when the index already exists (some environments created it): use if_not_exists=True for create_index (and if_exists for drop in downgrade). Also add a hard safety guard to tests/conftest.py: abort the whole test session (pytest.exit) unless the database name in DATABASE_URL ends with '_test', because the schema fixture runs drop_all — it must never be able to wipe a real database.
Re-run the full pytest suite and re-check the reviewer scenarios live on your own backend. Commit on fix/backend.`,
  },
  {
    key: 'agent2', wt: '/home/user/wt-agent-desktop', branch: 'fix/agent-desktop', ports: 'frontend dev 3104 against shared backend 8000; Electron OMNIAI_URL=http://localhost:3104',
    task: `You own frontend/src/app/agent/page.tsx, frontend/src/hooks/useAgent.ts, frontend/src/lib/desktop.ts, desktop/**, and agent.*/desktop.* keys in i18n.tsx. A code review of your branch's first commit (bc3bcf9) found these problems — fix them all:
1. useAgent.ts: Stop can abort the first /agent/step in flight but the pushed user message stays in history, so the next run merges/sends the cancelled instruction. Remember the history length before pushing; on abort with no assistant reply yet, remove that user message (or replace it with an explicit '[stopped by the user]' marker) so the model does not act on it.
2. agent/page.tsx: the model selector is enabled while the first step is in flight; use disabled={agent.running || !!agent.session} and the locked tooltip only when session is set.
3. desktop/src/main.js: run_command children are spawned detached; closing the window or quitting never kills them. Call cancelJobs(state) on window 'closed' before deleting state, and on app 'will-quit' for every state.
4. Mime-based rename in generate_image can overwrite an existing file (e.g. logo.webp -> logo.png over the user's own assets/logo.png) without warning: in saveImage, if the target exists show an overwrite approval even when save_image is auto-approved; and when the frontend renamed the path, pick a non-colliding name (logo-1.png) instead.
5. fsTools.js checkArgs: 'if (!TOOLS[name])' accepts Object.prototype names (constructor, toString, hasOwnProperty) — use Object.hasOwn and add those to the unknown-tool tests.
6. main.js menus: keep role 'editMenu'/'windowMenu' on the top-level items (macOS needs them) while providing the localized label and explicit submenu.
Run desktop npm test (extend tests), tsc + lint, and re-verify in Electron. Commit on fix/agent-desktop.`,
  },
  {
    key: 'chatui', wt: '/home/user/wt-chat-ui', branch: 'fix/chat-ui', ports: 'frontend dev 3102 against shared backend 8000',
    task: `You own: frontend/src/components/Sidebar.tsx, AuthGate.tsx, ChatView.tsx, Markdown.tsx, CodePreview.tsx, CanvasPanel.tsx, VoiceButton.tsx, frontend/src/hooks/useChat.ts, useResizable.ts, frontend/src/lib/chatApi.ts, frontend/src/lib/codeBlocks.ts, frontend/src/app/chat/**, frontend/src/app/layout.tsx, plus new files you create, plus ADDING keys to i18n.tsx (put all your new keys in ONE contiguous block per language, starting with a comment line '// chat-ui'). Do NOT edit globals.css (another fixer owns it — use Tailwind classes; if you truly need global CSS, list it in your report notes), settings/*, ModelSelector.tsx, AccountMenu.tsx, Modals.tsx, media/*, api.ts, me.ts, login page, agent page.
Fix (see all_findings.json for details/evidence):
1. RESPONSIVE LAYOUT (high): the app sidebar (w-56) never collapses; at 375/390px every page has ~150px of content; at 768px the chat column collapses to 0 (conversation list w-56 + preview panel min 320px). Implement: below md the app sidebar becomes an off-canvas drawer opened by a hamburger button in a slim top bar (closes on navigation/backdrop/Esc, focus managed); the chat conversation list becomes a drawer/toggle below lg; the preview/canvas panel is closed by default below xl and opens as a full-width overlay on small screens; useResizable must clamp to the available width and react to window resizes so the chat column always keeps a usable minimum (~360px or full width on phones). The model picker, textarea, mic and send must be reachable at 375px. Check /chat, /agent, /media, /settings at 375, 768, 1024, 1280 in light and dark.
2. Double-click Send in an existing conversation hits the Stop button that appears under the cursor and cancels the reply: guard Stop for ~500ms after sending (and/or render Stop elsewhere), keep the fly animation on send not on finish. Canvas-attached send: add an in-flight guard so a double click/Enter cannot send twice while the PNG export is awaited.
3. Failed/cancelled turns: the backend now deletes the user message when no text was produced and sends {type:'error', user_message_removed:true} (see api_changes.md). chatApi.streamMessage must surface that flag (typed error); useChat must then remove the user+assistant bubbles and restore the typed text into the input. Also for network errors before anything was sent (offline): remove the bubble, restore text, friendly translated message. If the FIRST send of a new conversation fails, delete the just-created empty conversation (or don't show it) — no stray 'New chat' rows; display the default title 'New chat' via i18n.
4. Stream errors: map raw 'network error'/ERR_INCOMPLETE_CHUNKED_ENCODING to a translated friendly message; when the active conversation returns 404 (deleted elsewhere) reset to a new chat with a notice.
5. Conversation sidebar: search box (uses ?q=), 'load more' pagination (cursor ?before=<updated_at>&before_id=<id>; older backends ignore before_id), inline rename (PATCH /conversations/{id} {title}), delete with confirmation; the trash/rename actions must be keyboard- and touch-accessible (visible on focus, always visible on touch / small screens).
6. Reload must reopen the active conversation: keep it in the URL (/chat?c=<id>) and restore on load (ignore unknown ids).
7. Copy buttons: a copy button on every code block (Markdown pre/code) and a copy action on each assistant message; show 'Copied' feedback; translated labels.
8. Long unbroken strings overflow bubbles: add break-words / [overflow-wrap:anywhere] and min-w-0 to bubbles and the Markdown root; code blocks keep their own horizontal scroll.
9. Markdown security: do not auto-load remote http(s) images from model output (render them as a link or a click-to-load placeholder); only allow omni-media://<uuid> (validate UUID with a regex) and data:image/* (bounded size). Links already sanitized — keep that.
10. Markdown links in the light theme: readable color (e.g. violet-700 in light, sky/violet-300 in dark) — use Tailwind classes in the Markdown 'a' renderer.
11. Live preview: escape '</script' inside injected JS (and '</style' in CSS) in codeBlocks.ts; translate the iframe title.
12. Preview/Canvas header tabs: show which one is active; add chat.preview/chat.canvas translations for en and ru (missing).
13. Canvas: localStorage key per user (omniai-canvas-v1:<userId>) and remove canvas data on logout/account delete (AuthGate logout); persist Excalidraw binary files (api.getFiles()) with the elements and restore them; pass langCode matching the UI language; when 'attach canvas' is checked but the panel is closed, export from the saved scene (keep the canvas mounted but hidden, or export with exportToBlob from stored data) instead of silently sending without the image; show the vision warning only once.
14. Voice (VoiceButton + ChatView): stale closures — onText must use the latest conversation/model/input (keep the callback in a ref); cancel transcription and don't send when the component unmounts or the user navigates away; double-click mic must not open two streams (guard while getUserMedia is pending; stop all tracks); clear the old 'denied' notice after a successful voice message; show 'no microphone found' for NotFoundError vs 'permission denied' for NotAllowedError; Esc should only cancel recording if no other layer (model picker) handled it; waveform must start drawing even if the canvas mounts after the rAF starts; cap the recording widget width so the textarea keeps space.
15. Auto route label: the SSE route event now carries 'kind' (image|vision|code|reasoning|general) — show a translated reason; image route label must show a proper name/colour for gemini-2.5-flash-image (add a fallback map for known image model ids) also after reload.
16. AuthGate: when redirecting a logged-out user to /login, pass ?next=<current path+query> (only same-origin relative paths starting with '/' and not '//'); the login page owner will read it.
Verify everything in the browser at 375/768/1280, light+dark, uz/en/ru. Commit on fix/chat-ui.`,
  },
  {
    key: 'settingsui', wt: '/home/user/wt-settings-ui', branch: 'fix/settings-ui', ports: 'frontend dev 3103 against shared backend 8000',
    task: `You own: frontend/src/app/settings/**, frontend/src/components/settings/**, ModelSelector.tsx, AccountMenu.tsx, Modals.tsx, frontend/src/app/media/**, frontend/src/app/login/**, frontend/src/app/not-found.tsx (new), frontend/src/lib/api.ts, me.ts, providers.ts, any new lib file (e.g. lib/date.ts), frontend/src/app/globals.css, plus ADDING keys to i18n.tsx (put all your new keys in ONE contiguous block per language, starting with a comment line '// settings-ui'). Do NOT edit Sidebar.tsx, AuthGate.tsx, ChatView.tsx, Markdown.tsx, CanvasPanel.tsx, VoiceButton.tsx, useChat.ts, chatApi.ts, agent page, backend or desktop.
Fix (see all_findings.json for details/evidence):
1. lib/api.ts: 422 responses with a pydantic 'detail' array must become a readable, translated message (e.g. field + msg, or a mapped message for common cases like too long / too short); the generic 'Server xatosi (N)' and the network error text must be translated (api.ts is not a React component — read the current language the same way i18n does, e.g. from localStorage 'omniai-lang' / document.documentElement.lang) and the network error must be user-oriented (no 'uvicorn'); requests use cache: 'no-store'.
2. me.ts initials: use Array.from(word)[0] (emoji-safe).
3. Uzbek dates: Chromium has no uz-Latn month names ('2026 M10 10'); add a small lib/date.ts helper with Uzbek month names and use it in AccountTab, UsageTab (tooltips/axis) and anywhere else dates are formatted for uz.
4. not-found.tsx: translated 404 page inside the app style with a link back to chat.
5. PrivacyTab export: download via fetch + Blob (with session check and a toast on 401) instead of a plain <a href> that navigates to raw JSON.
6. Login page: after login redirect to ?next= if it is a safe same-origin relative path (starts with '/' but not '//'), else /chat.
7. Segmented control (ui.tsx): the highlight pill must measure the active button (like the settings nav indicator) — no offsets in any language/font size.
8. Settings layout: at 768px the content column is ~250px and controls overlap labels — switch the two-column layout to lg, let Row wrap (label above control when narrow); on small screens the horizontal tab strip must scrollIntoView the active tab; '?tab=providers' scroll must wait until the providers section and the data above it have loaded (retry/observe up to ~3s, clear timers on unmount).
9. AiTab default model: replace the giant grid with the existing ModelSelector (or a searchable grouped list) that includes an 'Auto' option, shows availability ('kalit yo‘q' / quota exhausted from /api/models available+unavailable_reason), highlights Auto when default_model is null; warn before losing unsaved custom instructions (beforeunload + tab switch) or autosave on blur.
10. ModelSelector: arrow-key navigation + Enter to choose, roles listbox/option + aria-expanded/aria-activedescendant, translated 'no results' state, the count reflects matches, tell the user when results are capped (e.g. '200 of N shown — refine the search'), don't cut the Auto hint; free badge and 'kalit yo‘q' must have readable contrast in light and dark; mark unavailable models clearly using unavailable_reason.
11. ProvidersTab: translate preset names/notes on the frontend by kind (uz/en/ru) instead of showing backend Uzbek text; correct plurals in ru/en (1 model / 2 модели / 5 моделей); translate '(ixtiyoriy)'; wrap the add form in a <form> so Enter submits; maxLength=60 on name; disable delete while busy + confirmation dialog + toast; an 'edit' action using PATCH /providers/{pid} {api_key?, name?} (see api_changes.md); show the 409 duplicate message; local cards: replace the bare '↗' with a translated label ('Yuklab olish'/'Download'/'Скачать'); model_count/free badges readable in light theme.
12. KeysTab: disable Save while a request is in flight (double click); client-side min/max length check with a translated message; delete confirmation + toast; readable '•••• last4' in light theme; reflect platform_exhausted (show 'limit tugadi' instead of 'Platforma kaliti ishlatiladi').
13. UsageTab: use the new /usage/stats fields (providers, labels, total) so custom providers and Whisper are included in totals, chart series and legend (colors for unknown series from a neutral palette that passes contrast).
14. Shortcuts list (Modals + settings tab): reflect send_with_enter (Enter vs Ctrl+Enter); give the Shortcuts settings tab a section heading.
15. AccountMenu: move the inner Item component out of render (no remount/flash on hover); submenus must open on click/Enter/Space/ArrowRight and on tap, with aria-haspopup/aria-expanded; on narrow screens position submenus inside the viewport (below instead of left-full).
16. Modals: focus the dialog on open, trap Tab, restore focus on close, role=dialog + aria-modal, translated close label; Help opens with the first question expanded; Ctrl+, should close an open modal.
17. Media page: 'load more' pagination (GET /media?limit=&before=<created_at>&before_id=<id>); prompt maxLength 4000 with a counter; delete confirmation; click an image to view it full-size (lightbox with Esc/close); Ctrl+Enter generates; translate the 'Media Studio' heading; the developing (Polaroid) card must look right in the light theme (currently black frame / unreadable timer).
18. globals.css light-theme contrast: remap text-emerald-400/text-red-400/text-amber-400 (and their hover/400-level variants used on text) to darker shades in light theme; dark theme secondary hints that use neutral-500 on small text should be readable (n-400); placeholders readable in light theme. Also add the global CSS the chat fixer may need: '.markdown' overflow-wrap:anywhere and min-width:0, and '.markdown pre' keeps overflow-x:auto.
Verify everything in the browser at 375/768/1280, light+dark, uz/en/ru. Commit on fix/settings-ui.`,
  },
]

const REPORT = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, commit: { type: 'string' },
    fixed: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, how: { type: 'string' }, verified_by: { type: 'string' } }, required: ['item', 'how'] } },
    skipped: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, why: { type: 'string' } }, required: ['item', 'why'] } },
    tests: { type: 'string' }, notes: { type: 'string' },
  },
  required: ['branch', 'commit', 'fixed', 'skipped', 'tests'],
}
const REVIEW = {
  type: 'object',
  properties: {
    problems: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'number' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, description: { type: 'string' }, suggested_fix: { type: 'string' } }, required: ['file', 'severity', 'description'] } },
    verdict: { type: 'string', enum: ['merge', 'merge_after_fixes'] },
  },
  required: ['problems', 'verdict'],
}

const BASE = { backend2: '0b741e9', agent2: 'bc3bcf9', chatui: '189e560', settingsui: '189e560' }

const results = await pipeline(
  GROUPS,
  g => agent(COMMON + `\n\nYOUR GROUP: ${g.key}. YOUR WORKTREE: ${g.wt} (branch ${g.branch}). Ports: ${g.ports}.\n\n${g.task}\n\nReturn the structured report with the final commit sha.`,
    { label: `fix:${g.key}`, phase: 'Fix', schema: REPORT }),
  (rep, g) => {
    if (!rep) return { group: g.key, report: null, review: null }
    return agent(`You are a strict code reviewer for the OmniAI Workspace repo (read CLAUDE.md). Review the new commit(s) on branch ${g.branch} in worktree ${g.wt}: git -C ${g.wt} diff ${BASE[g.key]}..${g.branch} (and git log ${BASE[g.key]}..${g.branch}). The fixer's report: ${JSON.stringify(rep).slice(0, 7000)}\n\nFind REAL problems only: bugs/regressions introduced, races, security holes, broken API compatibility (check callers on both sides: frontend/src and backend/app), accessibility regressions, missing translations in en/ru (compare the i18n key sets), layout breakage. Run the checks in the worktree without modifying files: backend: cd ${g.wt}/backend && .venv/bin/pytest -q (only if backend changed; first check pgrep -f "[p]ytest" and wait while another run is active); desktop: cd ${g.wt}/desktop && npm test; frontend: cd ${g.wt}/frontend && npx tsc --noEmit --incremental false && npx next lint. For frontend groups also run a dev server from the worktree on port ${g.key === 'chatui' ? 3112 : g.key === 'settingsui' ? 3113 : 3114} (NEXT_PUBLIC_API_URL=http://localhost:8000/api) and spot-check the main changed screens with Playwright (playwright-core at /tmp/pwrun/node_modules, scripts in /tmp/pwrun/rev2_${g.key}/, chromium /opt/pw-browsers/chromium --no-sandbox) at 375px and 1280px in light and dark; stop it afterwards. Report each problem with file:line and a concrete fix.`,
      { label: `review:${g.key}`, phase: 'Review', schema: REVIEW })
      .then(rv => ({ group: g.key, report: rep, review: rv }))
  },
)
return results
