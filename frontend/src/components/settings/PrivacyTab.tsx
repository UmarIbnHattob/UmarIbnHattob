"use client";

import { useState } from "react";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { API_URL, apiFetch, networkErrorText } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { btnDangerCls, btnGhostCls, Row, Section, useToast } from "@/components/settings/ui";

export default function PrivacyTab() {
  const { t } = useI18n();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);

  /**
   * Eksport fetch + Blob orqali: sessiya tugagan bo'lsa sahifa xom JSON ga o'tib ketmaydi —
   * xabar ko'rsatiladi va kirish sahifasiga o'tiladi.
   */
  async function exportData() {
    setBusy("export");
    try {
      let res: Response;
      try {
        res = await fetch(`${API_URL}/me/export`, { credentials: "include", cache: "no-store" });
      } catch {
        throw new Error(networkErrorText());
      }
      if (res.status === 401) {
        toast(t("privacy.sessionExpired"), false);
        setTimeout(() => window.dispatchEvent(new Event("auth-expired")), 1500);
        return;
      }
      if (!res.ok) throw new Error(t("err.server", { n: res.status }));
      const blob = await res.blob();
      const name =
        /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `omniai-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(t("privacy.exported"));
    } catch (e) {
      toast((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Section title={t("settings.tab.privacy")}>
        <Row label={t("privacy.export")} hint={t("privacy.exportHint")}>
          <button type="button" onClick={exportData} disabled={busy === "export"} className={`${btnGhostCls} flex items-center gap-2`}>
            {busy === "export" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} JSON
          </button>
        </Row>
        <Row label={t("privacy.deleteChats")} hint={t("privacy.deleteChatsHint")}>
          {confirm ? (
            <span className="pop-in flex flex-wrap items-center gap-2">
              <span className="text-xs text-red-400">{t("privacy.deleteChatsConfirm")}</span>
              <button className={btnGhostCls} onClick={() => setConfirm(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500 disabled:opacity-50"
                disabled={busy === "delete"}
                onClick={async () => {
                  setBusy("delete");
                  try {
                    await apiFetch("/conversations", { method: "DELETE" });
                    toast(t("privacy.deleted"));
                  } catch (e) {
                    toast((e as Error).message, false);
                  }
                  setBusy(null);
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
