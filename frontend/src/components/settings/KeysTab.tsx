"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, KeyRound, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { API_KEY_LINKS, type Provider } from "@/lib/me";
import { colorOf, PROVIDER_LABELS } from "@/lib/providers";
import { useAuth } from "@/components/AuthGate";
import { btnCls, inputCls, Section, useToast } from "@/components/settings/ui";
import QuotaMeter from "@/components/settings/QuotaMeter";

type KeyStatus = { provider: Provider; configured: boolean; last4: string | null; platform_available: boolean };

export default function KeysTab() {
  const { t } = useI18n();
  const { refreshMe } = useAuth();
  const toast = useToast();
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [inputs, setInputs] = useState<Partial<Record<Provider, string>>>({});

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
    if (!key) return;
    try {
      await apiFetch(`/keys/${p}`, { method: "PUT", body: JSON.stringify({ key }) });
      setInputs((s) => ({ ...s, [p]: "" }));
      toast(t("common.saved"));
      await Promise.all([load(), refreshMe()]);
    } catch (e) {
      toast((e as Error).message, false);
    }
  }
  async function remove(p: Provider) {
    try {
      await apiFetch(`/keys/${p}`, { method: "DELETE" });
      await Promise.all([load(), refreshMe()]);
    } catch (e) {
      toast((e as Error).message, false);
    }
  }

  return (
    <>
      <QuotaMeter />
      <Section title={t("settings.tab.keys")} desc={t("settings.keysInfo")}>
        {keys.map(({ provider, configured, last4, platform_available }) => (
          <div key={provider} className="px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(provider) }} />
              <KeyRound size={15} className="text-neutral-400" />
              <span className="font-medium">{PROVIDER_LABELS[provider]}</span>
              <a href={API_KEY_LINKS[provider].url} target="_blank" rel="noopener noreferrer" className="ml-1 flex items-center gap-1 text-xs text-violet-300 hover:underline">
                {t("settings.getKey")} <ExternalLink size={11} />
              </a>
              <span className="ml-auto">
                {configured ? (
                  <span className="flex items-center gap-1 text-sm text-emerald-400">
                    <Check size={14} /> •••• {last4}
                  </span>
                ) : (
                  platform_available && <span className="text-xs text-violet-300">{t("settings.platformKey")}</span>
                )}
              </span>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                autoComplete="off"
                placeholder={configured ? t("settings.keyReplace") : t("settings.keyPlaceholder")}
                value={inputs[provider] ?? ""}
                onChange={(e) => setInputs((s) => ({ ...s, [provider]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && save(provider)}
                className={inputCls}
              />
              <button onClick={() => save(provider)} disabled={!inputs[provider]?.trim()} className={btnCls}>
                {t("common.save")}
              </button>
              {configured && (
                <button onClick={() => remove(provider)} aria-label={t("common.delete")} className="rounded-md border border-neutral-700 px-3 hover:border-red-500/50 hover:text-red-400">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}
