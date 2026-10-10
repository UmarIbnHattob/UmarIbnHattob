"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, ExternalLink, Globe2, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { btnCls, btnGhostCls, inputCls, Section, useToast } from "@/components/settings/ui";

type Preset = { name: string; base_url: string; needs_key: boolean; local: boolean; key_url: string; note: string };
type Connected = { id: string; kind: string; name: string; base_url: string; has_key: boolean; model_count: number; free_count: number; local: boolean };

const ORDER = ["openai", "openrouter", "groq", "mistral", "xai", "together", "ollama", "lmstudio", "custom"];

export default function ProvidersTab() {
  const { t } = useI18n();
  const toast = useToast();
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [allowLocal, setAllowLocal] = useState(true);
  const [list, setList] = useState<Connected[]>([]);
  const [form, setForm] = useState<{ kind: string; key: string; url: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await apiFetch<Connected[]>("/providers"));
    } catch (e) {
      toast((e as Error).message, false);
    }
  }, [toast]);

  useEffect(() => {
    apiFetch<{ presets: Record<string, Preset>; allow_local: boolean }>("/providers/presets")
      .then((r) => {
        setPresets(r.presets);
        setAllowLocal(r.allow_local);
      })
      .catch(() => {});
    load();
  }, [load]);

  async function add() {
    if (!form) return;
    setBusy("add");
    try {
      const p = await apiFetch<Connected>("/providers", {
        method: "POST",
        body: JSON.stringify({ kind: form.kind, api_key: form.key || null, base_url: form.url || null, name: form.name || null }),
      });
      toast(t("prov.added", { n: p.model_count }));
      setForm(null);
      await load();
    } catch (e) {
      toast((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, kind: "refresh" | "delete") {
    setBusy(id);
    try {
      if (kind === "refresh") {
        const p = await apiFetch<Connected>(`/providers/${id}/refresh`, { method: "POST" });
        toast(t("prov.models", { n: p.model_count }));
      } else {
        await apiFetch(`/providers/${id}`, { method: "DELETE" });
      }
      await load();
    } catch (e) {
      toast((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  const cloud = ORDER.filter((k) => presets[k] && !presets[k].local);
  const local = ORDER.filter((k) => presets[k]?.local);

  // Oddiy funksiya (komponent emas): har renderda qayta yaratilsa input fokusini yo'qotmasin
  const renderCard = (kind: string) => {
    const p = presets[kind];
    const openForm = form?.kind === kind;
    return (
      <div className={`rounded-xl border p-4 transition ${openForm ? "border-violet-500 bg-violet-500/5" : "border-neutral-800 hover:border-neutral-600"}`}>
        <div className="flex items-center gap-2">
          {p.local ? <Cpu size={16} className="text-emerald-400" /> : <Globe2 size={16} className="text-violet-300" />}
          <span className="font-medium">{p.name}</span>
          {p.key_url && (
            <a href={p.key_url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-xs text-violet-300 hover:underline">
              {p.local ? "↗" : t("prov.getKey")} <ExternalLink size={11} />
            </a>
          )}
        </div>
        <p className="mt-1 min-h-8 text-xs text-neutral-400">{p.note}</p>
        {openForm ? (
          <div className="pop-in mt-3 space-y-2">
            {p.needs_key && (
              <input type="password" autoFocus placeholder={t("prov.apiKey")} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className={inputCls} />
            )}
            {(kind === "custom" || p.local) && (
              <input placeholder={t("prov.baseUrl")} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className={inputCls} />
            )}
            {kind === "custom" && (
              <>
                <input placeholder={t("prov.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
                <input type="password" placeholder={`${t("prov.apiKey")} (ixtiyoriy)`} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className={inputCls} />
              </>
            )}
            <div className="flex gap-2">
              <button className={`${btnCls} flex flex-1 items-center justify-center gap-2`} disabled={busy === "add" || (p.needs_key && !form.key.trim())} onClick={add}>
                {busy === "add" && <Loader2 size={14} className="animate-spin" />}
                {busy === "add" ? t("prov.adding") : t("prov.add")}
              </button>
              <button className={btnGhostCls} onClick={() => setForm(null)} aria-label={t("common.cancel")}>
                <X size={14} />
              </button>
            </div>
          </div>
        ) : (
          <button
            className="mt-3 flex items-center gap-1 text-sm text-violet-300 hover:text-violet-200"
            onClick={() => setForm({ kind, key: "", url: p.base_url, name: "" })}
          >
            <Plus size={14} /> {t("prov.add")}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <h2 id="providers" className="mb-1 scroll-mt-6 text-base font-semibold">{t("prov.moreTitle")}</h2>
      <p className="mb-3 text-sm text-neutral-400">{t("prov.desc")}</p>
      <p className="mb-6 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-xs leading-relaxed text-neutral-300">{t("prov.howto")}</p>
      {list.length > 0 && (
        <Section title={t("prov.yours")}>
          {list.map((c) => (
            <div key={c.id} className="msg-in flex flex-wrap items-center gap-3 px-4 py-3">
              {c.local ? <Cpu size={16} className="text-emerald-400" /> : <Globe2 size={16} className="text-violet-300" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.name}</div>
                <div className="truncate font-mono text-[11px] text-neutral-500">{c.base_url}</div>
              </div>
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs tabular-nums">{t("prov.models", { n: c.model_count })}</span>
              {c.free_count > 0 && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">{t("prov.freeModels", { n: c.free_count })}</span>
              )}
              <button onClick={() => act(c.id, "refresh")} disabled={busy === c.id} title={t("prov.refresh")} className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800">
                <RefreshCw size={15} className={busy === c.id ? "animate-spin" : ""} />
              </button>
              <button onClick={() => act(c.id, "delete")} title={t("common.delete")} className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-red-400">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </Section>
      )}

      <h2 className="mb-3 text-base font-semibold">{t("prov.available")}</h2>
      <div className="stagger mb-8 grid gap-3 sm:grid-cols-2">
        {cloud.map((k, i) => (
          <div key={k} style={{ animationDelay: `${i * 40}ms` }}>
            {renderCard(k)}
          </div>
        ))}
      </div>

      <h2 className="mb-1 text-base font-semibold">{t("prov.localTitle")}</h2>
      <p className="mb-3 text-xs text-neutral-400">{t("prov.localSteps")}</p>
      {!allowLocal && <p className="mb-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-500">{t("prov.localDisabled")}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {local.map((k) => (
          <div key={k}>{renderCard(k)}</div>
        ))}
      </div>
    </>
  );
}
