"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Plus, Search, Sparkles } from "lucide-react";
import type { ModelInfo } from "@/lib/chatApi";
import { useI18n } from "@/lib/i18n";
import { colorOf, providerName } from "@/lib/providers";

/** /api/models elementi: `unavailable_reason` — nega ishlatib bo'lmaydi (kalit yo'q yoki bepul limit tugagan). */
export type PickerModel = ModelInfo & { platform?: boolean; unavailable_reason?: "no_key" | "quota" | null };

const AUTO: PickerModel = { id: "auto", label: "Auto", provider: "auto", vision: true, available: true, group: "auto" };
/** Bir vaqtda chiziladigan eng ko'p model soni (qolgani qidiruv bilan topiladi). */
const MAX_SHOWN = 200;

/**
 * Model tanlagich: qidiruv, guruhlar (o'rnatilgan / har bir provayder), "Auto" eng tepada.
 * Klaviatura: ↑/↓ — tanlash, Enter — tasdiqlash, Esc — yopish. Yuzlab model (OpenRouter) bo'lsa ham tez ishlaydi:
 * faqat 200 tasi chiziladi va bu haqda pastda yoziladi.
 */
export default function ModelSelector({
  models,
  value,
  onChange,
  withAuto = true,
  disabled,
  title,
}: {
  models: PickerModel[];
  value: string;
  onChange: (id: string) => void;
  withAuto?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const optId = (i: number) => `${listId}-o${i}`;
  const all = useMemo(() => (withAuto ? [AUTO, ...models.filter((m) => m.id !== "auto")] : models), [models, withAuto]);
  const current = all.find((m) => m.id === value);

  // Guruh: Auto (sarlavhasiz) / o'rnatilgan / har bir ulangan provayder (id bo'yicha — nomi bir xil bo'lsa ham aralashmaydi)
  const groupOf = useMemo(() => {
    const names = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const m of all) {
      const key = m.id === "auto" ? "" : m.source === "custom" ? m.id.split(":").slice(0, 2).join(":") : "builtin";
      if (names.has(key)) continue;
      let name = key === "" ? "" : key === "builtin" ? t("model.builtin") : providerName(t, m.provider, m.group || m.provider);
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      if (n > 1) name = `${name} (${n})`;
      names.set(key, name);
    }
    return (m: PickerModel) => {
      const key = m.id === "auto" ? "" : m.source === "custom" ? m.id.split(":").slice(0, 2).join(":") : "builtin";
      return { key, name: names.get(key) ?? "" };
    };
  }, [all, t]);

  const { visible, matches, groups } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const found = all.filter(
      (m) =>
        !needle ||
        (m.id === "auto" ? t("model.auto") : m.label).toLowerCase().includes(needle) ||
        m.id.toLowerCase().includes(needle) ||
        groupOf(m).name.toLowerCase().includes(needle),
    );
    const visible = found.slice(0, MAX_SHOWN);
    const groups: { key: string; name: string; items: { m: PickerModel; i: number }[] }[] = [];
    visible.forEach((m, i) => {
      const g = groupOf(m);
      let last = groups[groups.length - 1];
      if (!last || last.key !== g.key) groups.push((last = { ...g, items: [] }));
      last.items.push({ m, i });
    });
    return { visible, matches: found.length, groups };
  }, [all, q, t, groupOf]);

  // Ochilganda joriy model belgilanadi; qidiruv o'zgarsa — birinchi natija (onChange da darhol, effekt orqali emas:
  // yozib darhol Enter bosilsa eski indeks filtrlangan ro'yxatda boshqa bandni tanlab qo'ymasin)
  useEffect(() => {
    if (open) setActive(Math.max(0, visible.findIndex((m) => m.id === value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
      setQ("");
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
    triggerRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const n = visible.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = visible[Math.min(active, n - 1)];
      if (item) choose(item.id);
    } else if (e.key === "Escape") {
      // Faqat tanlagich yopiladi (ovoz yozish kabi boshqa Esc ishlovchilariga yetib bormaydi)
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQ("");
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
      setQ("");
    }
  };

  const reasonText = (m: PickerModel) => (m.unavailable_reason === "quota" ? t("model.quota") : t("model.noKey"));
  const reasonHint = (m: PickerModel) => (m.unavailable_reason === "quota" ? t("model.quotaHint") : t("model.noKeyHint"));

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setOpen((o) => !o);
          setQ("");
        }}
        className="flex max-w-full items-center gap-2 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm transition hover:border-neutral-500 disabled:opacity-60"
      >
        {value === "auto" ? (
          <Sparkles size={14} className="shrink-0 text-violet-400" />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(current?.provider) }} />
        )}
        <span className="truncate">{value === "auto" ? t("model.auto") : (current?.label ?? value)}</span>
        {current?.available === false && (
          <span title={reasonHint(current)} className="shrink-0 rounded border border-neutral-700 px-1.5 text-[10px] text-neutral-300">
            {reasonText(current)}
          </span>
        )}
        <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="pop-in absolute left-0 top-full z-40 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl"
          style={{ transformOrigin: "top left" }}
        >
          <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
            <Search size={14} className="shrink-0 text-neutral-500" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={visible.length ? optId(active) : undefined}
              aria-label={t("model.search")}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder={t("model.search")}
              className="w-full bg-transparent text-sm outline-none"
            />
            <span className="shrink-0 text-xs tabular-nums text-neutral-500">{q.trim() ? `${matches} / ${all.length}` : all.length}</span>
          </div>
          <div id={listId} role="listbox" aria-label={t("model.search")} className="max-h-80 overflow-auto p-1">
            {groups.map((g) => (
              <div key={g.key || "auto"} role="group" aria-label={g.name || t("model.auto")}>
                {g.name && (
                  <div role="presentation" className="truncate px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                    {g.name}
                  </div>
                )}
                {g.items.map(({ m, i }) => {
                  const off = m.available === false;
                  return (
                    <div
                      key={m.id}
                      id={optId(i)}
                      role="option"
                      aria-selected={i === active}
                      title={off ? reasonHint(m) : undefined}
                      onMouseDown={(e) => e.preventDefault()} // fokus qidiruv maydonida qoladi
                      onMouseMove={() => i !== active && setActive(i)}
                      onClick={() => choose(m.id)}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${i === active ? "bg-neutral-800" : ""}`}
                    >
                      {m.id === "auto" ? (
                        <Sparkles size={14} className="shrink-0 text-violet-400" />
                      ) : (
                        <span className={`h-2 w-2 shrink-0 rounded-full ${off ? "opacity-40" : ""}`} style={{ background: colorOf(m.provider) }} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate ${off ? "text-neutral-400" : ""}`}>{m.id === "auto" ? t("model.auto") : m.label}</span>
                        {m.id === "auto" && <span className="block text-[11px] leading-snug text-neutral-400">{t("model.autoHint")}</span>}
                      </span>
                      {m.free && <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 text-[10px] font-medium text-emerald-400">{t("model.free")}</span>}
                      {off && <span className="shrink-0 rounded border border-neutral-700 px-1.5 text-[10px] text-neutral-300">{reasonText(m)}</span>}
                      {m.id === value && <Check size={14} className="shrink-0 text-violet-400" />}
                    </div>
                  );
                })}
              </div>
            ))}
            {!visible.length && <div className="px-3 py-6 text-center text-sm text-neutral-400">{t("model.noResults")}</div>}
          </div>
          {matches > visible.length && (
            <div className="border-t border-neutral-800 px-3 py-1.5 text-[11px] text-neutral-400">
              {t("model.capped", { shown: visible.length, total: matches })}
            </div>
          )}
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
