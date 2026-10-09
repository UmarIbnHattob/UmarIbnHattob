"use client";

import { useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { btnDangerCls, btnGhostCls, Row, Section, useToast } from "@/components/settings/ui";

export default function PrivacyTab() {
  const { t } = useI18n();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <Section title={t("settings.tab.privacy")}>
        <Row label={t("privacy.export")} hint={t("privacy.exportHint")}>
          {/* Oddiy havola: brauzer cookie bilan yuklab oladi (fayl nomi serverdan keladi) */}
          <a href={`${API_URL}/me/export`} className={`${btnGhostCls} flex items-center gap-2`}>
            <Download size={15} /> JSON
          </a>
        </Row>
        <Row label={t("privacy.deleteChats")} hint={t("privacy.deleteChatsHint")}>
          {confirm ? (
            <span className="pop-in flex items-center gap-2">
              <span className="text-xs text-red-400">{t("privacy.deleteChatsConfirm")}</span>
              <button className={btnGhostCls} onClick={() => setConfirm(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
                onClick={async () => {
                  try {
                    await apiFetch("/conversations", { method: "DELETE" });
                    toast(t("privacy.deleted"));
                  } catch (e) {
                    toast((e as Error).message, false);
                  }
                  setConfirm(false);
                }}
              >
                {t("common.delete")}
              </button>
            </span>
          ) : (
            <button className={btnDangerCls} onClick={() => setConfirm(true)}>
              {t("privacy.deleteChats")}
            </button>
          )}
        </Row>
      </Section>
      <Section title={t("privacy.storage")}>
        <div className="flex gap-3 p-4 text-sm text-neutral-300">
          <ShieldCheck size={20} className="shrink-0 text-emerald-400" />
          <p>{t("privacy.storageText")}</p>
        </div>
      </Section>
    </>
  );
}
