"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  FilePen,
  FileText,
  FolderOpen,
  FolderSearch,
  FolderTree,
  ImagePlus,
  ListChecks,
  MessagesSquare,
  SquareTerminal,
  CircleDashed,
  CheckCircle,
  Laptop,
  Loader2,
  Plus,
  Search,
  Send,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { getDesktop } from "@/lib/desktop";
import { colorOf } from "@/lib/providers";
import { INVALID_JSON, expertiseOf, useAgent, type AgentItem, type PlanStep } from "@/hooks/useAgent";
import { useAuth } from "@/components/AuthGate";
import type { ModelInfo } from "@/lib/chatApi";
import ModelSelector from "@/components/ModelSelector";
import { useI18n, type TKey } from "@/lib/i18n";
import Markdown from "@/components/Markdown";
import OrbitLogo from "@/components/OrbitLogo";
import VoiceButton from "@/components/VoiceButton";

type AgentModel = ModelInfo;
const MODEL_KEY = "omniai-agent-model";
// Desktop ilovani olish sahifasi (README dagi o'rnatish bo'limi; tayyor relizlar bo'lsa env orqali almashtiriladi)
const DESKTOP_URL =
  process.env.NEXT_PUBLIC_DESKTOP_URL ?? "https://github.com/UmarIbnHattob/UmarIbnHattob#desktop-ilova-va-agent-rejimi";
// Yuborish bosilgandan keyin shu vaqt ichida To'xtatish bosilmaydi (ikki marta bosish ishni darhol to'xtatmasin)
const STOP_GUARD_MS = 500;

const TOOL_ICONS: Record<string, typeof FileText> = {
  list_dir: FolderTree,
  read_file: FileText,
  write_file: FilePen,
  edit_file: FilePen,
  search_files: Search,
  run_command: Terminal,
  update_plan: ListChecks,
  generate_image: ImagePlus,
  ask_expert: MessagesSquare,
};

function argSummary(name: string, args: Record<string, unknown>, t: ReturnType<typeof useI18n>["t"]) {
  if (INVALID_JSON in args) return t("agent.badArgsShort");
  if (name === "run_command") return String(args.command ?? "");
  if (name === "search_files") return `“${args.query}”${args.path && args.path !== "." ? ` · ${args.path}` : ""}`;
  if (name === "ask_expert") return `${expertiseOf(args)}: ${String(args.question ?? "").slice(0, 90)}`;
  return String(args.path ?? ".");
}

const OPENABLE = /\.(html?|svg|png|jpe?g|gif|webp|pdf|md|txt|csv)$/i;
const NEEDS_APPROVAL = new Set(["write_file", "edit_file", "run_command", "generate_image"]);
const FILE_TOOLS = new Set(["write_file", "edit_file", "generate_image"]);

/** Agentning jonli rejasi: bajarilgan qadamlar belgilanadi, progress chizig'i silliq to'ladi. */
function PlanPanel({ steps }: { steps: PlanStep[] }) {
  const { t } = useI18n();
  const done = steps.filter((s) => s.status === "done").length;
  return (
    <div className="msg-in sticky top-0 z-10 rounded-xl border border-violet-500/30 bg-neutral-900/95 p-3 shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-violet-300">
          <ListChecks size={14} /> {t("agent.plan")}
        </span>
        <span className="tabular-nums text-neutral-500">
          {done}/{steps.length}
        </span>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full bg-violet-500 transition-all duration-700" style={{ width: `${(done / Math.max(1, steps.length)) * 100}%` }} />
      </div>
      <ol className="grid gap-1 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={i} className={`flex items-center gap-2 text-sm transition-colors ${s.status === "done" ? "text-neutral-500 line-through" : s.status === "in_progress" ? "text-neutral-50" : "text-neutral-400"}`}>
            {s.status === "done" ? (
              <CheckCircle size={14} className="shrink-0 text-emerald-400" />
            ) : s.status === "in_progress" ? (
              <Loader2 size={14} className="shrink-0 animate-spin text-violet-400" />
            ) : (
              <CircleDashed size={14} className="shrink-0 text-neutral-600" />
            )}
            <span className="truncate">{s.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const QUICK: { label: TKey; prompt: TKey }[] = [
  { label: "agent.quick.website", prompt: "agent.prompt.website" },
  { label: "agent.quick.landing", prompt: "agent.prompt.landing" },
  { label: "agent.quick.bug", prompt: "agent.prompt.bug" },
  { label: "agent.quick.readme", prompt: "agent.prompt.readme" },
];

/** Bitta asbob chaqiruvi: ishlayotganda skaner nuri, tugagach natijani ochib ko'rish mumkin. */
function ToolCard({ item }: { item: Extract<AgentItem, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const { t } = useI18n();
  const Icon = TOOL_ICONS[item.name] ?? Terminal;
  const label = item.name in TOOL_ICONS ? t(`tool.${item.name}` as TKey) : item.name;
  const filePath = String(item.args.path ?? "");
  const desktop = getDesktop();
  const canOpen =
    item.status === "ok" && FILE_TOOLS.has(item.name) && OPENABLE.test(filePath) && !!desktop?.open;

  const canReveal = item.status === "ok" && FILE_TOOLS.has(item.name) && !!desktop?.reveal;

  async function openFile(e: React.MouseEvent) {
    e.stopPropagation();
    const r = await desktop!.open!(filePath);
    setOpenError(r.ok ? null : (r.error ?? t("agent.openFailed")));
  }

  async function revealFile(e: React.MouseEvent) {
    e.stopPropagation();
    const r = await desktop!.reveal!(filePath);
    setOpenError(r.ok ? null : (r.error ?? t("agent.revealFailed")));
  }

  return (
    <div className={`msg-in overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 ${item.status === "running" ? "scan relative" : ""}`}>
      <button
        onClick={() => item.output && setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <Icon size={15} className="shrink-0 text-violet-300" />
        <span className="shrink-0 text-neutral-400">{label}</span>
        <code className="min-w-0 flex-1 truncate text-neutral-200">{argSummary(item.name, item.args, t)}</code>
        {item.status === "running" && NEEDS_APPROVAL.has(item.name) && (
          <span className="shimmer-text text-xs">{t("agent.waitingApproval")}</span>
        )}
        {canOpen && (
          <span
            role="button"
            onClick={openFile}
            className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-0.5 text-xs text-white hover:bg-violet-500"
          >
            <ExternalLink size={12} /> {t("agent.open")}
          </span>
        )}
        {canReveal && (
          <span
            role="button"
            onClick={revealFile}
            title={t("agent.reveal")}
            className="flex items-center gap-1 rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-violet-500 hover:text-neutral-50"
          >
            <FolderSearch size={12} /> {t("agent.reveal")}
          </span>
        )}
        {item.status === "running" && <Loader2 size={15} className="animate-spin text-blue-300" />}
        {item.status === "ok" && <CheckCircle2 size={15} className="text-emerald-400" />}
        {item.status === "error" && <XCircle size={15} className="text-red-400" />}
        {item.output && <ChevronRight size={14} className={`text-neutral-500 transition-transform ${open ? "rotate-90" : ""}`} />}
      </button>
      {openError && <p className="border-t border-neutral-800 px-3 py-1.5 text-xs text-red-400">{openError}</p>}
      {open && item.output && (
        <pre className="max-h-72 overflow-auto border-t border-neutral-800 bg-neutral-950/60 p-3 text-xs text-neutral-300">{item.output}</pre>
      )}
    </div>
  );
}

/** Brauzerda ochilganda: agent faqat desktop ilovada ishlashini tushuntiradi. */
function NeedsDesktop() {
  const { t } = useI18n();
  return (
    <div className="mx-auto mt-16 flex max-w-lg flex-col items-center gap-5 p-8 text-center">
      <OrbitLogo size={80} />
      <h1 className="text-2xl font-semibold">{t("agent.title")}</h1>
      <p className="text-neutral-400">{t("agent.needsDesktop")}</p>
      <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300">
        <Laptop size={18} /> {t("agent.installDesktop")}
      </div>
      <a
        href={DESKTOP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500"
      >
        <Download size={16} /> {t("agent.getDesktop")}
      </a>
    </div>
  );
}

export default function AgentPage() {
  const { t } = useI18n();
  const { me } = useAuth();
  const sendWithEnter = me.preferences.send_with_enter;
  const [hasDesktop, setHasDesktop] = useState<boolean | null>(null);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [model, setModel] = useState("");
  const [folder, setFolder] = useState<{ name: string; path: string } | null>(null);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const agent = useAgent(model, folder?.name ?? null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    setHasDesktop(!!getDesktop());
    apiFetch<AgentModel[]>("/agent/models")
      .then((list) => {
        setModels(list);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(MODEL_KEY);
        } catch {
          /* e'tiborsiz */
        }
        setModel(list.some((m) => m.id === saved) ? saved! : "auto");
      })
      .catch((e) => setNotice((e as Error).message));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [agent.items]);

  if (hasDesktop === null) return null;
  if (!hasDesktop) return <NeedsDesktop />;

  const provider = agent.session?.provider ?? models.find((m) => m.id === model)?.provider;

  async function pick() {
    const f = await getDesktop()!.pickFolder();
    if (f) {
      setFolder(f);
      agent.reset();
    }
  }

  function start(text: string) {
    if (!text.trim() || agent.running || !folder) return;
    setNotice(null);
    startedAt.current = Date.now();
    agent.run(text);
    setInput("");
  }

  const submit = () => start(input);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 p-3">
        <button
          onClick={pick}
          disabled={agent.running}
          title={folder?.path}
          className="flex min-w-0 max-w-[16rem] items-center gap-2 rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-violet-500 disabled:opacity-50"
        >
          <FolderOpen size={15} className="shrink-0 text-violet-300" />
          <span className="truncate">{folder ? folder.name : t("agent.pickFolder")}</span>
        </button>
        {folder && (
          <span title={folder.path} className="hidden min-w-0 max-w-[18rem] truncate text-xs text-neutral-500 lg:inline-block">
            {folder.path}
          </span>
        )}
        {folder && getDesktop()?.openTerminal && (
          <button
            onClick={async () => {
              const r = await getDesktop()!.openTerminal!();
              setNotice(r.ok ? null : (r.error ?? null));
            }}
            title={t("agent.terminalHint")}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50"
          >
            <SquareTerminal size={14} /> {t("agent.terminal")}
          </button>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {agent.session && model === "auto" && (
            <span className="fade-swap hidden text-xs text-neutral-400 sm:inline">
              <span className="text-violet-400">Auto →</span> {agent.session.label}
            </span>
          )}
          <ModelSelector
            models={models}
            value={model}
            disabled={!!agent.session}
            title={agent.session ? t("agent.modelLocked") : undefined}
            onChange={(id) => {
              setModel(id);
              try {
                localStorage.setItem(MODEL_KEY, id);
              } catch {
                /* e'tiborsiz */
              }
            }}
          />
        </div>
        <button
          onClick={agent.reset}
          disabled={agent.running || !agent.started}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          <Plus size={14} /> {t("agent.newSession")}
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        {!folder && (
          <div className="msg-in mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center text-neutral-400">
            <OrbitLogo size={64} />
            <p>{t("agent.pickFirst")}</p>
            <button onClick={pick} className="rounded-md bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500">
              {t("agent.pickFolder")}
            </button>
          </div>
        )}
        {agent.plan.length > 0 && <PlanPanel steps={agent.plan} />}
        {folder && !agent.started && (
          <div className="msg-in mx-auto mt-16 flex max-w-xl flex-col items-center gap-4 text-center">
            <OrbitLogo size={56} focus={provider} />
            <p className="text-neutral-500">{t("agent.ready", { folder: folder.name })}</p>
            <div className="stagger flex flex-wrap justify-center gap-2">
              {QUICK.map((q, i) => (
                <button
                  key={q.label}
                  style={{ animationDelay: `${i * 60}ms` }}
                  onClick={() => {
                    setInput(t(q.prompt));
                    requestAnimationFrame(() => {
                      const el = document.querySelector<HTMLTextAreaElement>("#agent-input");
                      el?.focus();
                      el?.setSelectionRange(el.value.length, el.value.length);
                    });
                  }}
                  className="rounded-full border border-neutral-700 px-3 py-1.5 text-sm transition hover:-translate-y-0.5 hover:border-violet-500 hover:bg-violet-500/10"
                >
                  {t(q.label)}
                </button>
              ))}
            </div>
            {getDesktop()?.openTerminal && <p className="max-w-md text-xs text-neutral-500">💡 {t("agent.terminalHint")}</p>}
          </div>
        )}
        {agent.items.map((it) => {
          if (it.kind === "user")
            return (
              <div key={it.id} className="msg-in flex justify-end">
                <p className="min-w-0 max-w-[85%] whitespace-pre-wrap rounded-lg bg-blue-600 text-white px-4 py-2 [overflow-wrap:anywhere]">{it.text}</p>
              </div>
            );
          if (it.kind === "text")
            return (
              <div
                key={it.id}
                className="msg-in min-w-0 max-w-[90%] rounded-lg bg-neutral-800 px-4 py-2 [overflow-wrap:anywhere]"
                style={{ boxShadow: `inset 3px 0 0 ${colorOf(provider)}` }}
              >
                <Markdown>{it.text}</Markdown>
              </div>
            );
          if (it.kind === "note")
            return (
              <p key={it.id} className={`msg-in text-center text-xs [overflow-wrap:anywhere] ${it.tone === "error" ? "text-red-400" : "text-neutral-500"}`}>
                {it.text}
              </p>
            );
          return <ToolCard key={it.id} item={it} />;
        })}
        {agent.running && (
          <div className="flex items-center gap-3 py-1 text-sm">
            <OrbitLogo size={22} focus={provider} />
            <span className="shimmer-text">{t("agent.working")}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {notice && <p className="mx-4 mb-2 rounded bg-red-500/10 p-3 text-sm text-red-500">{notice}</p>}

      <div className="flex gap-2 border-t border-neutral-800 p-3">
        <textarea
          id="agent-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Sozlamaga qarab (chatdagidek): Enter yoki Ctrl/⌘+Enter yuboradi
            const send = sendWithEnter ? !e.shiftKey : e.ctrlKey || e.metaKey;
            if (e.key === "Enter" && send && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={!folder}
          rows={2}
          placeholder={folder ? t(sendWithEnter ? "agent.placeholder" : "agent.placeholderNoEnter") : t("agent.placeholderNoFolder")}
          className="flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm disabled:opacity-50"
        />
        {/* Papka tanlanmaguncha mikrofon ham o'chiq (fieldset ichidagi tugma disabled bo'ladi) */}
        <fieldset disabled={!folder} className="contents">
          <VoiceButton
            onText={(v) => {
              // Sozlamaga qarab: ovoz matni darhol yuboriladi yoki kiritish maydoniga qo'shiladi
              if (me.preferences.voice_auto_send && !agent.running) start(input.trim() ? `${input.trimEnd()} ${v}` : v);
              else setInput((p) => (p ? `${p.trimEnd()} ${v}` : v));
            }}
            onError={setNotice}
          />
        </fieldset>
        {agent.running ? (
          <button
            onClick={() => Date.now() - startedAt.current > STOP_GUARD_MS && agent.stop()}
            aria-label={t("chat.stop")}
            className="rounded-md bg-neutral-700 px-4"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!folder}
            aria-label={t("chat.send")}
            className="rounded-md bg-violet-600 px-4 hover:bg-violet-500 disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
