# Backend API changes (branch `fix/backend`)

New Alembic migration `6a868a3c4f0f`. Run `alembic upgrade head`. It widens `messages.model` and `usage_events.model` to 300 characters and adds the index `ix_conversations_user_updated`. The migration also works when that index already exists (`if_not_exists`), and its downgrade works when the index is missing.

Every response shape stays backward compatible: only fields and endpoints are added. String `detail` messages stay in Uzbek, as before.

## Free quota policy (round 2, applies everywhere below)
A reserved platform request is **refunded only when it never ran at the provider**:
- the provider failed before the first token (HTTP error status such as 401/429/5xx, connection error, timeout, upstream `error` event), or
- our own validation rejected the request before calling the provider.

It is **not** refunded when the provider has already billed it:
- the client cancelled (Stop, switching chats, closing the tab), even before the first token;
- the reply was empty (a 200 response with no text), or the image model answered 200 without an image (a refusal or `blockReason`);
- the expert's answer was empty.

These cases still count **nothing in usage stats** (`/api/usage/stats` shows only successful requests). The `used` counter of `/api/usage` does go up, so after an empty reply or a cancel, `used` can be higher than the stats total.

## General
- Every `/api/*` response now sends `Cache-Control: no-store`, unless it sets its own policy (chat SSE: `no-cache`; media file: see Media). Back after logout now gets a 401 for `/api/me`.
- Concurrent registration with the same email now returns `409 "Bu email allaqachon ro'yxatdan o'tgan."` instead of a 500 (which had no CORS headers).
- Concurrent `PUT /api/keys/{provider}` calls are an idempotent upsert, so they always return 200 (no more 500 on a double-click).

## Chat SSE: `POST /api/conversations/{id}/messages`
- **`route` event**: new field `kind`, one of `"image" | "vision" | "code" | "reasoning" | "general"`. Translate `kind` in the UI. `reason` is still sent in Uzbek for old clients.
  Example: `{"type":"route","model":"gemini-2.5-pro","label":"Gemini 2.5 Pro","reason":"kod","kind":"code"}`
- **`error` event**: new optional field `user_message_removed: true`. It is sent when **no assistant text** was produced: provider error, empty reply, or blocked image. In that case the server has already deleted the user message. The free quota is refunded only for a provider error, not for an empty reply or a blocked image (see *Free quota policy*). If the conversation's title had just been set from this message, the title is back to `"New chat"`.
  → The UI should remove the user bubble (and the empty assistant bubble) and **put the typed text back in the input**.
  - Without this flag, the error came after some text was streamed. The partial reply **is saved**, so keep both bubbles.
- **Client cancel (Stop) before the first token**: the server removes the user message. The quota is **not** refunded. After a cancel, reload messages or drop the user bubble locally. A cancel after some text keeps the partial reply saved, as before. This also holds when the client disconnects at the very end, while the reply is being saved: the finished reply is kept, and it is never saved twice.
- The stream now always ends with `done` or `error`. It is no longer cut, so there is no "network error" from the backend. New error texts:
  - `"Suhbat o'chirilgan: javob saqlanmadi."`: the conversation was deleted while streaming. Reset the UI to a new chat.
  - `"Javobni saqlab bo'lmadi."`: the database save failed.
- Content that is only whitespace returns **422** with a string detail: `"Xabar bo'sh bo'lmasligi kerak."`. The old minimum of 1 character still gives pydantic's list detail.
- Auto with an attached canvas and no vision model returns 400 `"Rasmni ko'ra oladigan model topilmadi. ..."`.
- Auto image replies: the markdown alt text is sanitized (no `[ ] \ \` < >` or newlines, at most 80 characters), so `![...](omni-media://<id>)` always renders.
- Auto now prefers the user's **own keys and custom providers** over the platform key. When the platform quota is exhausted, Auto falls back to them. The classifier also handles uz/ru word endings, and "logo"/"planshet" no longer trigger the wrong route.
- Auto image vs. table/chart: a request is answered as text (not as an image) only when the table, chart, graph or diagram is **the thing being drawn**. Examples: "jadval chizib ber", "sotuv grafigini chiz", "draw me a bar chart", "нарисуй таблицу". A request that only mentions such a word is still an image: "draw a cat sitting on a table", "mushukni stol ustida chizib ber, grafik uslubda".
- Custom provider whose host now resolves to an internal address: if the check before the turn sees it, the response is 400 `"<provider name>: Lokal/ichki manzillarga ruxsat yo'q. ..."` and nothing is saved. If DNS changes between that check and the connection (DNS rebinding), the connection is refused. The turn then ends with an `error` event that has the same message and `user_message_removed: true`.

## Conversations
- `GET /api/conversations?limit=100&before=<updated_at>&before_id=<id>&q=<text>`
  - The response is still an array of `{id, title, updated_at}`, sorted by `updated_at` descending, then `id` descending.
  - `limit` defaults to **100**, the same as before. The maximum is 200.
  - Next page: pass the last item's `updated_at` as `before` **and** its `id` as `before_id`. The server then returns the rows where `(updated_at, id) < (before, before_id)`, so conversations that share the boundary timestamp are not skipped. **URL-encode** `before` (`encodeURIComponent`), because the `+00:00` offset contains `+`. Fewer than `limit` items means it was the last page.
  - `before` alone still works (strictly older `updated_at`, the old behaviour), but it can skip rows that share the boundary timestamp. `before_id` without `before` returns 422.
  - `q`: case-insensitive substring search on the title. `%` and `_` are matched as literal characters.
- **New** `PATCH /api/conversations/{id}` with body `{ "title": string }` renames a conversation and returns `ConversationOut`.
  - The title is stripped and must be 1–200 characters. A whitespace-only title gives 422 `"Sarlavha bo'sh bo'lmasligi kerak."`. Over 200 characters gives a pydantic 422 list.
  - Renaming does **not** change `updated_at`, so the list order stays the same.
  - Another user's conversation gives 404.

## Models: `GET /api/models` and `GET /api/agent/models`
- New fields on every item:
  - `platform: bool`: the model works only through the quota-limited platform key (the user has no key of their own for it).
  - `unavailable_reason: null | "no_key" | "quota"`.
- `available` is now `false` for platform models once the monthly free quota is used up (`unavailable_reason: "quota"`).
- Non-chat models (Whisper, TTS, embed, guard, moderation, OCR, rerank, image-only and so on) are filtered out for **every** provider, including lists saved before this change.
- `/api/agent/models` lists custom models only when `tools: true`. Agent steps on a custom model with `tools: false` return 400.

## Keys: `GET /api/keys`
- `platform_available` is now `false` when the free quota is exhausted.
- New `platform_exhausted: bool`: a platform key exists but this month's limit is used up. Show "limit tugadi" instead of "Platforma kaliti ishlatiladi".

## Usage stats: `GET /api/usage/stats`
- Existing fields are unchanged. New fields:
  - `providers: string[]`: series keys sorted by total count, descending. Render the chart and legend from this list, not from a fixed list.
  - `labels: {key: displayName}`: for example `{"gemini":"Gemini","whisper":"Whisper","openrouter":"OpenRouter","groq":"Groq"}`. For custom kinds it is the user's provider name(s), or the preset name.
  - `total: number`: the total over all series, including custom providers and Whisper.
- Series keys can be `anthropic | deepseek | gemini | whisper | openrouter | groq | openai | mistral | xai | together | ollama | lmstudio | custom`. Use a neutral colour for unknown keys.
- `by_model` now has full model ids, for example `meta-llama/llama-3.3-70b-instruct:free` instead of `free`.
- Only successful requests are counted in usage stats (chat, Auto image, Media, voice, agent step/image/expert). Failed, empty, cancelled-before-first-token and validation-rejected requests are not counted. The free quota follows the *Free quota policy* above: empty replies, blocked images and cancels do use it.

## Providers
- `POST /api/providers`:
  - **409** with the string detail `"Bu provayder allaqachon qo'shilgan (<name>). Kalitni almashtirish uchun uni tahrirlang."` when the same kind and base URL already exist. The comparison ignores case and a trailing slash.
  - A name that is only whitespace becomes the preset name.
  - The 20-provider limit is now race-safe (400).
  - The DNS check of the base URL no longer blocks the server (it runs in a worker thread).
  - When `ALLOW_LOCAL_PROVIDERS` is false, every request to a custom provider (chat, agent step, model list, Whisper) checks the address again **at connect time**. It connects to the IP address it checked, while TLS SNI and the `Host` header keep the original hostname. If the hostname resolves to an internal address, the request is refused with `"Lokal/ichki manzillarga ruxsat yo'q. ..."`: a 400 on add, PATCH and refresh, a 502 from the agent, or an `error` event in chat. When `ALLOW_LOCAL_PROVIDERS` is true (local Ollama/LM Studio), the plain HTTP client is used, as before.
- List items (and the add, PATCH and refresh responses): `model_count` and `free_count` count only chat models. Whisper, TTS, embedding and similar models in lists saved before the filter are left out, so the numbers match `/api/models`.
- **New** `PATCH /api/providers/{pid}` with body `{ "api_key"?: string, "name"?: string }`. Use it for the "edit" action that the 409 duplicate message points to:
  - If `api_key` is present, the model list is fetched again with the new key. On failure the response is 400 (for example `"API kalit noto'g'ri ..."`) and the old key is kept.
  - `api_key: ""` removes the key for keyless kinds (ollama, lmstudio, custom). It gives 400 for kinds that need a key.
  - `name`: 1–60 characters. A blank name falls back to the preset name.
  - Returns the same shape as a list item. The **id stays the same**, so saved `cp:<id>:...` model refs keep working. Another user's provider gives 404.
- `DELETE /api/providers/{pid}` also sets `preferences.default_model` to `null` if it pointed at this provider.

## Me
- `PATCH /api/me` with `preferences.default_model`:
  - Maximum 300 characters. The format must be `auto`, a built-in id, or `cp:<uuid>:<model>`; otherwise the response is 422 `"Noto'g'ri sozlama: ..."`.
  - When the value changes, the model must exist in the user's catalog; otherwise the response is 422 `"Noma'lum model: <id>"`.
  - `null` and `"auto"` are allowed.
- `POST /api/me/password`: a new password equal to the current one returns 400 `"Yangi parol joriy paroldan farq qilishi kerak."`.

## Media
- `GET /api/media?limit=60&before=<created_at>&before_id=<id>`: keyset pagination, `limit` maximum 200. The response is still an array. For the next page, pass the last item's `created_at` (URL-encoded) as `before` and its `id` as `before_id`, so images with the same timestamp are not skipped. `before` alone still works. `before_id` without `before` returns 422.
- `GET /api/media/{id}/file` now sends `Cache-Control: private, no-cache` and `ETag: "<id>"`, and answers `If-None-Match` with 304. That check runs after authentication and the ownership check, so after logout the browser gets a 401 instead of a cached image. `<img src>` usage stays the same.
- A failed image generation (502) does not use quota. A refusal (a 200 response without an image, also a 502 with `"Model rasm qaytarmadi (...)"`) does use quota, because the provider has billed it.

## Voice: `POST /api/voice/transcribe`
- The audio bytes must match `mime`: `audio/wav`, `audio/ogg`, `audio/mp3`, `audio/mpeg` or `audio/flac`. A mismatch returns 400 `"Audio <FMT> formatida emas."`. Any other mime returns 400.
- Whisper fallback (a Groq or OpenAI provider) is now used:
  - when the user's own Gemini key fails (401, 403, 429, 5xx or a network error). This also covers Gemini's **400 `API_KEY_INVALID`** ("API key not valid" / "API key expired"). Without a Whisper provider, that case now returns 502 `"API kalit noto'g'ri yoki ruxsat yo'q. Settings sahifasida tekshiring."` instead of the raw JSON;
  - when the platform quota is exhausted.
- The Whisper provider is looked up (and its URL checked) only when the fallback is actually needed.
- Platform quota: refunded when Gemini fails (HTTP error or network error). It is not refunded for an empty transcript or a cancel.
- Platform quota exhausted with no Whisper provider returns **429** with the message `"Bu oy uchun bepul limit (N so'rov) tugadi. Ovoz uchun o'z Gemini kalitingizni ... yoki Groq provayderini qo'shing."` (it used to be a generic 400).

## Agent
- Malformed or old-shaped history now returns **400** `"Agent tarixi noto'g'ri formatda (eski sessiya bo'lishi mumkin). Yangi sessiya boshlang."` instead of 500. Examples: an assistant message without `raw`, tool results without `id`/`output` (or without `name` for Gemini), Responses items without `call_id`.
- Every validation (model family lock, history shape, tools capability) runs before any quota is used.
- `note` can also be `"(Javob kontent filtri tomonidan to'xtatildi.)"`. An OpenAI refusal is returned as text.
- `/api/agent/expert` returns 502 when the expert's answer is empty. That answer was billed, so it is not refunded. A provider error before the first token is refunded.
- `/api/agent/image`: a refusal (no image in a 200 response) returns 502 and uses quota; a provider error returns 502 and does not.

## OpenAI Responses (Codex / -pro) in chat
- Upstream `error` events now show their real message, plus the code in brackets.
- A refusal is shown as an italic note: `_(<Model> bu so'rovga javob bermadi: ...)_`.
- `content_filter` shows `_(Javob kontent filtri tomonidan to'xtatildi.)_`. It is no longer shown as a length truncation.
- A stream cut off without a final event ends with `_(Javob to'liq kelmadi: ulanish uzilib qoldi. ...)_`, or an error if no text arrived at all.
