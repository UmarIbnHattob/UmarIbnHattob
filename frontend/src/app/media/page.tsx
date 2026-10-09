"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Loader2, Sparkles, Trash2 } from "lucide-react";
import * as api from "@/lib/mediaApi";
import { useI18n, type TKey } from "@/lib/i18n";

/** Media Studio: matn bo'yicha rasm yaratish, galereya, yuklab olish. */
export default function MediaPage() {
  const { t } = useI18n();
  const [models, setModels] = useState<api.ImageModel[]>([]);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [items, setItems] = useState<api.MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null); // yangi rasm "chiqish" animatsiyasi bilan ko'rinadi

  const load = useCallback(async () => {
    try {
      setItems(await api.getMedia());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api
      .getImageModels()
      .then((m) => {
        setModels(m);
        setModel(m[0]?.id ?? "");
      })
      .catch((e) => setError((e as Error).message));
    load();
  }, [load]);

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
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteMedia(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Media Studio</h1>
      <p className="mt-1 text-sm text-neutral-400">{t("media.subtitle")}</p>

      <div className="mt-6 rounded-lg border border-neutral-800 p-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder={t("media.placeholder")}
          className="w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 p-3 text-sm"
        />
        <div className="mt-3 flex items-center gap-3">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
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
            className="ml-auto flex items-center gap-2 rounded-md bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? `${t("media.generating")} ${sec}s` : t("media.generate")}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">{t("media.video")}</p>
      </div>

      {error && (
        <div className="mt-4 rounded bg-red-500/10 p-3 text-sm text-red-500">
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={api.fileUrl(it.id)}
              alt={it.prompt}
              className={`aspect-square w-full bg-neutral-900 object-cover ${it.id === freshId ? "develop" : ""}`}
            />
            <div className="flex items-start gap-2 p-2">
              <p className="line-clamp-2 flex-1 text-xs text-neutral-400">{it.prompt}</p>
              <a
                href={api.fileUrl(it.id, true)}
                aria-label={t("media.download")}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50"
              >
                <Download size={16} />
              </a>
              <button
                onClick={() => remove(it.id)}
                aria-label={t("common.delete")}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {!busy && items.length === 0 && !error && (
        <p className="mt-10 text-center text-sm text-neutral-500">{t("media.empty")}</p>
      )}
    </div>
  );
}

const DEV_PHRASES: TKey[] = ["media.dev.1", "media.dev.2", "media.dev.3", "media.dev.4", "media.dev.5"];

/** Rasm yaratilayotganda: Polaroid kartochka, skaner nuri va almashib turadigan yozuvlar. */
function DevelopingCard({ sec }: { sec: number }) {
  const { t } = useI18n();
  const phrase = t(DEV_PHRASES[Math.floor(sec / 3) % DEV_PHRASES.length]);
  return (
    <div className="msg-in rounded-lg bg-neutral-100 p-2 pb-8 shadow-xl" style={{ transform: "rotate(-1.5deg)" }}>
      <div className="scan relative flex aspect-square items-center justify-center overflow-hidden rounded bg-gradient-to-br from-neutral-800 via-neutral-900 to-black">
        <span key={phrase} className="fade-swap px-4 text-center text-sm text-neutral-300">
          {phrase}
        </span>
      </div>
      <p className="mt-2 text-center font-mono text-xs text-neutral-600">{sec}s</p>
    </div>
  );
}
