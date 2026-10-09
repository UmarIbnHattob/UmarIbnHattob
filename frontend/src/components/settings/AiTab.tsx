"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthGate";
import { apiFetch } from "@/lib/api";
import { LANGS, useI18n } from "@/lib/i18n";
import type { ModelInfo } from "@/lib/chatApi";
import { colorOf } from "@/lib/providers";
import { btnCls, inputCls, Row, Section, useToast } from "@/components/settings/ui";

const MAX = 3000;

export default function AiTab() {
  const { me, updateMe } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [text, setText] = useState(me.preferences.custom_instructions);
  useEffect(() => {
    apiFetch<ModelInfo[]>("/models").then(setModels).catch(() => {});
  }, []);

  const save = async (p: Parameters<typeof updateMe>[0]) => {
    try {
      await updateMe(p);
      toast(t("common.saved"));
    } catch (e) {
      toast((e as Error).message, false);
    }
  };
  const current = me.preferences.default_model ?? models[0]?.id ?? "";

  return (
    <>
      <Section title={t("settings.defaultModel")} desc={t("settings.defaultModelHint")}>
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => save({ preferences: { default_model: m.id } })}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${current === m.id ? "border-violet-500 bg-violet-500/10" : "border-neutral-800 hover:border-neutral-600"}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(m.provider) }} />
              <span className="flex-1">{m.label}</span>
              {m.vision && <span className="text-[10px] uppercase tracking-wide text-neutral-500">vision</span>}
            </button>
          ))}
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
          <textarea className={`${inputCls} min-h-36 resize-y`} value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} />
          <div className="mt-2 flex items-center justify-between">
            <span className={`text-xs tabular-nums ${text.length > MAX * 0.9 ? "text-amber-400" : "text-neutral-500"}`}>
              {text.length} / {MAX}
            </span>
            <button className={btnCls} disabled={text === me.preferences.custom_instructions} onClick={() => save({ preferences: { custom_instructions: text } })}>
              {t("common.save")}
            </button>
          </div>
        </div>
      </Section>
    </>
  );
}
