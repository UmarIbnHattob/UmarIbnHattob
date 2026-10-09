"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useAuth } from "@/components/AuthGate";
import { LANGS, useI18n } from "@/lib/i18n";
import { initials, type Preferences } from "@/lib/me";
import { inputCls, Row, Section, Segmented, Toggle, useToast } from "@/components/settings/ui";

const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#db2777", "#475569"];

/** Mavzu tanlash kartochkasi: ichida kichik "ilova" ko'rinishi. */
function ThemeCard({ id, active, onClick, label }: { id: Preferences["theme"]; active: boolean; onClick: () => void; label: string }) {
  const Icon = id === "light" ? Sun : id === "dark" ? Moon : Monitor;
  const pane = (light: boolean) => (
    <div className={`flex h-full flex-1 gap-1 p-1.5 ${light ? "bg-[#f6f6f7]" : "bg-[#171717]"}`}>
      <div className={`w-1/4 rounded-sm ${light ? "bg-white" : "bg-[#0a0a0a]"}`} />
      <div className="flex flex-1 flex-col gap-1">
        <div className={`h-2 w-3/4 rounded-sm ${light ? "bg-[#e5e5e5]" : "bg-[#262626]"}`} />
        <div className="ml-auto h-2 w-1/2 rounded-sm bg-[#2a78d6]" />
        <div className={`h-2 w-2/3 rounded-sm ${light ? "bg-[#e5e5e5]" : "bg-[#262626]"}`} />
      </div>
    </div>
  );
  return (
    <button onClick={onClick} className={`group w-36 rounded-xl border-2 p-1.5 text-left transition ${active ? "border-violet-500" : "border-neutral-800 hover:border-neutral-600"}`}>
      <div className="flex h-20 overflow-hidden rounded-lg transition-transform duration-300 group-hover:scale-[1.03]">
        {id === "system" ? (
          <>
            {pane(true)}
            {pane(false)}
          </>
        ) : (
          pane(id === "light")
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 px-1 text-sm">
        <Icon size={14} className="text-neutral-400" /> {label}
      </div>
    </button>
  );
}

export default function GeneralTab() {
  const { me, updateMe } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(me.display_name ?? "");
  const [nick, setNick] = useState(me.nickname ?? "");
  useEffect(() => {
    setName(me.display_name ?? "");
    setNick(me.nickname ?? "");
  }, [me.display_name, me.nickname]);

  const save = async (patch: Parameters<typeof updateMe>[0]) => {
    try {
      await updateMe(patch);
      toast(t("common.saved"));
    } catch (e) {
      toast((e as Error).message, false);
    }
  };
  const pref = (p: Partial<Preferences>) => save({ preferences: p });

  return (
    <>
      <Section title={t("settings.profile")}>
        <div className="flex items-center gap-4 px-4 py-4">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white shadow-lg transition-all duration-500"
            style={{ background: `linear-gradient(135deg, ${me.preferences.avatar_color}, ${me.preferences.avatar_color}99)` }}
          >
            {initials({ display_name: name || null, email: me.email })}
          </span>
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-neutral-400">
              {t("settings.fullName")}
              <input
                className={`${inputCls} mt-1`}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name !== (me.display_name ?? "") && save({ display_name: name })}
              />
            </label>
            <label className="text-xs text-neutral-400">
              {t("settings.nickname")}
              <input
                className={`${inputCls} mt-1`}
                value={nick}
                maxLength={60}
                placeholder="Umar"
                onChange={(e) => setNick(e.target.value)}
                onBlur={() => nick !== (me.nickname ?? "") && save({ nickname: nick })}
              />
            </label>
          </div>
        </div>
        <p className="px-4 pb-3 text-xs text-neutral-500">{t("settings.nicknameHint")}</p>
        <Row label={t("settings.avatarColor")}>
          <div className="flex gap-1.5">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                aria-label={c}
                onClick={() => pref({ avatar_color: c })}
                className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${me.preferences.avatar_color === c ? "ring-2 ring-neutral-50 ring-offset-2 ring-offset-neutral-900" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Row>
      </Section>

      <Section title={t("settings.appearance")}>
        <div className="flex flex-wrap gap-3 px-4 py-4">
          {(["system", "light", "dark"] as const).map((id) => (
            <ThemeCard key={id} id={id} label={t(`theme.${id}`)} active={me.preferences.theme === id} onClick={() => pref({ theme: id })} />
          ))}
        </div>
        <Row label={t("settings.fontSize")}>
          <Segmented
            value={me.preferences.font_size}
            onChange={(v) => pref({ font_size: v })}
            options={[
              { id: "sm", label: <span className="text-xs">{t("settings.font.sm")}</span> },
              { id: "md", label: t("settings.font.md") },
              { id: "lg", label: <span className="text-base">{t("settings.font.lg")}</span> },
            ]}
          />
        </Row>
        <Row label={t("settings.language")}>
          <Segmented value={me.preferences.language} onChange={(v) => pref({ language: v })} options={LANGS.map((l) => ({ id: l.id, label: `${l.flag} ${l.label}` }))} />
        </Row>
        <Row label={t("settings.sendWithEnter")}>
          <Toggle checked={me.preferences.send_with_enter} onChange={(v) => pref({ send_with_enter: v })} label={t("settings.sendWithEnter")} />
        </Row>
      </Section>
    </>
  );
}
