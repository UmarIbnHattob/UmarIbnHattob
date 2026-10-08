"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2, Check } from "lucide-react";
import { apiFetch } from "@/lib/api";

type Provider = "anthropic" | "deepseek" | "gemini";
type KeyStatus = { provider: Provider; configured: boolean; last4: string | null; platform_available: boolean };
type Usage = { month: string; used: number; limit: number; platform_providers: Provider[] };

const LABELS: Record<Provider, string> = {
  anthropic: "Claude (Anthropic)",
  deepseek: "Deepseek",
  gemini: "Gemini (Google)",
};

/** API kalitlarni kiritish/o'chirish sahifasi. Kalit faqat backendga yuboriladi va u yerda shifrlanadi. */
export default function SettingsPage() {
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [inputs, setInputs] = useState<Partial<Record<Provider, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await apiFetch<KeyStatus[]>("/keys"));
      setUsage(await apiFetch<Usage>("/usage"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(provider: Provider) {
    const key = inputs[provider]?.trim();
    if (!key) return;
    try {
      await apiFetch(`/keys/${provider}`, { method: "PUT", body: JSON.stringify({ key }) });
      setInputs((s) => ({ ...s, [provider]: "" }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(provider: Provider) {
    try {
      await apiFetch(`/keys/${provider}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-neutral-400">
        API kalitlar serverda shifrlangan holda saqlanadi.
      </p>
      {error && <p className="mt-4 rounded bg-red-950 p-3 text-sm text-red-300">{error}</p>}

      {usage && usage.platform_providers.length > 0 && (
        <div className="msg-in mt-6 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">Bepul platforma limiti</span>
            <span className="tabular-nums text-neutral-400">
              {usage.used} / {usage.limit} so‘rov · {usage.month}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#4d6bfe] via-[#a78bfa] to-[#e07a5f] transition-all duration-700"
              style={{ width: `${Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            O‘z kalitingiz bo‘lmagan provayderlar uchun platforma kaliti ishlatiladi. O‘z kalitingizni kiritsangiz — limit
            qo‘llanmaydi.
          </p>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {keys.map(({ provider, configured, last4, platform_available }) => (
          <div key={provider} className="rounded-lg border border-neutral-800 p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-medium">
                <KeyRound size={16} /> {LABELS[provider]}
              </span>
              {!configured && platform_available && (
                <span className="text-xs text-violet-300">Platforma kaliti ishlatiladi</span>
              )}
              {configured && (
                <span className="flex items-center gap-1 text-sm text-green-400">
                  <Check size={14} /> •••• {last4}
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                placeholder={configured ? "Yangi kalit bilan almashtirish" : "API kalitni kiriting"}
                value={inputs[provider] ?? ""}
                onChange={(e) => setInputs((s) => ({ ...s, [provider]: e.target.value }))}
                className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
              <button
                onClick={() => save(provider)}
                className="rounded-md bg-blue-600 px-4 text-sm hover:bg-blue-500"
              >
                Saqlash
              </button>
              {configured && (
                <button
                  onClick={() => remove(provider)}
                  className="rounded-md border border-neutral-700 px-3 hover:bg-neutral-800"
                  aria-label="O'chirish"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
