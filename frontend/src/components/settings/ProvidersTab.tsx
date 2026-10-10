"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, ExternalLink, Globe2, Loader2, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { apiFetch, RequestError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { plural, presetName, presetNote, providerName } from "@/lib/providers";
import { btnCls, btnGhostCls, ConfirmDelete, inputCls, Section, useToast } from "@/components/settings/ui";

type Preset = { name: string; base_url: string; needs_key: boolean; local: boolean; key_url: string; note: string };
type Connected = { id: string; kind: string; name: string; base_url: string; has_key: boolean; model_count: number; free_count: number; local: boolean };

const ORDER = ["openai", "openrouter", "groq", "mistral", "xai", "together", "ollama", "lmstudio", "custom"];
// Backend cheklovlari (routers/providers.py)
const NAME_MAX = 60;
const URL_MAX = 300;
const KEY_MAX = 500;

/** Manzillarni solishtirish uchun: katta-kichik harf va oxirgi "/" farq qilmaydi (backenddagi takror tekshiruvi kabi). */
const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, "").toLowerCase() === b.trim().replace(/\/+$/, "").toLowerCase();

export default function ProvidersTab() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [allowLocal, setAllowLocal] = useState(true);
  const [list, setList] = useState<Connected[]>([]);
  const [form, setForm] = useState<{ kind: string; key: string; url: string; name: string } | null>(null);
  const [formError, setFormError] = useState<{ text: string; dupId?: string } | null>(null);
  const [edit, setEdit] = useState<{ id: string; name: string; key: string } | null>(null);
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

  const models = (n: number) => plural(t, lang, "prov.modelsN", n);
  const nameOf = (c: Connected) => providerName(t, c.kind, c.name);
  const openForm = (kind: string) => {
    setForm({ kind, key: "", url: presets[kind].base_url, name: "" });
    setFormError(null);
  };

  async function add() {
    if (!form || busy) return;
    setBusy("add");
    setFormError(null);
    try {
      const p = await apiFetch<Connected>("/providers", {
        method: "POST",
        body: JSON.stringify({ kind: form.kind, api_key: form.key.trim() || null, base_url: form.url.trim() || null, name: form.name.trim() || null }),
      });
      toast(t("prov.addedWith", { models: models(p.model_count) }));
      setForm(null);
      await load();
    } catch (e) {
      const text = (e as Error).message;
      // 409: shu provayder allaqachon ulangan — uni tahrirlashni taklif qilamiz (kalitni almashtirish uchun)
      const url = form.url || presets[form.kind]?.base_url || "";
      const dup = e instanceof RequestError && e.status === 409 ? list.find((c) => c.kind === form.kind && sameUrl(c.base_url, url)) : undefined;
      setFormError({ text, dupId: dup?.id });
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(c: Connected) {
    if (!edit || busy) return;
    const body: { name?: string; api_key?: string } = {};
    if (edit.name.trim() && edit.name.trim() !== nameOf(c)) body.name = edit.name.trim();
    if (edit.key.trim()) body.api_key = edit.key.trim();
    if (!Object.keys(body).length) return setEdit(null);
    setBusy(c.id);
    try {
      const p = await apiFetch<Connected>(`/providers/${c.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(body.api_key ? `${t("common.saved")}: ${models(p.model_count)}` : t("common.saved"));
      setEdit(null);
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
        toast(models(p.model_count));
      } else {
        await apiFetch(`/providers/${id}`, { method: "DELETE" });
        toast(t("prov.deleted"));
        if (edit?.id === id) setEdit(null);
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
    const isOpen = form?.kind === kind;
    return (
      <div className={`rounded-xl border p-4 transition ${isOpen ? "border-violet-500 bg-violet-500/5" : "border-neutral-800 hover:border-neutral-600"}`}>
        <div className="flex items-center gap-2">
          {p.local ? <Cpu size={16} className="shrink-0 text-emerald-400" /> : <Globe2 size={16} className="shrink-0 text-violet-300" />}
          <span className="min-w-0 font-medium">{presetName(t, kind, p.name)}</span>
          {p.key_url && (
            <a href={p.key_url} target="_blank" rel="noopener noreferrer" className="ml-auto flex shrink-0 items-center gap-1 text-xs text-violet-300 hover:underline">
              {p.local ? t("prov.download") : t("prov.getKey")} <ExternalLink size={11} />
            </a>
          )}
        </div>
        <p className="mt-1 min-h-8 text-xs text-neutral-400">{presetNote(t, kind, p.note)}</p>
        {isOpen ? (
          <form
            className="pop-in mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            {p.needs_key && (
              <input
                type="password"
                autoFocus
                autoComplete="off"
                maxLength={KEY_MAX}
                aria-label={t("prov.apiKey")}
                placeholder={t("prov.apiKey")}
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                className={inputCls}
              />
            )}
            {(kind === "custom" || p.local) && (
              <input
                autoFocus={!p.needs_key}
                maxLength={URL_MAX}
                aria-label={t("prov.baseUrl")}
                placeholder={t("prov.baseUrl")}
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                className={inputCls}
              />
            )}
            {kind === "custom" && (
              <>
                <input
                  maxLength={NAME_MAX}
                  aria-label={t("prov.name")}
                  placeholder={t("prov.name")}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                />
                <input
                  type="password"
                  autoComplete="off"
                  maxLength={KEY_MAX}
                  aria-label={`${t("prov.apiKey")} (${t("prov.optional")})`}
                  placeholder={`${t("prov.apiKey")} (${t("prov.optional")})`}
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  className={inputCls}
                />
              </>
            )}
            {formError && (
              <p role="alert" className="text-xs text-red-400">
                {formError.text}{" "}
                {formError.dupId && (
                  <button
                    type="button"
                    className="font-medium text-violet-300 underline"
                    onClick={() => {
                      const c = list.find((x) => x.id === formError.dupId);
                      if (c) setEdit({ id: c.id, name: nameOf(c), key: "" });
                      setForm(null);
                      setFormError(null);
                    }}
                  >
                    {t("prov.edit")}
                  </button>
                )}
              </p>
            )}
            <div className="flex gap-2">
              <button className={`${btnCls} flex flex-1 items-center justify-center gap-2`} disabled={busy === "add" || (p.needs_key && !form.key.trim())}>
                {busy === "add" && <Loader2 size={14} className="animate-spin" />}
                {busy === "add" ? t("prov.adding") : t("prov.add")}
              </button>
              <button type="button" className={btnGhostCls} onClick={() => setForm(null)} aria-label={t("common.cancel")}>
                <X size={14} />
              </button>
            </div>
          </form>
        ) : (
          <button className="mt-3 flex items-center gap-1 text-sm text-violet-300 hover:text-violet-200" onClick={() => openForm(kind)}>
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
            <div key={c.id} className="msg-in px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {c.local ? <Cpu size={16} className="shrink-0 text-emerald-400" /> : <Globe2 size={16} className="shrink-0 text-violet-300" />}
                <div className="min-w-0 flex-1 basis-40">
                  <div className="truncate text-sm font-medium">{nameOf(c)}</div>
                  <div className="truncate font-mono text-[11px] text-neutral-500">{c.base_url}</div>
                </div>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs tabular-nums text-neutral-200">{models(c.model_count)}</span>
                  {c.free_count > 0 && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">{plural(t, lang, "prov.freeN", c.free_count)}</span>
                  )}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => setEdit(edit?.id === c.id ? null : { id: c.id, name: nameOf(c), key: "" })}
                    disabled={busy === c.id}
                    aria-expanded={edit?.id === c.id}
                    aria-label={t("prov.edit")}
                    title={t("prov.edit")}
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => act(c.id, "refresh")}
                    disabled={busy === c.id}
                    aria-label={t("prov.refresh")}
                    title={t("prov.refresh")}
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    <RefreshCw size={15} className={busy === c.id ? "animate-spin" : ""} />
                  </button>
                  <ConfirmDelete question={t("prov.confirmDelete")} disabled={busy === c.id} onConfirm={() => act(c.id, "delete")} />
                </span>
              </div>
              {edit?.id === c.id && (
                <form
                  className="pop-in mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEdit(c);
                  }}
                >
                  <input
                    autoFocus
                    maxLength={NAME_MAX}
                    aria-label={t("prov.name")}
                    placeholder={t("prov.name")}
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    className={inputCls}
                  />
                  <input
                    type="password"
                    autoComplete="off"
                    maxLength={KEY_MAX}
                    aria-label={t("prov.newKey")}
                    placeholder={t("prov.newKey")}
                    value={edit.key}
                    onChange={(e) => setEdit({ ...edit, key: e.target.value })}
                    className={inputCls}
                  />
                  <span className="flex gap-2">
                    <button className={`${btnCls} flex flex-1 items-center justify-center gap-2`} disabled={busy === c.id}>
                      {busy === c.id && <Loader2 size={14} className="animate-spin" />}
                      {t("common.save")}
                    </button>
                    <button type="button" className={btnGhostCls} onClick={() => setEdit(null)} aria-label={t("common.cancel")}>
                      <X size={14} />
                    </button>
                  </span>
                </form>
              )}
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
