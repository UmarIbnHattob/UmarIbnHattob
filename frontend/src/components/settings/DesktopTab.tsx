"use client";

import { Laptop, ShieldCheck } from "lucide-react";
import { getDesktop } from "@/lib/desktop";
import { useI18n } from "@/lib/i18n";
import { Row, Section } from "@/components/settings/ui";

export default function DesktopTab() {
  const { t } = useI18n();
  const d = getDesktop();
  return (
    <Section title={t("settings.tab.desktop")}>
      <div className="flex items-center gap-3 px-4 py-4">
        <span className="relative flex h-3 w-3">
          {d && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span className={`relative inline-flex h-3 w-3 rounded-full ${d ? "bg-emerald-400" : "bg-neutral-600"}`} />
        </span>
        <Laptop size={18} className="text-neutral-400" />
        <div>
          <div className="text-sm">{d ? t("desktop.connected") : t("desktop.notConnected")}</div>
          {!d && <div className="text-xs text-neutral-500">{t("desktop.notConnectedHint")}</div>}
        </div>
      </div>
      {d && (
        <>
          <Row label={t("desktop.version")}>
            <span className="font-mono text-sm text-neutral-300">v{d.version}</span>
          </Row>
          <Row label={t("desktop.platform")}>
            <span className="font-mono text-sm text-neutral-300">{d.platform}</span>
          </Row>
        </>
      )}
      <div className="flex gap-3 p-4 text-sm text-neutral-300">
        <ShieldCheck size={20} className="shrink-0 text-emerald-400" />
        <p>{t("desktop.safety")}</p>
      </div>
    </Section>
  );
}
