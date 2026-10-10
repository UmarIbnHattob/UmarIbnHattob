"use client";

import { useCallback, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getDesktop, type ToolResult } from "@/lib/desktop";
import { useI18n, type TKey } from "@/lib/i18n";

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

/** Server JSON bo'lmagan asbob argumentlarini shu kalit bilan yuboradi. */
export const INVALID_JSON = "__invalid_json__";

const EXPERTISE = ["design", "code", "reasoning"];
/** ask_expert mavzusi: model bermasa yoki noto'g'ri bersa — "code" (server ham shuni kutadi). */
export const expertiseOf = (args: Record<string, unknown>) =>
  EXPERTISE.includes(String(args.expertise)) ? String(args.expertise) : "code";

/**
 * generate_image yo'lini rasm yaratishdan (va limit sarflashdan) OLDIN tekshiradi:
 * nisbiy, loyiha ichida ("..": yo'q) va rasm kengaytmasi. Desktop symlink'larni o'zi ham tekshiradi.
 */
function imagePathError(p: string): TKey | null {
  if (!p.trim() || p.includes("\0") || /^([a-zA-Z]:|[\\/~])/.test(p)) return "agent.imgPathRelative";
  if (p.split(/[\\/]/).includes("..")) return "agent.imgPathOutside";
  if (!/\.(png|jpe?g|webp)$/i.test(p)) return "agent.imgPathExt";
  return null;
}

const MIME_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

/** Fayl kengaytmasini rasmning haqiqiy turiga moslaydi (masalan PNG keldi, "logo.webp" -> "logo.png"). */
function withMimeExt(p: string, mime: string) {
  const ext = MIME_EXT[mime];
  const dot = p.lastIndexOf(".");
  const cur = p.slice(dot).toLowerCase();
  if (!ext || cur === ext || (ext === ".jpg" && cur === ".jpeg")) return p;
  return p.slice(0, dot) + ext;
}

/** Desktop chaqiruvini (IPC) kutishni To'xtatish bilan uzadi (ishlayotgan buyruqni esa desktop.cancel o'ldiradi). */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Asbob natijasi; `path` — fayl boshqa nom bilan saqlangan bo'lsa (karta tugmalari shu yo'lni ochadi). */
type ToolOutcome = ToolResult & { path?: string };

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
  // Joriy ish: To'xtatish uni bekor qiladi (model so'rovi ham darhol uziladi). Bir vaqtda faqat bitta ish.
  const ctrlRef = useRef<AbortController | null>(null);

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
    if (!ctrlRef.current) return;
    ctrlRef.current.abort();
    // Desktopda ishlayotgan buyruq ham to'xtatiladi (eski desktop versiyalarida yo'q)
    getDesktop()?.cancel?.().catch(() => {});
  }, []);

  /** Bitta asbobni bajaradi: ekranda / serverda / desktopda. */
  const execTool = useCallback(
    async (name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome> => {
      const desktop = getDesktop()!;
      try {
        if (INVALID_JSON in args) return { output: t("agent.badArgs"), isError: true };
        if (name === "update_plan") {
          const steps = Array.isArray(args.steps) ? (args.steps as PlanStep[]) : [];
          setPlan(steps.filter((s) => s && typeof s.title === "string"));
          return { output: "Plan shown to the user.", isError: false };
        }
        if (name === "generate_image") {
          if (!desktop.saveImage) return { output: t("agent.updateDesktop"), isError: true };
          const prompt = String(args.prompt ?? "").trim();
          const path = String(args.path ?? "assets/image.png");
          // Yaroqsiz yo'l uchun rasm yaratilmaydi (pullik so'rov va limit behuda ketmasin)
          const bad = !prompt ? "agent.imgNoPrompt" : imagePathError(path);
          if (bad) return { output: t(bad), isError: true };
          const img = await apiFetch<{ data: string; mime: string }>("/agent/image", { method: "POST", body: JSON.stringify({ prompt }), signal });
          const finalPath = withMimeExt(path, img.mime);
          const r = await abortable(desktop.saveImage(finalPath, img.data), signal);
          if (finalPath === path || r.isError) return r;
          // Model keyingi qadamlarda (masalan HTML da) to'g'ri fayl nomini ishlatsin
          return { ...r, output: `${r.output}\n${t("agent.imgRenamed", { from: path, to: finalPath })}`, path: finalPath };
        }
        if (name === "ask_expert") {
          const r = await apiFetch<{ answer: string; model: string }>("/agent/expert", {
            method: "POST",
            body: JSON.stringify({ question: String(args.question ?? ""), expertise: expertiseOf(args), exclude: sessionRef.current }),
            signal,
          });
          return { output: `[${r.model}]\n${r.answer}`, isError: false };
        }
        return await abortable(desktop.tool(name, args), signal);
      } catch (e) {
        if (signal.aborted) return { output: t("agent.stopped"), isError: true };
        return { output: (e as Error).message, isError: true };
      }
    },
    [t],
  );

  const run = useCallback(
    async (text: string) => {
      const desktop = getDesktop();
      // ctrlRef — sinxron himoya: ikki marta tez yuborilsa ham faqat bitta ish boshlanadi
      if (!desktop || !folder || !text.trim() || running || ctrlRef.current) return;
      const ctrl = new AbortController();
      const { signal } = ctrl;
      ctrlRef.current = ctrl;
      setRunning(true);
      messages.current.push({ role: "user", content: text });
      push({ kind: "user", id: nid(), text });
      const stopped = () => push({ kind: "note", id: nid(), text: t("agent.stopped"), tone: "info" });
      try {
        for (let step = 0; ; step++) {
          if (signal.aborted) {
            stopped();
            break;
          }
          if (step >= MAX_STEPS) {
            push({ kind: "note", id: nid(), text: t("agent.maxSteps", { n: MAX_STEPS }), tone: "info" });
            break;
          }
          const res = await apiFetch<StepResponse>("/agent/step", {
            method: "POST",
            body: JSON.stringify({ model: sessionRef.current ?? model, folder, messages: messages.current }),
            signal,
          });
          if (!sessionRef.current) {
            sessionRef.current = res.model.id;
            setSession(res.model);
          }
          messages.current.push(res.assistant);
          if (res.text.trim()) push({ kind: "text", id: nid(), text: res.text });
          if (res.note) push({ kind: "note", id: nid(), text: res.note, tone: "info" });
          if (!res.tool_calls.length) {
            // Model oxirida hech narsa yozmasa ham ish tugaganini ko'rsatamiz
            if (!res.text.trim() && !res.note) push({ kind: "note", id: nid(), text: t("agent.done"), tone: "info" });
            break;
          }

          // Har bir chaqiruvga javob qaytariladi (to'xtatilsa ham) — tarix izchil qolsin
          const results = [];
          for (const raw of res.tool_calls) {
            const id = nid();
            // Argumentlar obyekt bo'lmasa (masalan JSON massiv yoki null) — yaroqsiz JSON kabi rad etiladi
            const ok = raw.args && typeof raw.args === "object" && !Array.isArray(raw.args);
            const call = ok ? raw : { ...raw, args: { [INVALID_JSON]: JSON.stringify(raw.args) } };
            if (call.name !== "update_plan") push({ kind: "tool", id, name: call.name, args: call.args, status: "running" });
            const r: ToolOutcome = signal.aborted ? { output: t("agent.stopped"), isError: true } : await execTool(call.name, call.args, signal);
            if (call.name !== "update_plan")
              patch(id, { status: r.isError ? "error" : "ok", output: r.output, ...(r.path ? { args: { ...call.args, path: r.path } } : {}) });
            results.push({ id: call.id, name: call.name, output: r.output, is_error: r.isError });
          }
          messages.current.push({ role: "tool_results", results });
        }
      } catch (e) {
        // To'xtatilganda so'rov uziladi (AbortError) — bu xato emas
        if (signal.aborted) stopped();
        else push({ kind: "note", id: nid(), text: (e as Error).message, tone: "error" });
      } finally {
        ctrlRef.current = null;
        setRunning(false);
      }
    },
    [model, folder, running, t, execTool],
  );

  // started — ekranda biror narsa bor (Yangi sessiya tugmasi uchun);
  // model faqat birinchi muvaffaqiyatli qadamdan keyin qulflanadi (session) — xato bilan tugagan urinishdan keyin emas.
  return { items, plan, session, running, run, stop, reset, started: items.length > 0 };
}
