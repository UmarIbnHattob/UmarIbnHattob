"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/date";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/components/AuthGate";
import { btnCls, btnDangerCls, btnGhostCls, inputCls, Row, Section, useToast } from "@/components/settings/ui";

export default function AccountTab() {
  const { me, refreshMe } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delPass, setDelPass] = useState("");

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, false);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title={t("settings.tab.account")}>
        <Row label={t("account.email")}>
          <span className="break-all text-sm text-neutral-300">{me.email}</span>
        </Row>
        <Row label={t("account.since")}>
          <span className="text-sm text-neutral-300">{formatDate(me.created_at, lang, "long")}</span>
        </Row>
      </Section>

      <Section title={t("account.password")}>
        <form
          className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(
              () => apiFetch("/me/password", { method: "POST", body: JSON.stringify({ current_password: cur, new_password: next }) }),
              t("account.passwordChanged"),
            );
            if (ok) {
              setCur("");
              setNext("");
            }
          }}
        >
          <input type="password" autoComplete="current-password" required placeholder={t("account.currentPassword")} className={inputCls} value={cur} onChange={(e) => setCur(e.target.value)} />
          <input type="password" autoComplete="new-password" required minLength={8} placeholder={t("account.newPassword")} className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} />
          <button className={`${btnCls} sm:col-span-2 sm:justify-self-end xl:col-span-1`} disabled={busy}>
            {t("common.save")}
          </button>
        </form>
      </Section>

      <Section title={t("account.sessions")}>
        <Row label={t("account.logoutAll")} hint={t("account.logoutAllHint")}>
          <button className={btnGhostCls} disabled={busy} onClick={() => run(async () => {
            await apiFetch("/me/logout-all", { method: "POST" });
            await refreshMe();
          })}>
            {t("account.logoutAll")}
          </button>
        </Row>
      </Section>

      <Section title={t("account.danger")}>
        <Row label={t("account.delete")} hint={t("account.deleteHint")}>
          {!confirmDelete && (
            <button className={btnDangerCls} onClick={() => setConfirmDelete(true)}>
              {t("account.delete")}
            </button>
          )}
        </Row>
        {confirmDelete && (
          <form
            className="pop-in flex flex-wrap gap-2 bg-red-500/5 p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await run(async () => {
                await apiFetch("/me", { method: "DELETE", body: JSON.stringify({ password: delPass }) });
                await refreshMe();
              });
            }}
          >
            <input type="password" required autoFocus placeholder={t("account.deleteConfirm")} className={`${inputCls} flex-1`} value={delPass} onChange={(e) => setDelPass(e.target.value)} />
            <button type="button" className={btnGhostCls} onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </button>
            <button className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-500 disabled:opacity-50" disabled={busy || !delPass}>
              {t("common.delete")}
            </button>
          </form>
        )}
      </Section>
    </>
  );
}
