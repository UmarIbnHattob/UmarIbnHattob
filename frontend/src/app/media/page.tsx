"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Loader2, Sparkles, Trash2 } from "lucide-react";
import * as api from "@/lib/mediaApi";

/** Media Studio: matn bo'yicha rasm yaratish, galereya, yuklab olish. */
export default function MediaPage() {
  const [models, setModels] = useState<api.ImageModel[]>([]);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [items, setItems] = useState<api.MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
      await api.createImage(prompt.trim(), model);
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
      <p className="mt-1 text-sm text-neutral-400">Matn yozing, AI rasm yaratadi (Gemini kaliti kerak).</p>

      <div className="mt-6 rounded-lg border border-neutral-800 p-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Masalan: quyosh botayotgan paytda tog‘ ko‘li, realistik rasm"
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
            className="ml-auto flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? `Yaratilmoqda… ${sec}s` : "Rasm yaratish"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">Video yaratish keyingi versiyada qo‘shiladi.</p>
      </div>

      {error && (
        <div className="mt-4 rounded bg-red-950 p-3 text-sm text-red-300">
          {error}{" "}
          {error.includes("Settings") && (
            <Link href="/settings" className="underline">
              Settings ga o‘tish
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {busy && (
          <div className="flex aspect-square animate-pulse items-center justify-center rounded-lg bg-neutral-800 text-sm text-neutral-400">
            Rasm yaratilmoqda…
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className="group overflow-hidden rounded-lg border border-neutral-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={api.fileUrl(it.id)} alt={it.prompt} className="aspect-square w-full bg-neutral-900 object-cover" />
            <div className="flex items-start gap-2 p-2">
              <p className="line-clamp-2 flex-1 text-xs text-neutral-400">{it.prompt}</p>
              <a
                href={api.fileUrl(it.id, true)}
                aria-label="Yuklab olish"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
              >
                <Download size={16} />
              </a>
              <button
                onClick={() => remove(it.id)}
                aria-label="O'chirish"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {!busy && items.length === 0 && !error && (
        <p className="mt-10 text-center text-sm text-neutral-500">Hali rasm yo‘q. Birinchisini yarating.</p>
      )}
    </div>
  );
}
