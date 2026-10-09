/** Chat API chaqiruvlari va SSE oqimini o'qish. */
import { apiFetch, request } from "@/lib/api";

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
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; model: string | null; has_canvas?: boolean; route?: string };

export const getModels = () => apiFetch<ModelInfo[]>("/models");
export const getConversations = () => apiFetch<Conversation[]>("/conversations");
export const createConversation = () => apiFetch<Conversation>("/conversations", { method: "POST" });
export const getMessages = (id: string) => apiFetch<ChatMessage[]>(`/conversations/${id}/messages`);
export const deleteConversation = (id: string) => apiFetch<void>(`/conversations/${id}`, { method: "DELETE" });

/** Javobni bo'lak-bo'lak o'qiydi. Xato bo'lsa Error tashlaydi. */
export async function streamMessage(
  convId: string,
  content: string,
  model: string,
  image: string | null,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  onRoute?: (model: string, label: string, reason: string) => void,
): Promise<void> {
  // Server xatosi (kalit yo'q va h.k.) bo'lsa RequestError tashlanadi: xabar saqlanmagan bo'ladi
  const res = await request(`/conversations/${convId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, model, image }),
    signal,
  });
  if (!res.body) throw new Error("Bo'sh javob oqimi");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) {
      if (!ev.startsWith("data:")) continue;
      const data = JSON.parse(ev.slice(5));
      if (data.type === "delta") onDelta(data.text);
      else if (data.type === "route") onRoute?.(data.model, data.label, data.reason);
      else if (data.type === "error") throw new Error(data.message);
    }
  }
}
