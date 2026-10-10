"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/date";
import { useI18n, type TKey } from "@/lib/i18n";
import { PROVIDER_LABELS, PROVIDERS, seriesColors } from "@/lib/providers";
import { Section } from "@/components/settings/ui";
import QuotaMeter from "@/components/settings/QuotaMeter";

type Stats = {
  days: string[];
  series: Record<string, Record<string, number>>;
  by_model: { model: string; count: number }[];
  by_kind: Record<string, number>;
  // Yangi server maydonlari: qatorlar (ko'pidan kamiga), ularning nomlari va umumiy son (custom provayderlar, Whisper ham)
  providers?: string[];
  labels?: Record<string, string>;
  total?: number;
};

type Series = { keys: string[]; label: (k: string) => string; color: Record<string, string>; perKey: Record<string, number> };

const CHART_H = 160;

/**
 * Kunlik so'rovlar: provayderlar bo'yicha ustma-ust ustunlar.
 * Rang-ko'rlik uchun: legenda + jami raqamlar + jadval (modellar bo'yicha) har doim ko'rinadi;
 * har bir ustunga sichqoncha olib borilsa, aniq sonlar chiqadi.
 */
function DailyChart({ stats, s }: { stats: Stats; s: Series }) {
  const { lang } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const totals = stats.days.map((d) => s.keys.reduce((sum, k) => sum + (stats.series[d]?.[k] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;

  return (
    <div className="relative px-4 pb-3 pt-6">
      {/* Panjara: yengil, faqat 0 / yarmi / maksimum */}
      <div className="absolute inset-x-4 top-6" style={{ height: CHART_H }}>
        {[1, 0.5, 0].map((f) => (
          <div key={f} className="absolute inset-x-0 flex items-center gap-2" style={{ top: `${(1 - f) * 100}%` }}>
            <span className="w-6 -translate-y-1/2 text-right text-[10px] tabular-nums text-neutral-500">{Math.round(niceMax * f)}</span>
            <div className={`h-px flex-1 -translate-y-1/2 ${f === 0 ? "bg-neutral-700" : "bg-neutral-800/70"}`} />
          </div>
        ))}
      </div>
      <div className="relative ml-8 flex items-end gap-1.5" style={{ height: CHART_H }} onMouseLeave={() => setHover(null)}>
        {stats.days.map((d, i) => {
          const day = stats.series[d] ?? {};
          // Maslahatda: shu kuni ishlatilganlar (qatorlar ko'p bo'lsa nollar yashiriladi)
          const rows = s.keys.length > 4 ? s.keys.filter((k) => day[k]) : s.keys;
          return (
            <div key={d} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
              {/* Segmentlar orasida 2px fon rangidagi bo'shliq; yuqori uchi yumaloq */}
              <div className="flex flex-col-reverse gap-[2px]">
                {s.keys
                  .filter((k) => day[k])
                  .map((k, j, arr) => (
                    <div
                      key={k}
                      className={`origin-bottom transition-[height,opacity] duration-700 ${j === arr.length - 1 ? "rounded-t-[4px]" : ""} ${hover !== null && hover !== i ? "opacity-40" : ""}`}
                      style={{ height: ((day[k] ?? 0) / niceMax) * CHART_H, background: s.color[k], animation: `grow-bar .7s ${i * 30}ms cubic-bezier(.2,.9,.3,1) both` }}
                    />
                  ))}
              </div>
              {hover === i && (
                <div
                  className={`pop-in pointer-events-none absolute bottom-full z-10 mb-2 w-max min-w-36 max-w-[14rem] rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-xs shadow-xl ${
                    i >= stats.days.length - 3 ? "right-0" : i <= 1 ? "left-0" : "left-1/2 -translate-x-1/2"
                  }`}
                >
                  <div className="mb-1 font-medium text-neutral-200">{formatDate(d, lang, "short")}</div>
                  {rows.map((k) => (
                    <div key={k} className="flex items-center gap-1.5 text-neutral-300">
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color[k] }} />
                      <span className="min-w-0 flex-1 truncate">{s.label(k)}</span>
                      <span className="tabular-nums">{day[k] ?? 0}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="ml-8 mt-1.5 flex gap-1.5">
        {stats.days.map((d, i) => (
          <div key={d} className="flex-1 text-center text-[10px] tabular-nums text-neutral-500">
            {i % 2 === 0 || i === stats.days.length - 1 ? Number(d.slice(8, 10)) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UsageTab() {
  const { t } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    apiFetch<Stats>("/usage/stats?days=14").then(setStats).catch(() => {});
  }, []);

  // Qatorlar serverdan (`providers`); eski server bo'lsa — kunlik ma'lumotdagi barcha kalitlar
  const s = useMemo<Series | null>(() => {
    if (!stats) return null;
    const perKey: Record<string, number> = {};
    for (const d of stats.days) for (const [k, n] of Object.entries(stats.series[d] ?? {})) perKey[k] = (perKey[k] ?? 0) + n;
    const keys = stats.providers?.length
      ? stats.providers
      : [...PROVIDERS, ...Object.keys(perKey).filter((k) => !(PROVIDERS as readonly string[]).includes(k)).sort((a, b) => perKey[b] - perKey[a])];
    const label = (k: string) => stats.labels?.[k] ?? PROVIDER_LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
    return { keys, label, color: seriesColors(keys), perKey };
  }, [stats]);

  if (!stats || !s) return <p className="text-sm text-neutral-500">{t("common.loading")}</p>;
  const total = stats.total ?? Object.values(s.perKey).reduce((a, b) => a + b, 0);

  return (
    <>
      <QuotaMeter />
      <Section title={t("usage.last14")}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-4 pt-4">
          <div>
            <div className="text-3xl font-semibold tabular-nums">{total}</div>
            <div className="text-xs text-neutral-500">{t("usage.total")}</div>
          </div>
          {/* Legenda: rang yonida nom va son — rang yolg'iz o'zi ma'lumot tashimaydi */}
          {s.keys.map((k) => (
            <div key={k} className="flex items-center gap-1.5 text-sm text-neutral-300">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color[k] }} />
              {s.label(k)} <span className="tabular-nums text-neutral-500">{s.perKey[k] ?? 0}</span>
            </div>
          ))}
        </div>
        {total ? <DailyChart stats={stats} s={s} /> : <p className="px-4 py-8 text-center text-sm text-neutral-500">{t("usage.empty")}</p>}
      </Section>
      {total > 0 && (
        <div className="grid gap-x-6 md:grid-cols-2">
          <Section title={t("usage.byModel")}>
            {stats.by_model.map((m) => (
              <div key={m.model} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span title={m.model} className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-300">
                  {m.model}
                </span>
                <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-neutral-800">
                  <div className="h-full rounded-full bg-neutral-400" style={{ width: `${(m.count / stats.by_model[0].count) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums text-neutral-400">{m.count}</span>
              </div>
            ))}
          </Section>
          <Section title={t("usage.byKind")}>
            {Object.entries(stats.by_kind).map(([k, n]) => (
              <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-neutral-300">{t(`usage.kind.${k}` as TKey)}</span>
                <span className="tabular-nums text-neutral-400">{n}</span>
              </div>
            ))}
          </Section>
        </div>
      )}
    </>
  );
}
