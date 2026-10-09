"use client";

import { useCallback, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getDesktop } from "@/lib/desktop";
import { useI18n } from "@/lib/i18n";

const MAX_STEPS = 40;

type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; provider: string; raw: unknown }
  | { role: "tool_results"; results: { id: string; name: string; output: string; is_error: boolean }[] };

type StepResponse = {
  assistant: AgentMessage;
  text: string;
  tool_calls: { id: string; name: string; args: Record<string, unknown> }[];
  note: string | null;
  model: { id: string; label: string; provider: string };
};

export type PlanStep = { title: string; status: "pending" | "in_progress" | "done" };

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

/**
 * Agent sikli: model -> asbob chaqiruvlari -> natijalar -> model ...
 * Fayl asboblari desktopda; update_plan (ekranda), generate_image va ask_expert (serverda) shu yerda bajariladi.
 */
export function useAgent(model: string, folder: string | null) {
  const { t } = useI18n();
  const [items, setItems] = useState<AgentItem[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [running, setRunning] = useState(false);
  // Sessiya qaysi modelda ketayotgani (Auto bo'lsa — server tanlagani). Sessiya davomida o'zgarmaydi.
  const [session, setSession] = useState<StepResponse["model"] | null>(null);
  const messages = useRef<AgentMessage[]>([]);
  const sessionRef = useRef<string | null>(null);
  const stopRef = useRef(false);

  const push = (it: AgentItem) => setItems((x) => [...x, it]);
  const patch = (id: string, p: Partial<AgentItem>) =>
    setItems((x) => x.map((it) => (it.id === id ? ({ ...it, ...p } as AgentItem) : it)));

  const reset = useCallback(() => {
    messages.current = [];
    sessionRef.current = null;
    setSession(null);
    setPlan([]);
    setItems([]);
  }, []);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  /** Bitta asbobni bajaradi: ekranda / serverda / desktopda. */
  const execTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<{ output: string; isError: boolean }> => {
      const desktop = getDesktop()!;
      try {
        if (name === "update_plan") {
          const steps = Array.isArray(args.steps) ? (args.steps as PlanStep[]) : [];
          setPlan(steps.filter((s) => s && typeof s.title === "string"));
          return { output: "Plan shown to the user.", isError: false };
        }
        if (name === "generate_image") {
          if (!desktop.saveImage) return { output: "Desktop ilovani yangilang (rasm saqlash yo'q).", isError: true };
          const img = await apiFetch<{ data: string }>("/agent/image", { method: "POST", body: JSON.stringify({ prompt: String(args.prompt ?? "") }) });
          return await desktop.saveImage(String(args.path ?? "assets/image.png"), img.data);
        }
        if (name === "ask_expert") {
          const r = await apiFetch<{ answer: string; model: string }>("/agent/expert", {
            method: "POST",
            body: JSON.stringify({ question: String(args.question ?? ""), expertise: args.expertise ?? "code", exclude: sessionRef.current }),
          });
          return { output: `[${r.model}]\n${r.answer}`, isError: false };
        }
        return await desktop.tool(name, args);
      } catch (e) {
        return { output: (e as Error).message, isError: true };
      }
    },
    [],
  );

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
            push({ kind: "note", id: nid(), text: t("agent.stopped"), tone: "info" });
            break;
          }
          if (step >= MAX_STEPS) {
            push({ kind: "note", id: nid(), text: t("agent.maxSteps", { n: MAX_STEPS }), tone: "info" });
            break;
          }
          const res = await apiFetch<StepResponse>("/agent/step", {
            method: "POST",
            body: JSON.stringify({ model: sessionRef.current ?? model, folder, messages: messages.current }),
          });
          if (!sessionRef.current) {
            sessionRef.current = res.model.id;
            setSession(res.model);
          }
          messages.current.push(res.assistant);
          if (res.text.trim()) push({ kind: "text", id: nid(), text: res.text });
          if (res.note) push({ kind: "note", id: nid(), text: res.note, tone: "info" });
          if (!res.tool_calls.length) break;

          // Har bir chaqiruvga javob qaytariladi (to'xtatilsa ham) — tarix izchil qolsin
          const results = [];
          for (const call of res.tool_calls) {
            const id = nid();
            if (call.name !== "update_plan") push({ kind: "tool", id, name: call.name, args: call.args, status: "running" });
            const r = stopRef.current ? { output: t("agent.stopped"), isError: true } : await execTool(call.name, call.args);
            if (call.name !== "update_plan") patch(id, { status: r.isError ? "error" : "ok", output: r.output });
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
    [model, folder, running, t, execTool],
  );

  return { items, plan, session, running, run, stop, reset, started: items.length > 0 };
}
