"use client";

import { useCallback, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getDesktop } from "@/lib/desktop";

const MAX_STEPS = 30;

type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; provider: string; raw: unknown }
  | { role: "tool_results"; results: { id: string; name: string; output: string; is_error: boolean }[] };

type StepResponse = {
  assistant: AgentMessage;
  text: string;
  tool_calls: { id: string; name: string; args: Record<string, unknown> }[];
  note: string | null;
};

export type AgentItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "note"; id: string; text: string; tone: "info" | "error" }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      status: "running" | "ok" | "error";
      output?: string;
    };

let seq = 0;
const nid = () => `i${++seq}`;

/** Agent sikli: model -> asbob chaqiruvlari (kompyuterda bajariladi) -> natijalar -> model ... */
export function useAgent(model: string, folder: string | null) {
  const [items, setItems] = useState<AgentItem[]>([]);
  const [running, setRunning] = useState(false);
  const messages = useRef<AgentMessage[]>([]);
  const stopRef = useRef(false);

  const push = (it: AgentItem) => setItems((x) => [...x, it]);
  const patch = (id: string, p: Partial<AgentItem>) =>
    setItems((x) => x.map((it) => (it.id === id ? ({ ...it, ...p } as AgentItem) : it)));

  const reset = useCallback(() => {
    messages.current = [];
    setItems([]);
  }, []);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const run = useCallback(
    async (text: string) => {
      const desktop = getDesktop();
      if (!desktop || !folder || !text.trim() || running) return;
      stopRef.current = false;
      setRunning(true);
      messages.current.push({ role: "user", content: text });
      push({ kind: "user", id: nid(), text });
      try {
        for (let step = 0; ; step++) {
          if (stopRef.current) {
            push({ kind: "note", id: nid(), text: "To‘xtatildi.", tone: "info" });
            break;
          }
          if (step >= MAX_STEPS) {
            push({ kind: "note", id: nid(), text: `${MAX_STEPS} qadam chegarasiga yetildi. "Davom et" deb yozing.`, tone: "info" });
            break;
          }
          const res = await apiFetch<StepResponse>("/agent/step", {
            method: "POST",
            body: JSON.stringify({ model, folder, messages: messages.current }),
          });
          messages.current.push(res.assistant);
          if (res.text.trim()) push({ kind: "text", id: nid(), text: res.text });
          if (res.note) push({ kind: "note", id: nid(), text: res.note, tone: "info" });
          if (!res.tool_calls.length) break;

          // Asboblar ketma-ket bajariladi; to'xtatilsa ham har bir chaqiruvga javob qaytariladi (tarix izchil qolsin)
          const results = [];
          for (const call of res.tool_calls) {
            const id = nid();
            push({ kind: "tool", id, name: call.name, args: call.args, status: "running" });
            const r = stopRef.current
              ? { output: "Foydalanuvchi agentni to‘xtatdi.", isError: true }
              : await desktop.tool(call.name, call.args);
            patch(id, { status: r.isError ? "error" : "ok", output: r.output });
            results.push({ id: call.id, name: call.name, output: r.output, is_error: r.isError });
          }
          messages.current.push({ role: "tool_results", results });
        }
      } catch (e) {
        push({ kind: "note", id: nid(), text: (e as Error).message, tone: "error" });
      } finally {
        setRunning(false);
      }
    },
    [model, folder, running],
  );

  return { items, running, run, stop, reset, started: items.length > 0 };
}
