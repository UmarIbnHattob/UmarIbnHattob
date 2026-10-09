"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/components/AuthGate";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Eye, PanelRightClose, PanelRightOpen, PenTool, Plus, Send, Square, Trash2 } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import { useResizable } from "@/hooks/useResizable";
import Markdown from "@/components/Markdown";
import ModelSelector from "@/components/ModelSelector";
import CodePreview from "@/components/CodePreview";
import OrbitLogo from "@/components/OrbitLogo";
import VoiceButton from "@/components/VoiceButton";
import { colorOf } from "@/lib/providers";
import type { CanvasHandle } from "@/components/CanvasPanel";

// Excalidraw faqat brauzerda ishlaydi va og'ir: kerak bo'lganda yuklanadi
const CanvasPanel = dynamic(() => import("@/components/CanvasPanel"), {
  ssr: false,
  loading: () => <CanvasLoading />,
});

type Tab = "preview" | "canvas";

function CanvasLoading() {
  const { t } = useI18n();
  return <p className="p-6 text-sm text-neutral-500">{t("canvas.loading")}</p>;
}

/** Model javobi hali boshlanmagan payt: model rangidagi mini-orbita, yaltiroq matn va o'tgan soniyalar. */
function Thinking({ label, provider }: { label: string | null | undefined; provider?: string }) {
  const { t } = useI18n();
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  // Uzoq kutilsa, kayfiyatni ko'taruvchi yozuv almashadi
  const phrase = t(sec < 6 ? "chat.thinking.1" : sec < 15 ? "chat.thinking.2" : "chat.thinking.3");
  return (
    <div className="flex items-center gap-3 py-1 text-sm">
      <OrbitLogo size={22} focus={provider} />
      <span key={phrase} className="shimmer-text fade-swap">
        {label} {phrase}…
      </span>
      {sec > 0 && <span className="tabular-nums text-xs text-neutral-500">{sec}s</span>}
    </div>
  );
}

/** Suhbat o'rtasida model almashganda: "A → B · kontekst uzatildi" va bir rangdan ikkinchisiga yuguruvchi nur. */
function Handoff({ from, to, fromColor, toColor }: { from: string; to: string; fromColor: string; toColor: string }) {
  const { t } = useI18n();
  return (
    <div className="msg-in mx-auto flex max-w-md flex-col items-center gap-1.5 py-1">
      <div className="handoff-line w-full" style={{ ["--from" as string]: fromColor, ["--to" as string]: toColor }} />
      <span className="text-[11px] text-neutral-500">
        <span style={{ color: fromColor }}>{from}</span> → <span style={{ color: toColor }}>{to}</span> · {t("chat.handoff")}
      </span>
    </div>
  );
}

/** Split-screen: chap tomonda chat, o'ng tomonda kod ko'rinishi va canvas (o'lchami o'zgaradi). */
export default function ChatView() {
  const { t } = useI18n();
  const { me } = useAuth();
  const chat = useChat(me.preferences.default_model);
  const sendWithEnter = me.preferences.send_with_enter;
  const { width, containerRef, onMouseDown } = useResizable();
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("preview");
  const [canvasOpened, setCanvasOpened] = useState(false);
  const [attachCanvas, setAttachCanvas] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canvasHandle = useRef<CanvasHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [fly, setFly] = useState(0);

  // Server so'rovni rad etganda (masalan kalit yo'q) yozilgan matn kiritish maydoniga qaytadi
  useEffect(() => {
    if (chat.restoreText) setInput(chat.restoreText);
  }, [chat.restoreText]);

  // Foydalanuvchi yuqoriga o'qish uchun chiqqan bo'lsa, majburan pastga tortmaymiz
  useEffect(() => {
    if (nearBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages]);

  const currentModel = chat.models.find((m) => m.id === chat.model);

  function openTab(t: Tab) {
    setTab(t);
    setPanelOpen(true);
    if (t === "canvas") setCanvasOpened(true);
  }

  async function submit() {
    const text = input;
    if (!text.trim() || chat.streaming) return; // oqim paytida matn o'chib ketmasin
    setNotice(null);
    nearBottom.current = true;
    setFly((n) => n + 1);
    let image: string | null = null;
    if (attachCanvas) {
      image = (await canvasHandle.current?.exportPng()) ?? null;
      if (!image) {
        setNotice(t("chat.canvasEmpty"));
      }
    }
    setInput("");
    chat.send(text, image);
  }

  const labelOf = (id: string | null) => (id === "auto" ? "Auto" : (chat.models.find((m) => m.id === id)?.label ?? id?.split(":").pop() ?? id));
  const providerOf = (id: string | null) => chat.models.find((m) => m.id === id)?.provider;
  const visionWarning = attachCanvas && currentModel && !currentModel.vision;

  return (
    <div ref={containerRef} className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-neutral-800 p-2">
        <button
          onClick={() => chat.select(null)}
          className="mb-2 flex items-center justify-center gap-2 rounded-md border border-neutral-700 py-2 text-sm hover:bg-neutral-800"
        >
          <Plus size={14} /> {t("chat.newChat")}
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
                aria-label={t("common.delete")}
                className="hidden text-neutral-500 hover:text-red-400 group-hover:block"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 p-3">
          <ModelSelector models={chat.models} value={chat.model} onChange={chat.setModel} />
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => openTab("preview")}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              <Eye size={14} /> {t("chat.preview")}
            </button>
            <button
              onClick={() => openTab("canvas")}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              <PenTool size={14} /> {t("chat.canvas")}
            </button>
            <button
              onClick={() => setPanelOpen((o) => !o)}
              aria-label={t("chat.togglePanel")}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-800"
            >
              {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>
          </div>
        </div>

        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
          className="flex-1 space-y-4 overflow-auto p-4"
        >
          {chat.messages.length === 0 && (
            <div className="msg-in mt-20 flex flex-col items-center gap-4 text-neutral-500">
              <OrbitLogo size={64} />
              <p>{t("chat.empty")}</p>
            </div>
          )}
          {(() => {
            let lastModel: string | null = null;
            let lastName = "";
            // Auto yo'nalishi bo'lsa — uning chiroyli nomi, aks holda katalogdagi nom
            const nameOf = (x: (typeof chat.messages)[number]) => x.route?.split(" · ")[0] ?? labelOf(x.model) ?? "";
            return chat.messages.map((m, i) => {
              const isLast = i === chat.messages.length - 1;
              const live = chat.streaming && isLast && m.role === "assistant";
              // Oldingi assistant javobining modeli bilan solishtiramiz: almashgan bo'lsa "handoff" chizig'i chiqadi
              const prevModel = m.role === "assistant" ? lastModel : null;
              const prevName = lastName;
              if (m.role === "assistant") {
                lastModel = m.model;
                lastName = nameOf(m);
              }
              const switched = !!prevModel && !!m.model && prevModel !== m.model;
              return (
                <Fragment key={m.id}>
                  {switched && (
                    <Handoff
                      from={prevName}
                      to={nameOf(m)}
                      fromColor={colorOf(providerOf(prevModel))}
                      toColor={colorOf(providerOf(m.model))}
                    />
                  )}
                  <div
                    className={`msg-in ${m.role === "user" ? "flex justify-end" : ""}`}
                    style={{ animationDelay: `${Math.min(i * 25, 250)}ms` }}
                  >
                    <div
                      className={`max-w-[90%] rounded-lg px-4 py-2 ${m.role === "user" ? "bg-blue-600 text-white" : "bg-neutral-800"}`}
                      style={
                        m.role === "assistant"
                          ? { boxShadow: `inset 3px 0 0 ${colorOf(providerOf(m.model))}` }
                          : undefined
                      }
                    >
                      {m.role === "assistant" && (
                        <div className="mb-1 text-xs" style={{ color: colorOf(providerOf(m.model)) }}>
                          {m.route ? (
                            <span className="fade-swap">
                              <span className="text-violet-400">Auto →</span> {m.route}
                            </span>
                          ) : (
                            labelOf(m.model)
                          )}
                        </div>
                      )}
                      {m.has_canvas && <div className="mb-1 text-xs text-blue-200">{t("chat.canvasAttached")}</div>}
                      {m.role === "user" ? (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      ) : (
                        <>
                          {m.content ? (
                            <Markdown highlight={!live}>{m.content}</Markdown>
                          ) : (
                            <Thinking label={labelOf(m.model)} provider={providerOf(m.model)} />
                          )}
                          {live && m.content && (
                            <span className="mt-1 inline-block h-4 w-2 animate-pulse bg-neutral-400 align-middle" />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            });
          })()}
          <div ref={bottomRef} />
        </div>

        {(chat.error || notice || visionWarning) && (
          <div className="mx-4 mb-2 space-y-1 rounded bg-red-500/10 p-3 text-sm text-red-500">
            {chat.error && (
              <p>
                {chat.error}{" "}
                {chat.error.includes("Settings") && (
                  <Link href="/settings" className="underline">
                    {t("chat.toSettings")}
                  </Link>
                )}
              </p>
            )}
            {notice && <p>{notice}</p>}
            {visionWarning && <p>{currentModel?.label} {t("chat.noVision")}</p>}
          </div>
        )}

        <div className="border-t border-neutral-800 p-3">
          <label className="mb-2 flex w-fit items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={attachCanvas} onChange={(e) => setAttachCanvas(e.target.checked)} />
            {t("chat.attachCanvas")}
          </label>
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // isComposing: IME (masalan, emoji/xitoy klaviaturasi) bilan yozayotganda Enter yubormasin
                // Sozlamaga qarab: Enter yoki Ctrl/⌘+Enter yuboradi
                const send = sendWithEnter ? !e.shiftKey : e.ctrlKey || e.metaKey;
                if (e.key === "Enter" && send && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              placeholder={t(sendWithEnter ? "chat.placeholder" : "chat.placeholderNoEnter")}
              className="flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm"
            />
            <VoiceButton
              onText={(v) => {
                // Sozlamaga qarab: ovoz matni darhol yuboriladi yoki kiritish maydoniga qo'shiladi
                if (me.preferences.voice_auto_send && !chat.streaming) {
                  const text = input.trim() ? `${input.trimEnd()} ${v}` : v;
                  setInput("");
                  setFly((n) => n + 1);
                  chat.send(text);
                } else {
                  setInput((prev) => (prev ? `${prev.trimEnd()} ${v}` : v));
                }
              }}
              onError={setNotice}
            />
            {chat.streaming ? (
              <button onClick={chat.stop} className="rounded-md bg-neutral-700 px-4" aria-label={t("chat.stop")}>
                <Square size={16} />
              </button>
            ) : (
              <button
                onClick={submit}
                className="overflow-hidden rounded-md bg-blue-600 text-white px-4 transition-transform hover:bg-blue-500 active:scale-95"
                aria-label={t("chat.send")}
              >
                <Send key={fly} size={16} className={fly ? "fly" : ""} />
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
            className="w-1 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-blue-600 text-white"
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
