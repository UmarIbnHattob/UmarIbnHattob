"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useI18n, type TKey } from "@/lib/i18n";
import { colorOf, PROVIDER_LABELS, PROVIDERS } from "@/lib/providers";
import { Section } from "@/components/settings/ui";
import QuotaMeter from "@/components/settings/QuotaMeter";

type Stats = {
  days: string[];
  series: Record<string, Record<string, number>>;
  by_model: { model: string; count: number }[];
  by_kind: Record<string, number>;
};

const CHART_H = 160;

/**
 * Kunlik so'rovlar: provayderlar bo'yicha ustma-ust ustunlar.
 * Rang-ko'rlik uchun: legenda + jami raqamlar + jadval (modellar bo'yicha) har doim ko'rinadi;
 * har bir ustunga sichqoncha olib borilsa, aniq sonlar chiqadi.
 */
function DailyChart({ stats }: { stats: Stats }) {
  const { lang } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const totals = stats.days.map((d) => PROVIDERS.reduce((s, p) => s + (stats.series[d]?.[p] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(d + "T00:00:00").toLocaleDateString(lang === "uz" ? "uz-Latn" : lang, opts);

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
          return (
            <div key={d} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
              {/* Segmentlar orasida 2px fon rangidagi bo'shliq; yuqori uchi yumaloq */}
              <div className="flex flex-col-reverse gap-[2px]">
                {PROVIDERS.filter((p) => day[p]).map((p, k, arr) => (
                  <div
                    key={p}
                    className={`origin-bottom transition-[height,opacity] duration-700 ${k === arr.length - 1 ? "rounded-t-[4px]" : ""} ${hover !== null && hover !== i ? "opacity-40" : ""}`}
                    style={{ height: ((day[p] ?? 0) / niceMax) * CHART_H, background: colorOf(p), animation: `grow-bar .7s ${i * 30}ms cubic-bezier(.2,.9,.3,1) both` }}
                  />
                ))}
              </div>
              {hover === i && (
                <div
                  className={`pop-in pointer-events-none absolute bottom-full z-10 mb-2 w-36 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-xs shadow-xl ${
                    i >= stats.days.length - 3 ? "right-0" : i <= 1 ? "left-0" : "left-1/2 -translate-x-1/2"
                  }`}
                >
                  <div className="mb-1 font-medium text-neutral-200">{fmt(d, { day: "numeric", month: "short" })}</div>
                  {PROVIDERS.map((p) => (
                    <div key={p} className="flex items-center gap-1.5 text-neutral-300">
                      <span className="h-2 w-2 rounded-sm" style={{ background: colorOf(p) }} />
                      <span className="flex-1">{PROVIDER_LABELS[p]}</span>
                      <span className="tabular-nums">{day[p] ?? 0}</span>
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
          <div key={d} className="flex-1 text-center text-[10px] text-neutral-500">
            {i % 2 === 0 || i === stats.days.length - 1 ? fmt(d, { day: "numeric" }) : ""}
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
  if (!stats) return <p className="text-sm text-neutral-500">{t("common.loading")}</p>;

  const perProvider = Object.fromEntries(
    PROVIDERS.map((p) => [p, stats.days.reduce((s, d) => s + (stats.series[d]?.[p] ?? 0), 0)]),
  );
  const total = Object.values(perProvider).reduce((a, b) => a + b, 0);

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
          {PROVIDERS.map((p) => (
            <div key={p} className="flex items-center gap-1.5 text-sm text-neutral-300">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(p) }} />
              {PROVIDER_LABELS[p]} <span className="tabular-nums text-neutral-500">{perProvider[p]}</span>
            </div>
          ))}
        </div>
        {total ? <DailyChart stats={stats} /> : <p className="px-4 py-8 text-center text-sm text-neutral-500">{t("usage.empty")}</p>}
      </Section>
      {total > 0 && (
        <div className="grid gap-x-6 md:grid-cols-2">
          <Section title={t("usage.byModel")}>
            {stats.by_model.map((m) => (
              <div key={m.model} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1 truncate font-mono text-xs text-neutral-300">{m.model}</span>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-800">
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
