"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useI18n, type TKey } from "@/lib/i18n";
import { useAuth } from "@/components/AuthGate";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Eye, MessagesSquare, PanelRightClose, PanelRightOpen, PenTool, Send, Square, X } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import { useResizable } from "@/hooks/useResizable";
import { useDrawer } from "@/hooks/useDrawer";
import Markdown from "@/components/Markdown";
import ModelSelector from "@/components/ModelSelector";
import CodePreview from "@/components/CodePreview";
import OrbitLogo from "@/components/OrbitLogo";
import VoiceButton from "@/components/VoiceButton";
import ConversationList from "@/components/ConversationList";
import CopyButton from "@/components/CopyButton";
import { colorOf } from "@/lib/providers";
import type { RouteInfo } from "@/lib/chatApi";
import type { CanvasHandle } from "@/components/CanvasPanel";

// Excalidraw faqat brauzerda ishlaydi va og'ir: kerak bo'lganda yuklanadi
const CanvasPanel = dynamic(() => import("@/components/CanvasPanel"), {
  ssr: false,
  loading: () => <CanvasLoading />,
});

type Tab = "preview" | "canvas";

// Auto yo'nalishi sababi (server `kind` yuboradi) — interfeys tilida
const KIND_KEYS: Record<string, TKey> = {
  image: "auto.kind.image",
  vision: "auto.kind.vision",
  code: "auto.kind.code",
  reasoning: "auto.kind.reasoning",
  general: "auto.kind.general",
};

// Rasm modellari /models katalogida yo'q (ular chat modeli emas): nomi va rangi shu yerdan (reloaddan keyin ham)
const IMAGE_MODELS: Record<string, { label: string; provider: string }> = {
  "gemini-2.5-flash-image": { label: "Gemini 2.5 Flash Image", provider: "gemini" },
  "gemini-2.5-flash-image-preview": { label: "Gemini 2.5 Flash Image", provider: "gemini" },
  "gemini-2.0-flash-preview-image-generation": { label: "Gemini 2.0 Flash Image", provider: "gemini" },
};

// Backend cheklovi (schemas.SendMessageIn.content): oshsa server 422 qaytaradi — oldindan cheklaymiz va sanab ko'rsatamiz
const MAX_INPUT = 50_000;
// Yuborish tugmasi shu vaqt "uchib" turadi, keyin (javob kelayotgan bo'lsa) "To'xtatish" ga almashadi
const FLY_MS = 600;
const WIDE = "(min-width: 1280px)"; // xl: preview/canvas paneli standart holda ochiq

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
      <span className="text-center text-[11px] text-neutral-500">
        <span style={{ color: fromColor }}>{from}</span> → <span style={{ color: toColor }}>{to}</span> · {t("chat.handoff")}
      </span>
    </div>
  );
}

/**
 * Split-screen: chap tomonda suhbatlar va chat, o'ng tomonda kod ko'rinishi va canvas (o'lchami o'zgaradi).
 * Tor ekranda: suhbatlar chapdan chiqadigan panel, preview/canvas esa chat ustidan to'liq kenglikda ochiladi.
 */
export default function ChatView() {
  const { t } = useI18n();
  const { me } = useAuth();
  const chat = useChat(me.preferences.default_model);
  const sendWithEnter = me.preferences.send_with_enter;
  const { width, fits, containerRef, onPointerDown, onKeyDown: onSeparatorKey, min, max } = useResizable();
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE).matches);
  const [listOpen, setListOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("preview");
  const [canvasOpened, setCanvasOpened] = useState(false);
  const [attachCanvas, setAttachCanvas] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [flying, setFlying] = useState(0); // 0 — yo'q; aks holda animatsiya kaliti
  const canvasHandle = useRef<CanvasHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listBtnRef = useRef<HTMLButtonElement>(null);
  const nearBottom = useRef(true);
  // Canvas rasmi tayyorlanayotganda (eksport) ikkinchi Enter/bosish ikkinchi xabar yubormasin
  const sendingRef = useRef(false);
  const flyTimer = useRef<ReturnType<typeof setTimeout>>();
  useDrawer(listOpen, () => setListOpen(false), listRef, listBtnRef, "(min-width: 1024px)");

  // Server so'rovni rad etganda (masalan kalit yo'q) yozilgan matn kiritish maydoniga qaytadi
  useEffect(() => {
    if (chat.restoreText) setInput(chat.restoreText);
  }, [chat.restoreText]);

  // Foydalanuvchi yuqoriga o'qish uchun chiqqan bo'lsa, majburan pastga tortmaymiz
  useEffect(() => {
    if (nearBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages]);

  useEffect(() => () => clearTimeout(flyTimer.current), []);

  const currentModel = chat.models.find((m) => m.id === chat.model);
  const overlay = !fits; // yonma-yon joy yetmaydi: panel chat ustidan ochiladi

  // Oyna torayib yonma-yon joy qolmasa, ochiq panel chatni to'sib qo'ymasin: yopamiz (tugma bilan qayta ochiladi)
  const fitted = useRef(fits);
  useEffect(() => {
    if (fitted.current && !fits) setPanelOpen(false);
    fitted.current = fits;
  }, [fits]);

  function openTab(next: Tab) {
    setTab(next);
    setPanelOpen(true);
    if (next === "canvas") setCanvasOpened(true);
  }

  /** "Yuborish" belgisi uchib ketadi; shu payt tugma o'z joyida qoladi (ikkinchi bosish "To'xtatish" ga tushmaydi). */
  function fly() {
    setFlying((n) => n + 1);
    clearTimeout(flyTimer.current);
    flyTimer.current = setTimeout(() => setFlying(0), FLY_MS);
  }

  /** Canvas rasmi: panel ochilmagan (yoki yopilgan) bo'lsa — shu brauzerda saqlangan chizmadan. */
  async function canvasImage(): Promise<string | null> {
    if (canvasHandle.current) return canvasHandle.current.exportPng();
    const { exportSavedCanvas } = await import("@/components/CanvasPanel");
    return exportSavedCanvas(me.id);
  }

  async function submit() {
    const text = input;
    // Oqim paytida matn o'chib ketmasin; model yuklanmagan bo'lsa ham yubormaymiz
    if (!text.trim() || chat.streaming || sendingRef.current || !chat.model) return;
    if (visionWarning) return; // ogohlantirish allaqachon ko'rinib turibdi: server baribir rad etadi
    sendingRef.current = true;
    setNotice(null);
    nearBottom.current = true;
    fly();
    try {
      let image: string | null = null;
      if (attachCanvas) {
        image = await canvasImage().catch(() => null);
        if (!image) setNotice(t("chat.canvasEmpty"));
      }
      setInput("");
      await chat.send(text, image);
    } finally {
      sendingRef.current = false;
    }
  }

  const imageModel = (id: string | null) => (id ? IMAGE_MODELS[id] : undefined);
  const labelOf = (id: string | null) =>
    id === "auto"
      ? "Auto"
      : (chat.models.find((m) => m.id === id)?.label ?? imageModel(id)?.label ?? id?.split(":").pop() ?? id);
  const providerOf = (id: string | null) => chat.models.find((m) => m.id === id)?.provider ?? imageModel(id)?.provider;
  const routeText = (r: RouteInfo) => {
    const why = r.kind && KIND_KEYS[r.kind] ? t(KIND_KEYS[r.kind]) : r.reason;
    return why ? `${r.label} · ${why}` : r.label;
  };
  const visionWarning = attachCanvas && currentModel && !currentModel.vision;
  const showStop = chat.streaming && !flying;

  const tabButton = (id: Tab, Icon: typeof Eye, label: string, wide = false) => {
    const on = panelOpen && tab === id;
    return (
      <button
        onClick={() => openTab(id)}
        aria-pressed={on}
        aria-label={label}
        title={label}
        className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
          on ? "bg-neutral-800 text-neutral-50" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50"
        }`}
      >
        <Icon size={14} className={on ? "text-violet-400" : ""} /> <span className={wide ? "" : "hidden sm:inline"}>{label}</span>
      </button>
    );
  };

  return (
    <div className="relative flex h-full min-h-0">
      {/* Suhbatlar: lg dan kengda doimiy ustun, torroq ekranda chapdan chiqadigan panel */}
      {listOpen && (
        <div className="backdrop-in absolute inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setListOpen(false)} aria-hidden="true" />
      )}
      <div
        id="chat-list"
        ref={listRef}
        role={listOpen ? "dialog" : undefined}
        aria-modal={listOpen || undefined}
        aria-label={t("chat.conversations")}
        className={`absolute inset-y-0 left-0 z-40 w-72 max-w-[85%] border-r border-neutral-800 bg-neutral-950 transition-[transform,visibility] duration-200 lg:visible lg:static lg:z-auto lg:w-56 lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:bg-transparent lg:shadow-none ${
          listOpen ? "translate-x-0 shadow-2xl" : "invisible -translate-x-full"
        }`}
      >
        <ConversationList chat={chat} onPicked={() => setListOpen(false)} />
      </div>

      <div ref={containerRef} className="relative flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 p-2 sm:p-3">
            <button
              ref={listBtnRef}
              onClick={() => setListOpen(true)}
              aria-label={t("chat.conversations")}
              title={t("chat.conversations")}
              aria-expanded={listOpen}
              aria-controls="chat-list"
              className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50 lg:hidden"
            >
              <MessagesSquare size={18} />
            </button>
            <div className="min-w-0 max-w-full">
              <ModelSelector models={chat.models} value={chat.model} onChange={chat.setModel} />
            </div>
            <div className="ml-auto flex items-center gap-1">
              {tabButton("preview", Eye, t("chat.preview"))}
              {tabButton("canvas", PenTool, t("chat.canvas"))}
              <button
                onClick={() => setPanelOpen((o) => !o)}
                aria-label={t("chat.togglePanel")}
                title={t("chat.togglePanel")}
                aria-expanded={panelOpen}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50"
              >
                {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            </div>
          </div>

          <div
            onScroll={(e) => {
              const el = e.currentTarget;
              nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}
            className="flex-1 space-y-4 overflow-auto p-3 sm:p-4"
          >
            {chat.messages.length === 0 && (
              <div className="msg-in mt-20 flex flex-col items-center gap-4 px-4 text-center text-neutral-500">
                <OrbitLogo size={64} />
                <p>{t("chat.empty")}</p>
              </div>
            )}
            {(() => {
              let lastModel: string | null = null;
              let lastName = "";
              // Auto yo'nalishi bo'lsa — uning chiroyli nomi, aks holda katalogdagi nom
              const nameOf = (x: (typeof chat.messages)[number]) => x.route?.label ?? labelOf(x.model) ?? "";
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
                        className={`min-w-0 max-w-[90%] rounded-lg px-4 py-2 ${m.role === "user" ? "bg-blue-600 text-white" : "bg-neutral-800"}`}
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
                                <span className="text-violet-400">Auto →</span> {routeText(m.route)}
                              </span>
                            ) : (
                              labelOf(m.model)
                            )}
                          </div>
                        )}
                        {m.has_canvas && <div className="mb-1 text-xs text-blue-200">{t("chat.canvasAttached")}</div>}
                        {m.role === "user" ? (
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.content}</p>
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
                      {m.role === "assistant" && m.content && !live && (
                        <div className="mt-1 flex">
                          <CopyButton
                            text={m.content}
                            label={t("chat.copy")}
                            showLabel
                            className="px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                          />
                        </div>
                      )}
                    </div>
                  </Fragment>
                );
              });
            })()}
            <div ref={bottomRef} />
          </div>

          {(chat.error || notice || visionWarning) && (
            <div className="mx-3 mb-2 space-y-1 break-words rounded bg-red-500/10 p-3 text-sm text-red-500 sm:mx-4">
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
              {visionWarning && (
                <p>
                  {currentModel?.label} {t("chat.noVision")}
                </p>
              )}
            </div>
          )}

          <div className="border-t border-neutral-800 p-2 sm:p-3">
            <div className="mb-2 flex items-center gap-2">
              <label className="flex w-fit items-center gap-2 text-xs text-neutral-400">
                <input type="checkbox" checked={attachCanvas} onChange={(e) => setAttachCanvas(e.target.checked)} />
                {t("chat.attachCanvas")}
              </label>
              {/* Chegaraga yaqinlashganda (90%) belgilar soni ko'rinadi */}
              {input.length > MAX_INPUT * 0.9 && (
                <span className="ml-auto text-xs tabular-nums text-amber-400" aria-live="polite">
                  {input.length.toLocaleString()} / {MAX_INPUT.toLocaleString()}
                </span>
              )}
            </div>
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
                maxLength={MAX_INPUT}
                placeholder={t(sendWithEnter ? "chat.placeholder" : "chat.placeholderNoEnter")}
                className="min-w-0 flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm"
              />
              <VoiceButton
                onText={(v) => {
                  // Muvaffaqiyatli ovozli xabar: eski (masalan, "ruxsat yo'q") ogohlantirish endi kerak emas
                  setNotice(null);
                  // Sozlamaga qarab: ovoz matni darhol yuboriladi yoki kiritish maydoniga qo'shiladi
                  if (me.preferences.voice_auto_send && !chat.streaming && !sendingRef.current) {
                    const text = input.trim() ? `${input.trimEnd()} ${v}` : v;
                    setInput("");
                    nearBottom.current = true;
                    fly();
                    chat.send(text);
                  } else {
                    setInput((prev) => (prev ? `${prev.trimEnd()} ${v}` : v));
                  }
                }}
                onError={setNotice}
              />
              {showStop ? (
                <button onClick={chat.stop} className="shrink-0 rounded-md bg-neutral-700 px-4" aria-label={t("chat.stop")} title={t("chat.stop")}>
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={submit}
                  // Uchish paytida (yuborilgandan keyingi ~0.6 s) qayta bosish hech narsa qilmaydi
                  disabled={!!flying}
                  className="shrink-0 overflow-hidden rounded-md bg-blue-600 px-4 text-white transition-transform hover:bg-blue-500 active:scale-95 disabled:hover:bg-blue-600"
                  aria-label={t("chat.send")}
                  title={t("chat.send")}
                >
                  <Send key={flying} size={16} className={flying ? "fly" : ""} />
                </button>
              )}
            </div>
          </div>
        </div>

        {(panelOpen || canvasOpened) && (
          <>
            {panelOpen && !overlay && (
              <div
                onPointerDown={onPointerDown}
                onKeyDown={onSeparatorKey}
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={width}
                aria-valuemin={min}
                aria-valuemax={max}
                tabIndex={0}
                className="w-1 shrink-0 cursor-col-resize touch-none bg-neutral-800 hover:bg-blue-600 focus-visible:bg-blue-600 focus-visible:outline-none"
              />
            )}
            {/* Yopilganda ham canvas o'chirilmaydi (faqat yashiriladi): chizma va "ilova qilish" uchun eksport saqlanadi */}
            <div
              style={panelOpen && !overlay ? { width } : undefined}
              className={
                !panelOpen
                  ? "hidden"
                  : overlay
                    ? "absolute inset-0 z-20 flex flex-col bg-neutral-950"
                    : "relative flex shrink-0 flex-col bg-neutral-950"
              }
            >
              {overlay && (
                <div className="flex items-center gap-1 border-b border-neutral-800 p-2">
                  {tabButton("preview", Eye, t("chat.preview"), true)}
                  {tabButton("canvas", PenTool, t("chat.canvas"), true)}
                  <button
                    onClick={() => setPanelOpen(false)}
                    aria-label={t("chat.closePanel")}
                    title={t("chat.closePanel")}
                    className="ml-auto rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              <div className="relative min-h-0 flex-1">
                {panelOpen && (
                  <div className={`absolute inset-0 ${tab === "preview" ? "" : "invisible pointer-events-none"}`}>
                    <CodePreview messages={chat.messages} streaming={chat.streaming} />
                  </div>
                )}
                {canvasOpened && (
                  <div className={`absolute inset-0 ${tab === "canvas" ? "" : "invisible pointer-events-none"}`}>
                    <CanvasPanel handleRef={canvasHandle} userId={me.id} />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
