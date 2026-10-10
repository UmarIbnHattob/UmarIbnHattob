/** Chat API chaqiruvlari va SSE oqimini o'qish. */
import { apiFetch, request, RequestError } from "@/lib/api";

export type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  vision: boolean;
  tools?: boolean;
  group?: string;
  source?: "builtin" | "custom";
  available?: boolean;
  free?: boolean;
};
export type Conversation = { id: string; title: string; updated_at: string };
/** Auto rejim tanlovi: model nomi va sabab turi (`kind` UI da tarjima qilinadi, `reason` — eski serverlar uchun). */
export type RouteInfo = { label: string; kind?: string; reason?: string };
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  has_canvas?: boolean;
  route?: RouteInfo;
};

/** Suhbatlar ro'yxatining bir sahifasi. */
export const PAGE_SIZE = 50;
/** Server yangi suhbatga beradigan standart sarlavha (UI uni tarjima qilib ko'rsatadi). */
export const DEFAULT_TITLE = "New chat";

/** Ulanish xatosi: so'rov serverga yetmadi (`sent=false`) yoki javob oqimi yarim yo'lda uzildi (`sent=true`). */
export class ConnectionError extends Error {
  constructor(readonly sent: boolean) {
    super(sent ? "connection lost" : "offline");
    this.name = "ConnectionError";
  }
}

/** Server oqim ichida xato yubordi. `userMessageRemoved` — javob matni yo'q edi, server savolni tarixdan o'chirdi. */
export class StreamError extends Error {
  constructor(
    message: string,
    readonly userMessageRemoved = false,
  ) {
    super(message);
    this.name = "StreamError";
  }
}

/** Tarmoq xatosini ConnectionError ga aylantiradi; server javobi (RequestError) va bekor qilish o'zgarishsiz o'tadi. */
function connError(e: unknown, sent: boolean): unknown {
  if (e instanceof RequestError || (e as Error)?.name === "AbortError") return e;
  return new ConnectionError(sent);
}

async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw connError(e, false);
  }
}

export const getModels = () => call(apiFetch<ModelInfo[]>("/models"));

/** Suhbatlar: `q` — sarlavha bo'yicha qidiruv, `after` — shu suhbatdan keyingi (eskiroq) sahifa. */
export function getConversations({ q, after, limit = PAGE_SIZE }: { q?: string; after?: Conversation; limit?: number } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q?.trim()) params.set("q", q.trim());
  if (after) {
    // (vaqt, id) kursori: vaqti bir xil suhbatlar sahifa chegarasida tushib qolmaydi (eski server before_id ni e'tiborsiz qoldiradi)
    params.set("before", after.updated_at);
    params.set("before_id", after.id);
  }
  return call(apiFetch<Conversation[]>(`/conversations?${params}`));
}
export const createConversation = () => call(apiFetch<Conversation>("/conversations", { method: "POST" }));
export const renameConversation = (id: string, title: string) =>
  call(apiFetch<Conversation>(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }));
export const getMessages = (id: string) => call(apiFetch<ChatMessage[]>(`/conversations/${id}/messages`));
export const deleteConversation = (id: string) => call(apiFetch<void>(`/conversations/${id}`, { method: "DELETE" }));

/**
 * Javobni bo'lak-bo'lak o'qiydi.
 * Xatolar: RequestError — server so'rovni boshidanoq rad etdi (xabar saqlanmagan); StreamError — oqim ichidagi xato;
 * ConnectionError — tarmoq uzildi; AbortError — foydalanuvchi to'xtatdi.
 */
export async function streamMessage(
  convId: string,
  content: string,
  model: string,
  image: string | null,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  onRoute?: (model: string, route: RouteInfo) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await request(`/conversations/${convId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, model, image }),
      signal,
    });
  } catch (e) {
    throw connError(e, false);
  }
  if (!res.body) throw new ConnectionError(true);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      // Chromium: "network error" (ERR_INCOMPLETE_CHUNKED_ENCODING) — ulanish yarim yo'lda uzildi
      throw connError(e, true);
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) {
      if (!ev.startsWith("data:")) continue;
      const data = JSON.parse(ev.slice(5));
      if (data.type === "delta") onDelta(data.text);
      else if (data.type === "route") onRoute?.(data.model, { label: data.label, kind: data.kind, reason: data.reason });
      else if (data.type === "error") throw new StreamError(data.message, !!data.user_message_removed);
      else if (data.type === "done") return;
    }
  }
  // Oqim "done" yoki "error" siz tugadi: ulanish yarim yo'lda uzilgan
  throw new ConnectionError(true);
}
