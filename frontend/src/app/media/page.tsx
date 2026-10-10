"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Loader2, Sparkles, X } from "lucide-react";
import * as api from "@/lib/mediaApi";
import { apiFetch } from "@/lib/api";
import { useI18n, type TKey } from "@/lib/i18n";
import { ConfirmDelete, ToastProvider, useToast } from "@/components/settings/ui";

/** Bir sahifadagi rasmlar soni ("Ko'proq yuklash" har safar shuncha qo'shadi). */
const PAGE = 60;
/** Backend cheklovi (routers/media.py ImageIn.prompt). */
const MAX_PROMPT = 4000;

/** Galereya sahifasi: (vaqt, id) kursori bilan — bir xil vaqtli rasmlar chegarada tushib qolmaydi. */
function getPage(after?: api.MediaItem) {
  const p = new URLSearchParams({ limit: String(PAGE) });
  if (after) {
    p.set("before", after.created_at);
    p.set("before_id", after.id);
  }
  return apiFetch<api.MediaItem[]>(`/media?${p}`);
}

export default function MediaPage() {
  return (
    <ToastProvider>
      <MediaStudio />
    </ToastProvider>
  );
}

/** Media Studio: matn bo'yicha rasm yaratish, galereya (sahifalab), kattalashtirib ko'rish, yuklab olish. */
function MediaStudio() {
  const { t } = useI18n();
  const toast = useToast();
  const [models, setModels] = useState<api.ImageModel[]>([]);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [items, setItems] = useState<api.MediaItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null); // yangi rasm "chiqish" animatsiyasi bilan ko'rinadi
  const [viewing, setViewing] = useState<api.MediaItem | null>(null);
  const mod = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl";

  useEffect(() => {
    api
      .getImageModels()
      .then((m) => {
        setModels(m);
        setModel(m[0]?.id ?? "");
      })
      .catch((e) => setError((e as Error).message));
    getPage()
      .then((page) => {
        setItems(page);
        setHasMore(page.length === PAGE);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  async function loadMore() {
    if (loadingMore || !items.length) return;
    setLoadingMore(true);
    try {
      const page = await getPage(items[items.length - 1]);
      setItems((cur) => [...cur, ...page.filter((p) => !cur.some((c) => c.id === p.id))]);
      setHasMore(page.length === PAGE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  // Yaratish paytida o'tgan soniyalarni ko'rsatamiz
  useEffect(() => {
    if (!busy) return;
    setSec(0);
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const item = await api.createImage(prompt.trim(), model);
      setFreshId(item.id);
      setPrompt("");
      // Yangi rasm boshiga qo'shiladi (yuklangan sahifalar joyida qoladi)
      setItems((cur) => [item, ...cur.filter((c) => c.id !== item.id)]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteMedia(id);
      setItems((cur) => cur.filter((c) => c.id !== id));
      toast(t("media.deleted"));
    } catch (e) {
      toast((e as Error).message, false);
    }
  }

  const closeViewer = useCallback(() => setViewing(null), []);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">{t("nav.media")}</h1>
      <p className="mt-1 text-sm text-neutral-400">{t("media.subtitle")}</p>

      <div className="mt-6 rounded-lg border border-neutral-800 p-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              generate();
            }
          }}
          rows={3}
          maxLength={MAX_PROMPT}
          aria-label={t("field.prompt")}
          placeholder={t("media.placeholder")}
          className="w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 p-3 text-sm"
        />
        <div className="mt-1 flex justify-between gap-3 text-xs text-neutral-500">
          <span>{t("media.shortcut", { mod })}</span>
          <span className={`tabular-nums ${prompt.length > MAX_PROMPT * 0.9 ? "text-amber-400" : ""}`}>
            {prompt.length} / {MAX_PROMPT}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label={t("media.model")}
            className="min-w-0 max-w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={generate}
            disabled={busy || !prompt.trim()}
            className="ml-auto flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? `${t("media.generating")} ${sec}s` : t("media.generate")}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">{t("media.video")}</p>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded bg-red-500/10 p-3 text-sm text-red-500">
          {error}{" "}
          {error.includes("Settings") && (
            <Link href="/settings" className="underline">
              {t("chat.toSettings")}
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {busy && <DevelopingCard sec={sec} />}
        {items.map((it) => (
          <div key={it.id} className="msg-in group overflow-hidden rounded-lg border border-neutral-800">
            <button type="button" onClick={() => setViewing(it)} aria-label={t("media.view")} className="block w-full cursor-zoom-in">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={api.fileUrl(it.id)}
                alt={it.prompt}
                loading="lazy"
                className={`aspect-square w-full bg-neutral-900 object-cover ${it.id === freshId ? "develop" : ""}`}
              />
            </button>
            <div className="flex flex-wrap items-start gap-2 p-2">
              <p className="line-clamp-2 min-w-0 flex-1 text-xs text-neutral-400">{it.prompt}</p>
              <a
                href={api.fileUrl(it.id, true)}
                aria-label={t("media.download")}
                title={t("media.download")}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50"
              >
                <Download size={16} />
              </a>
              <ConfirmDelete
                question={t("media.confirmDelete")}
                onConfirm={() => remove(it.id)}
                size={16}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
              />
            </div>
          </div>
        ))}
      </div>
      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 rounded-md border border-neutral-700 px-4 py-2 text-sm transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {loadingMore && <Loader2 size={15} className="animate-spin" />}
            {t("media.loadMore")}
          </button>
        </div>
      )}
      {!busy && items.length === 0 && !error && <p className="mt-10 text-center text-sm text-neutral-500">{t("media.empty")}</p>}
      {viewing && <Lightbox item={viewing} onClose={closeViewer} />}
    </div>
  );
}

/** Rasmni to'liq o'lchamda ko'rish: Esc, fon yoki × bilan yopiladi; fokus oynada qoladi va keyin joyiga qaytadi. */
function Lightbox({ item, onClose }: { item: api.MediaItem; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (prev?.isConnected) prev.focus();
    };
  }, [onClose]);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>("a[href], button")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
  };
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={item.prompt}
      onKeyDown={trap}
      onClick={onClose}
      className="backdrop-in fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4 backdrop-blur-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={api.fileUrl(item.id)}
        alt={item.prompt}
        onClick={(e) => e.stopPropagation()}
        className="modal-in max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
      />
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-2xl items-start gap-2 text-sm text-white/90">
        <p className="line-clamp-3 min-w-0 flex-1">{item.prompt}</p>
        <a href={api.fileUrl(item.id, true)} aria-label={t("media.download")} title={t("media.download")} className="rounded-md p-1.5 hover:bg-white/10">
          <Download size={18} />
        </a>
        <button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="rounded-md p-1.5 hover:bg-white/10">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

const DEV_PHRASES: TKey[] = ["media.dev.1", "media.dev.2", "media.dev.3", "media.dev.4", "media.dev.5"];

/**
 * Rasm yaratilayotganda: Polaroid kartochka, skaner nuri va almashib turadigan yozuvlar.
 * Ranglar mavzuga bog'liq emas (Polaroid ikkala mavzuda ham oq ramkali).
 */
function DevelopingCard({ sec }: { sec: number }) {
  const { t } = useI18n();
  const phrase = t(DEV_PHRASES[Math.floor(sec / 3) % DEV_PHRASES.length]);
  return (
    <div role="status" className="msg-in rounded-lg bg-[#f5f5f4] p-2 pb-8 shadow-xl ring-1 ring-black/5" style={{ transform: "rotate(-1.5deg)" }}>
      <div className="scan relative flex aspect-square items-center justify-center overflow-hidden rounded bg-gradient-to-br from-[#262626] via-[#171717] to-black">
        <span key={phrase} className="fade-swap px-4 text-center text-sm text-[#d4d4d4]">
          {phrase}
        </span>
      </div>
      <p className="mt-2 text-center font-mono text-xs text-[#52525b]">{sec}s</p>
    </div>
  );
}
