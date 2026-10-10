"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { API_KEY_LINKS, type Provider } from "@/lib/me";
import { colorOf, PROVIDER_LABELS } from "@/lib/providers";
import { useAuth } from "@/components/AuthGate";
import { btnCls, ConfirmDelete, inputCls, Section, useToast } from "@/components/settings/ui";
import QuotaMeter from "@/components/settings/QuotaMeter";
import ProvidersTab from "@/components/settings/ProvidersTab";

type KeyStatus = {
  provider: Provider;
  configured: boolean;
  last4: string | null;
  platform_available: boolean;
  platform_exhausted?: boolean; // platforma kaliti bor, lekin shu oylik bepul limit tugagan
};

// Backend bilan bir xil cheklov (schemas.ApiKeyIn)
const KEY_MIN = 8;
const KEY_MAX = 500;

export default function KeysTab() {
  const { t } = useI18n();
  const { refreshMe } = useAuth();
  const toast = useToast();
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [inputs, setInputs] = useState<Partial<Record<Provider, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<Provider, string>>>({});
  const [saving, setSaving] = useState<Provider | null>(null);
  const busy = useRef(false); // ikki marta bosish / Enter takrori ikkinchi so'rov yubormasin

  const load = useCallback(async () => {
    try {
      setKeys(await apiFetch<KeyStatus[]>("/keys"));
    } catch (e) {
      toast((e as Error).message, false);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function save(p: Provider) {
    const key = inputs[p]?.trim();
    if (!key || busy.current) return;
    if (key.length < KEY_MIN || key.length > KEY_MAX) {
      const field = t("field.key");
      setErrors((s) => ({ ...s, [p]: key.length < KEY_MIN ? t("err.tooShort", { field, n: KEY_MIN }) : t("err.tooLong", { field, n: KEY_MAX }) }));
      return;
    }
    busy.current = true;
    setSaving(p);
    try {
      await apiFetch(`/keys/${p}`, { method: "PUT", body: JSON.stringify({ key }) });
      setInputs((s) => ({ ...s, [p]: "" }));
      toast(t("common.saved"));
      await Promise.all([load(), refreshMe()]);
    } catch (e) {
      toast((e as Error).message, false);
    } finally {
      busy.current = false;
      setSaving(null);
    }
  }
  async function remove(p: Provider) {
    try {
      await apiFetch(`/keys/${p}`, { method: "DELETE" });
      toast(t("keys.deleted"));
      await Promise.all([load(), refreshMe()]);
    } catch (e) {
      toast((e as Error).message, false);
    }
  }

  return (
    <>
      <QuotaMeter />
      <Section title={t("settings.tab.keys")} desc={t("settings.keysInfo")}>
        {keys.map(({ provider, configured, last4, platform_available, platform_exhausted }) => (
          <div key={provider} className="px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(provider) }} />
              <KeyRound size={15} className="text-neutral-400" />
              <span className="font-medium">{PROVIDER_LABELS[provider]}</span>
              <a href={API_KEY_LINKS[provider].url} target="_blank" rel="noopener noreferrer" className="ml-1 flex items-center gap-1 text-xs text-violet-300 hover:underline">
                {t("settings.getKey")} <ExternalLink size={11} />
              </a>
              <span className="ml-auto flex items-center gap-2">
                {configured ? (
                  <>
                    <span className="flex items-center gap-1 font-mono text-sm text-emerald-400">
                      <Check size={14} /> •••• {last4}
                    </span>
                    <ConfirmDelete question={t("keys.confirmDelete")} disabled={saving === provider} onConfirm={() => remove(provider)} />
                  </>
                ) : platform_exhausted ? (
                  <span className="text-xs text-amber-400">{t("keys.limitReached")}</span>
                ) : (
                  platform_available && <span className="text-xs text-violet-300">{t("settings.platformKey")}</span>
                )}
              </span>
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                save(provider);
              }}
            >
              <input
                type="password"
                autoComplete="off"
                aria-label={`${PROVIDER_LABELS[provider]}: ${configured ? t("settings.keyReplace") : t("settings.keyPlaceholder")}`}
                aria-invalid={!!errors[provider]}
                placeholder={configured ? t("settings.keyReplace") : t("settings.keyPlaceholder")}
                value={inputs[provider] ?? ""}
                onChange={(e) => {
                  setInputs((s) => ({ ...s, [provider]: e.target.value }));
                  setErrors((s) => ({ ...s, [provider]: undefined }));
                }}
                className={`${inputCls} min-w-0 ${errors[provider] ? "border-red-500/60" : ""}`}
              />
              <button disabled={!inputs[provider]?.trim() || saving === provider} className={`${btnCls} flex shrink-0 items-center gap-2`}>
                {saving === provider && <Loader2 size={14} className="animate-spin" />}
                {t("common.save")}
              </button>
            </form>
            {errors[provider] && <p className="mt-1.5 text-xs text-red-400">{errors[provider]}</p>}
          </div>
        ))}
      </Section>
      {/* Qolgan barcha provayderlar (OpenAI, OpenRouter, Groq, lokal…) shu sahifaning o'zida */}
      <ProvidersTab />
    </>
  );
}
