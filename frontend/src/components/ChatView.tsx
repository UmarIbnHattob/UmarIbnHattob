"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Eye, PanelRightClose, PanelRightOpen, PenTool, Plus, Send, Square, Trash2 } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import { useResizable } from "@/hooks/useResizable";
import Markdown from "@/components/Markdown";
import ModelSelector from "@/components/ModelSelector";
import CodePreview from "@/components/CodePreview";
import type { CanvasHandle } from "@/components/CanvasPanel";

// Excalidraw faqat brauzerda ishlaydi va og'ir: kerak bo'lganda yuklanadi
const CanvasPanel = dynamic(() => import("@/components/CanvasPanel"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-neutral-500">Canvas yuklanmoqda…</p>,
});

type Tab = "preview" | "canvas";

/** Model javobi hali boshlanmagan payt: animatsiyali "o'ylayapti" belgisi va o'tgan soniyalar. */
function Thinking({ label }: { label: string | null | undefined }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 text-sm text-neutral-300">
      <span className="flex gap-1">
        {[0, 150, 300].map((d) => (
          <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-neutral-400" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      {label} javob tayyorlamoqda… {sec > 0 && <span className="text-neutral-500">{sec}s</span>}
    </div>
  );
}

/** Split-screen: chap tomonda chat, o'ng tomonda kod ko'rinishi va canvas (o'lchami o'zgaradi). */
export default function ChatView() {
  const chat = useChat();
  const { width, containerRef, onMouseDown } = useResizable();
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("preview");
  const [canvasOpened, setCanvasOpened] = useState(false);
  const [attachCanvas, setAttachCanvas] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canvasHandle = useRef<CanvasHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Server so'rovni rad etganda (masalan kalit yo'q) yozilgan matn kiritish maydoniga qaytadi
  useEffect(() => {
    if (chat.restoreText) setInput(chat.restoreText);
  }, [chat.restoreText]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  const currentModel = chat.models.find((m) => m.id === chat.model);

  function openTab(t: Tab) {
    setTab(t);
    setPanelOpen(true);
    if (t === "canvas") setCanvasOpened(true);
  }

  async function submit() {
    const text = input;
    if (!text.trim()) return;
    setNotice(null);
    let image: string | null = null;
    if (attachCanvas) {
      image = (await canvasHandle.current?.exportPng()) ?? null;
      if (!image) {
        setNotice("Canvas bo‘sh yoki ochilmagan, shuning uchun rasm ilova qilinmadi.");
      }
    }
    setInput("");
    chat.send(text, image);
  }

  const labelOf = (id: string | null) => chat.models.find((m) => m.id === id)?.label ?? id;
  const visionWarning = attachCanvas && currentModel && !currentModel.vision;

  return (
    <div ref={containerRef} className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-neutral-800 p-2">
        <button
          onClick={() => chat.select(null)}
          className="mb-2 flex items-center justify-center gap-2 rounded-md border border-neutral-700 py-2 text-sm hover:bg-neutral-800"
        >
          <Plus size={14} /> Yangi suhbat
        </button>
        <div className="flex-1 space-y-1 overflow-auto">
          {chat.conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center rounded-md px-2 py-1.5 text-sm ${
                c.id === chat.activeId ? "bg-neutral-800" : "hover:bg-neutral-900"
              }`}
            >
              <button onClick={() => chat.select(c.id)} className="flex-1 truncate text-left">
                {c.title}
              </button>
              <button
                onClick={() => chat.remove(c.id)}
                aria-label="O'chirish"
                className="hidden text-neutral-500 hover:text-red-400 group-hover:block"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-800 p-3">
          <ModelSelector models={chat.models} value={chat.model} onChange={chat.setModel} />
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => openTab("preview")}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              <Eye size={14} /> Preview
            </button>
            <button
              onClick={() => openTab("canvas")}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              <PenTool size={14} /> Canvas
            </button>
            <button
              onClick={() => setPanelOpen((o) => !o)}
              aria-label="Panelni ochish/yopish"
              className="rounded p-1 text-neutral-400 hover:bg-neutral-800"
            >
              {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {chat.messages.length === 0 && (
            <p className="mt-20 text-center text-neutral-500">Savol yozing, suhbat shu yerda boshlanadi.</p>
          )}
          {chat.messages.map((m, i) => {
            const isLast = i === chat.messages.length - 1;
            const live = chat.streaming && isLast && m.role === "assistant";
            return (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={`max-w-[90%] rounded-lg px-4 py-2 ${m.role === "user" ? "bg-blue-600" : "bg-neutral-800"}`}
              >
                {m.role === "assistant" && <div className="mb-1 text-xs text-neutral-400">{labelOf(m.model)}</div>}
                {m.has_canvas && <div className="mb-1 text-xs text-blue-200">🖼 Canvas rasmi ilova qilindi</div>}
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <>
                    {m.content ? (
                      <Markdown highlight={!live}>{m.content}</Markdown>
                    ) : (
                      <Thinking label={labelOf(m.model)} />
                    )}
                    {live && m.content && <span className="mt-1 inline-block h-4 w-2 animate-pulse bg-neutral-400 align-middle" />}
                  </>
                )}
              </div>
            </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {(chat.error || notice || visionWarning) && (
          <div className="mx-4 mb-2 space-y-1 rounded bg-red-950 p-3 text-sm text-red-300">
            {chat.error && (
              <p>
                {chat.error}{" "}
                {chat.error.includes("Settings") && (
                  <Link href="/settings" className="underline">
                    Settings ga o‘tish
                  </Link>
                )}
              </p>
            )}
            {notice && <p>{notice}</p>}
            {visionWarning && <p>{currentModel?.label} rasmni ko‘ra olmaydi. Claude yoki Gemini ni tanlang.</p>}
          </div>
        )}

        <div className="border-t border-neutral-800 p-3">
          <label className="mb-2 flex w-fit items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={attachCanvas} onChange={(e) => setAttachCanvas(e.target.checked)} />
            Canvasni AI ga ko‘rsatish (rasm sifatida ilova qilinadi)
          </label>
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              placeholder="Xabar yozing (Enter — yuborish, Shift+Enter — yangi qator)"
              className="flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm"
            />
            {chat.streaming ? (
              <button onClick={chat.stop} className="rounded-md bg-neutral-700 px-4" aria-label="To'xtatish">
                <Square size={16} />
              </button>
            ) : (
              <button onClick={submit} className="rounded-md bg-blue-600 px-4 hover:bg-blue-500" aria-label="Yuborish">
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {panelOpen && (
        <>
          <div
            onMouseDown={onMouseDown}
            role="separator"
            aria-orientation="vertical"
            className="w-1 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-blue-600"
          />
          <div style={{ width }} className="relative shrink-0 bg-neutral-950">
            <div className={`absolute inset-0 ${tab === "preview" ? "" : "invisible pointer-events-none"}`}>
              <CodePreview messages={chat.messages} streaming={chat.streaming} />
            </div>
            {canvasOpened && (
              <div className={`absolute inset-0 ${tab === "canvas" ? "" : "invisible pointer-events-none"}`}>
                <CanvasPanel handleRef={canvasHandle} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
