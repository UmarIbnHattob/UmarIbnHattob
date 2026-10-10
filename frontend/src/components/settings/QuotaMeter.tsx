"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n";

type Usage = { month: string; used: number; limit: number; platform_providers: string[] };

/** Platforma kaliti bilan bepul oylik limit (faqat platforma kaliti sozlangan bo'lsa ko'rinadi). */
export default function QuotaMeter() {
  const { t, lang } = useI18n();
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    apiFetch<Usage>("/usage").then(setU).catch(() => {});
  }, []);
  if (!u || !u.platform_providers.length) return null;
  const pct = Math.min(100, (u.used / Math.max(1, u.limit)) * 100);
  return (
    <div className="msg-in mb-8 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{t("settings.quota")}</span>
        <span className="tabular-nums text-neutral-400">
          {u.used} / {u.limit} {t("settings.requests")} · {formatDate(u.month, lang, "month")}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800" role="meter" aria-label={t("settings.quota")} aria-valuenow={u.used} aria-valuemin={0} aria-valuemax={u.limit}>
        <div className={`h-full rounded-full transition-all duration-1000 ${pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-violet-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-neutral-400">{t("settings.quotaHint")}</p>
    </div>
  );
}
