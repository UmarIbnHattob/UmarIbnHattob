"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Plus, Search, Sparkles } from "lucide-react";
import type { ModelInfo } from "@/lib/chatApi";
import { useI18n } from "@/lib/i18n";
import { colorOf } from "@/lib/providers";

const AUTO: ModelInfo = { id: "auto", label: "Auto", provider: "auto", vision: true, available: true, group: "auto" };

/**
 * Model tanlagich: qidiruv, guruhlar (o'rnatilgan / har bir provayder), "Auto" eng tepada.
 * Yuzlab model (OpenRouter) bo'lsa ham tez ishlaydi: faqat 200 tasi chiziladi, qolgani qidiruv bilan.
 */
export default function ModelSelector({
  models,
  value,
  onChange,
  withAuto = true,
  disabled,
  title,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
  withAuto?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const all = useMemo(() => (withAuto ? [AUTO, ...models.filter((m) => m.id !== "auto")] : models), [models, withAuto]);
  const current = all.find((m) => m.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all.filter((m) => !needle || m.label.toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle));
    const map = new Map<string, ModelInfo[]>();
    let shown = 0;
    for (const m of list) {
      if (shown >= 200) break;
      const g = m.id === "auto" ? "" : m.source === "custom" ? m.group || m.provider : t("model.builtin");
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(m);
      shown++;
    }
    return [...map.entries()];
  }, [all, q, t]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-full items-center gap-2 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm transition hover:border-neutral-500 disabled:opacity-60"
      >
        {value === "auto" ? (
          <Sparkles size={14} className="shrink-0 text-violet-400" />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(current?.provider) }} />
        )}
        <span className="truncate">{value === "auto" ? t("model.auto") : (current?.label ?? value)}</span>
        <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="pop-in absolute left-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl" style={{ transformOrigin: "top left" }}>
          <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
            <Search size={14} className="text-neutral-500" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("model.search")} className="w-full bg-transparent text-sm outline-none" />
            <span className="shrink-0 text-xs tabular-nums text-neutral-500">{all.length}</span>
          </div>
          <div className="max-h-80 overflow-auto p-1">
            {groups.map(([g, items]) => (
              <div key={g || "auto"}>
                {g && <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">{g}</div>}
                {items.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                      setQ("");
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-800 ${m.available === false ? "opacity-50" : ""}`}
                  >
                    {m.id === "auto" ? (
                      <Sparkles size={14} className="shrink-0 text-violet-400" />
                    ) : (
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(m.provider) }} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{m.id === "auto" ? t("model.auto") : m.label}</span>
                      {m.id === "auto" && <span className="block truncate text-[11px] text-neutral-500">{t("model.autoHint")}</span>}
                    </span>
                    {m.free && <span className="rounded bg-emerald-500/15 px-1.5 text-[10px] text-emerald-400">{t("model.free")}</span>}
                    {m.available === false && <span className="text-[10px] text-neutral-500">{t("model.noKey")}</span>}
                    {m.id === value && <Check size={14} className="text-violet-400" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <Link
            href="/settings?tab=providers"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2 text-xs text-violet-300 hover:bg-neutral-800"
          >
            <Plus size={13} /> {t("model.addMore")}
          </Link>
        </div>
      )}
    </div>
  );
}
