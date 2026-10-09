"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FilePen,
  FileText,
  FolderOpen,
  FolderSearch,
  FolderTree,
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
import { useAgent, type AgentItem } from "@/hooks/useAgent";
import Markdown from "@/components/Markdown";
import OrbitLogo from "@/components/OrbitLogo";
import VoiceButton from "@/components/VoiceButton";

type AgentModel = { id: string; label: string; provider: string };
const MODEL_KEY = "omniai-agent-model";

const TOOL_META: Record<string, { icon: typeof FileText; label: string }> = {
  list_dir: { icon: FolderTree, label: "Papkani ko‘rish" },
  read_file: { icon: FileText, label: "O‘qish" },
  write_file: { icon: FilePen, label: "Yozish" },
  edit_file: { icon: FilePen, label: "O‘zgartirish" },
  search_files: { icon: Search, label: "Qidirish" },
  run_command: { icon: Terminal, label: "Buyruq" },
};

function argSummary(name: string, args: Record<string, unknown>) {
  if (name === "run_command") return String(args.command ?? "");
  if (name === "search_files") return `“${args.query}”${args.path && args.path !== "." ? ` · ${args.path}` : ""}`;
  return String(args.path ?? ".");
}

const OPENABLE = /\.(html?|svg|png|jpe?g|gif|webp|pdf|md|txt|csv)$/i;
const NEEDS_APPROVAL = new Set(["write_file", "edit_file", "run_command"]);

/** Bitta asbob chaqiruvi: ishlayotganda skaner nuri, tugagach natijani ochib ko'rish mumkin. */
function ToolCard({ item }: { item: Extract<AgentItem, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const meta = TOOL_META[item.name] ?? { icon: Terminal, label: item.name };
  const Icon = meta.icon;
  const filePath = String(item.args.path ?? "");
  const desktop = getDesktop();
  const canOpen =
    item.status === "ok" && (item.name === "write_file" || item.name === "edit_file") && OPENABLE.test(filePath) && !!desktop?.open;

  const canReveal = item.status === "ok" && (item.name === "write_file" || item.name === "edit_file") && !!desktop?.reveal;

  async function openFile(e: React.MouseEvent) {
    e.stopPropagation();
    const r = await desktop!.open!(filePath);
    setOpenError(r.ok ? null : (r.error ?? "Ochib bo‘lmadi"));
  }

  async function revealFile(e: React.MouseEvent) {
    e.stopPropagation();
    const r = await desktop!.reveal!(filePath);
    setOpenError(r.ok ? null : (r.error ?? "Ko‘rsatib bo‘lmadi"));
  }

  return (
    <div className={`msg-in overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 ${item.status === "running" ? "scan relative" : ""}`}>
      <button
        onClick={() => item.output && setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <Icon size={15} className="shrink-0 text-violet-300" />
        <span className="shrink-0 text-neutral-400">{meta.label}</span>
        <code className="min-w-0 flex-1 truncate text-neutral-200">{argSummary(item.name, item.args)}</code>
        {item.status === "running" && NEEDS_APPROVAL.has(item.name) && (
          <span className="shimmer-text text-xs">ruxsatingiz kutilmoqda — oynani tekshiring</span>
        )}
        {canOpen && (
          <span
            role="button"
            onClick={openFile}
            className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-0.5 text-xs text-white hover:bg-violet-500"
          >
            <ExternalLink size={12} /> Ochish
          </span>
        )}
        {canReveal && (
          <span
            role="button"
            onClick={revealFile}
            title="Fayl menejerida ko‘rsatish"
            className="flex items-center gap-1 rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-violet-500 hover:text-white"
          >
            <FolderSearch size={12} /> Papkada ko‘rsatish
          </span>
        )}
        {item.status === "running" && <Loader2 size={15} className="animate-spin text-blue-300" />}
        {item.status === "ok" && <CheckCircle2 size={15} className="text-emerald-400" />}
        {item.status === "error" && <XCircle size={15} className="text-red-400" />}
        {item.output && <ChevronRight size={14} className={`text-neutral-500 transition-transform ${open ? "rotate-90" : ""}`} />}
      </button>
      {openError && <p className="border-t border-neutral-800 px-3 py-1.5 text-xs text-red-400">{openError}</p>}
      {open && item.output && (
        <pre className="max-h-72 overflow-auto border-t border-neutral-800 bg-black/40 p-3 text-xs text-neutral-300">{item.output}</pre>
      )}
    </div>
  );
}

/** Brauzerda ochilganda: agent faqat desktop ilovada ishlashini tushuntiradi. */
function NeedsDesktop() {
  return (
    <div className="mx-auto mt-16 flex max-w-lg flex-col items-center gap-5 p-8 text-center">
      <OrbitLogo size={80} />
      <h1 className="text-2xl font-semibold">Agent rejimi</h1>
      <p className="text-neutral-400">
        Agent kompyuteringizdagi papka bilan ishlaydi: fayllarni o‘qiydi, yozadi, qidiradi va buyruqlarni ishga tushiradi.
        Xavfsizlik uchun bu faqat <b className="text-neutral-200">OmniAI desktop ilovasida</b> ishlaydi — brauzer sahifasi
        kompyuteringiz fayllariga kira olmaydi.
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300">
        <Laptop size={18} /> Windows, macOS va Linux uchun desktop ilovani o‘rnating
      </div>
    </div>
  );
}

export default function AgentPage() {
  const [hasDesktop, setHasDesktop] = useState<boolean | null>(null);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [model, setModel] = useState("");
  const [folder, setFolder] = useState<{ name: string; path: string } | null>(null);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const agent = useAgent(model, folder?.name ?? null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
        setModel(list.some((m) => m.id === saved) ? saved! : (list[0]?.id ?? ""));
      })
      .catch((e) => setNotice((e as Error).message));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [agent.items]);

  if (hasDesktop === null) return null;
  if (!hasDesktop) return <NeedsDesktop />;

  const provider = models.find((m) => m.id === model)?.provider;

  async function pick() {
    const f = await getDesktop()!.pickFolder();
    if (f) {
      setFolder(f);
      agent.reset();
    }
  }

  function submit() {
    if (!input.trim() || agent.running || !folder) return;
    setNotice(null);
    agent.run(input);
    setInput("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 p-3">
        <button
          onClick={pick}
          disabled={agent.running}
          className="flex items-center gap-2 rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-violet-500 disabled:opacity-50"
        >
          <FolderOpen size={15} className="text-violet-300" />
          {folder ? folder.name : "Papka tanlash"}
        </button>
        {folder && <span className="hidden truncate text-xs text-neutral-500 md:inline">{folder.path}</span>}
        <select
          value={model}
          disabled={agent.started}
          title={agent.started ? "Modelni almashtirish uchun yangi sessiya boshlang" : undefined}
          onChange={(e) => {
            setModel(e.target.value);
            try {
              localStorage.setItem(MODEL_KEY, e.target.value);
            } catch {
              /* e'tiborsiz */
            }
          }}
          className="ml-auto min-w-0 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm disabled:opacity-60"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button
          onClick={agent.reset}
          disabled={agent.running || !agent.started}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          <Plus size={14} /> Yangi sessiya
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        {!folder && (
          <div className="msg-in mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center text-neutral-400">
            <OrbitLogo size={64} />
            <p>Avval AI ishlaydigan papkani tanlang. Har bir yozish va buyruq uchun sizdan ruxsat so‘raladi.</p>
            <button onClick={pick} className="rounded-md bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500">
              Papka tanlash
            </button>
          </div>
        )}
        {folder && !agent.started && (
          <p className="msg-in mt-16 text-center text-neutral-500">
            “{folder.name}” bilan ishlashga tayyorman. Masalan: “loyiha tuzilmasini tushuntir” yoki “README yoz”.
          </p>
        )}
        {agent.items.map((it) => {
          if (it.kind === "user")
            return (
              <div key={it.id} className="msg-in flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-blue-600 px-4 py-2">{it.text}</p>
              </div>
            );
          if (it.kind === "text")
            return (
              <div
                key={it.id}
                className="msg-in max-w-[90%] rounded-lg bg-neutral-800 px-4 py-2"
                style={{ boxShadow: `inset 3px 0 0 ${colorOf(provider)}` }}
              >
                <Markdown>{it.text}</Markdown>
              </div>
            );
          if (it.kind === "note")
            return (
              <p key={it.id} className={`msg-in text-center text-xs ${it.tone === "error" ? "text-red-400" : "text-neutral-500"}`}>
                {it.text}
              </p>
            );
          return <ToolCard key={it.id} item={it} />;
        })}
        {agent.running && (
          <div className="flex items-center gap-3 py-1 text-sm">
            <OrbitLogo size={22} focus={provider} />
            <span className="shimmer-text">Agent ishlamoqda…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {notice && <p className="mx-4 mb-2 rounded bg-red-950 p-3 text-sm text-red-300">{notice}</p>}

      <div className="flex gap-2 border-t border-neutral-800 p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={!folder}
          rows={2}
          placeholder={folder ? "Vazifa yozing yoki mikrofon orqali ayting…" : "Avval papka tanlang"}
          className="flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm disabled:opacity-50"
        />
        <VoiceButton onText={(t) => setInput((p) => (p ? `${p.trimEnd()} ${t}` : t))} onError={setNotice} />
        {agent.running ? (
          <button onClick={agent.stop} aria-label="To'xtatish" className="rounded-md bg-neutral-700 px-4">
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!folder}
            aria-label="Yuborish"
            className="rounded-md bg-violet-600 px-4 hover:bg-violet-500 disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
