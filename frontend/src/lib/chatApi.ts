/** Chat API chaqiruvlari va SSE oqimini o'qish. */
import { API_URL, apiFetch } from "@/lib/api";

export type ModelInfo = { id: string; label: string; provider: string; vision: boolean };
export type Conversation = { id: string; title: string; updated_at: string };
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; model: string | null; has_canvas?: boolean };

export const getModels = () => apiFetch<ModelInfo[]>("/models");
export const getConversations = () => apiFetch<Conversation[]>("/conversations");
export const createConversation = () => apiFetch<Conversation>("/conversations", { method: "POST" });
export const getMessages = (id: string) => apiFetch<ChatMessage[]>(`/conversations/${id}/messages`);
export const deleteConversation = (id: string) =>
  fetch(`${API_URL}/conversations/${id}`, { method: "DELETE" });

/** Javobni bo'lak-bo'lak o'qiydi. Xato bo'lsa Error tashlaydi. */
export async function streamMessage(
  convId: string,
  content: string,
  model: string,
  image: string | null,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/conversations/${convId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, model, image }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Server xatosi (${res.status})`);
  }
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
      else if (data.type === "error") throw new Error(data.message);
    }
  }
}
