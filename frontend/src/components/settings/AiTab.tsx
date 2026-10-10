"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/components/AuthGate";
import ModelSelector, { type PickerModel } from "@/components/ModelSelector";
import { apiFetch } from "@/lib/api";
import { LANGS, useI18n } from "@/lib/i18n";
import { btnCls, inputCls, Row, Section, useToast } from "@/components/settings/ui";

const MAX = 3000;

export default function AiTab() {
  const { me, updateMe } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [models, setModels] = useState<PickerModel[]>([]);
  const [text, setText] = useState(me.preferences.custom_instructions);
  useEffect(() => {
    apiFetch<PickerModel[]>("/models").then(setModels).catch(() => {});
  }, []);

  const save = async (p: Parameters<typeof updateMe>[0]) => {
    try {
      await updateMe(p);
      toast(t("common.saved"));
    } catch (e) {
      toast((e as Error).message, false);
    }
  };

  // Shaxsiy ko'rsatmalar: maydondan chiqilganda (boshqa bo'limga o'tganda ham) avtomatik saqlanadi,
  // sahifa yopilayotganda/yangilanayotganda saqlanmagan matn bo'lsa brauzer ogohlantiradi
  const saved = me.preferences.custom_instructions;
  const dirty = text !== saved;
  const latest = useRef({ text, dirty, save });
  latest.current = { text, dirty, save };
  const saveText = () => {
    if (dirty) save({ preferences: { custom_instructions: text } });
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!latest.current.dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      const l = latest.current;
      if (l.dirty) l.save({ preferences: { custom_instructions: l.text } });
    };
  }, []);

  // Standart model: tanlanmagan (null) bo'lsa chat Auto bilan ochiladi — shu yerda ham Auto belgilanadi
  const value = me.preferences.default_model ?? "auto";
  const current = models.find((m) => m.id === value);
  const pick = (id: string) => {
    const next = id === "auto" ? null : id;
    if (next !== me.preferences.default_model) save({ preferences: { default_model: next } });
  };

  return (
    <>
      <Section title={t("settings.defaultModel")} desc={t("settings.defaultModelHint")}>
        <div className="p-4">
          <ModelSelector models={models} value={value} onChange={pick} />
          {current?.available === false && (
            <p className="mt-3 flex items-start gap-2 text-xs text-amber-400">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <span>
                {current.unavailable_reason === "quota" ? t("model.quotaHint") : t("model.noKeyHint")}{" "}
                <Link href="/settings?tab=keys" className="underline">
                  {t("settings.tab.keys")}
                </Link>
              </span>
            </p>
          )}
        </div>
      </Section>
      <Section title={t("settings.responseLanguage")}>
        <Row label={t("settings.responseLanguage")}>
          <select
            className={inputCls}
            value={me.preferences.response_language}
            onChange={(e) => save({ preferences: { response_language: e.target.value as "auto" } })}
          >
            <option value="auto">{t("settings.lang.auto")}</option>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.flag} {l.label}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <Section title={t("settings.instructions")} desc={t("settings.instructionsHint")}>
        <div className="p-4">
          <textarea
            className={`${inputCls} min-h-36 resize-y`}
            value={text}
            maxLength={MAX}
            aria-label={t("settings.instructions")}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs tabular-nums ${text.length > MAX * 0.9 ? "text-amber-400" : "text-neutral-500"}`}>
              {text.length} / {MAX}
            </span>
            <span className="ml-auto flex items-center gap-3">
              {dirty && <span className="text-xs text-neutral-500">{t("settings.unsaved")}</span>}
              <button className={btnCls} disabled={!dirty} onClick={saveText}>
                {t("common.save")}
              </button>
            </span>
          </div>
        </div>
      </Section>
    </>
  );
}
