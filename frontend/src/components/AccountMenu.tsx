"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpCircle,
  BarChart3,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  Globe,
  HelpCircle,
  Info,
  KeyRound,
  Keyboard,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Shield,
  Sun,
} from "lucide-react";
import { useAuth } from "@/components/AuthGate";
import { LANGS, useI18n } from "@/lib/i18n";
import { API_KEY_LINKS, initials, type Preferences } from "@/lib/me";

type Sub = "language" | "learn" | "keys" | "theme" | null;

/** Chap pastdagi hisob tugmasi va undan ochiladigan menyu (Anthropic uslubida). */
export default function AccountMenu() {
  const { me, updateMe, logout, openModal } = useAuth();
  const { t, lang } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<Sub>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (fn: () => void) => () => {
    setOpen(false);
    setSub(null);
    fn();
  };
  const mod = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl";
  const planLabel = t(me.plan === "byok" ? "plan.byok" : me.plan === "free" ? "plan.free" : "plan.none");
  const themes: { id: Preferences["theme"]; icon: typeof Sun; label: string }[] = [
    { id: "system", icon: Monitor, label: t("theme.system") },
    { id: "light", icon: Sun, label: t("theme.light") },
    { id: "dark", icon: Moon, label: t("theme.dark") },
  ];

  const Item = ({ icon: Icon, label, right, onClick, subId }: { icon: typeof Sun; label: string; right?: React.ReactNode; onClick?: () => void; subId?: Sub }) => (
    <button
      onClick={onClick}
      onMouseEnter={() => setSub(subId ?? null)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800 ${sub && sub === subId ? "bg-neutral-800" : ""}`}
    >
      <Icon size={17} className="shrink-0 text-neutral-400" />
      <span className="flex-1">{label}</span>
      {right}
      {subId && <ChevronRight size={15} className="text-neutral-500" />}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="pop-in absolute bottom-full left-0 z-40 mb-2 w-72 rounded-xl border border-neutral-800 bg-neutral-900 p-1.5 shadow-2xl">
          <div className="truncate px-3 pb-1.5 pt-1 text-xs text-neutral-500">{me.email}</div>
          <div className="stagger">
            <Item icon={Settings} label={t("menu.settings")} right={<kbd className="text-xs text-neutral-500">{mod}+,</kbd>} onClick={go(() => router.push("/settings"))} />
            <Item icon={BarChart3} label={t("menu.usage")} onClick={go(() => router.push("/settings?tab=usage"))} />
            <Item icon={sunOrMoon(me.preferences.theme)} label={t("menu.theme")} subId="theme" />
            <Item icon={Globe} label={t("menu.language")} subId="language" right={<span className="text-xs text-neutral-500">{lang.toUpperCase()}</span>} />
            <Item icon={HelpCircle} label={t("menu.help")} onClick={go(() => openModal("help"))} />
            <div className="my-1 h-px bg-neutral-800" />
            <Item icon={ArrowUpCircle} label={t("menu.upgrade")} onClick={go(() => openModal("upgrade"))} />
            <Item icon={LayoutGrid} label={t("menu.apps")} onClick={go(() => openModal("apps"))} />
            <Item icon={Info} label={t("menu.learn")} subId="learn" />
            <div className="my-1 h-px bg-neutral-800" />
            <Item icon={KeyRound} label={t("menu.apiKeys")} subId="keys" />
            <Item icon={LogOut} label={t("menu.logout")} onClick={go(logout)} />
          </div>

          {sub && (
            <div
              key={sub}
              onMouseLeave={() => setSub(null)}
              className="slide-in-right absolute bottom-0 left-full ml-2 w-64 rounded-xl border border-neutral-800 bg-neutral-900 p-1.5 shadow-2xl"
            >
              {sub === "theme" &&
                themes.map(({ id, icon: Icon, label }) => (
                  <button key={id} onClick={go(() => updateMe({ preferences: { theme: id } }))} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-neutral-800">
                    <Icon size={16} className="text-neutral-400" />
                    <span className="flex-1 text-left">{label}</span>
                    {me.preferences.theme === id && <span className="h-2 w-2 rounded-full bg-violet-400" />}
                  </button>
                ))}
              {sub === "language" &&
                LANGS.map((l) => (
                  <button key={l.id} onClick={go(() => updateMe({ preferences: { language: l.id } }))} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-neutral-800">
                    <span>{l.flag}</span>
                    <span className="flex-1 text-left">{l.label}</span>
                    {lang === l.id && <span className="h-2 w-2 rounded-full bg-violet-400" />}
                  </button>
                ))}
              {sub === "learn" &&
                (
                  [
                    [Info, "menu.about", () => openModal("about")],
                    [Keyboard, "menu.shortcuts", () => openModal("shortcuts")],
                    [Shield, "menu.privacy", () => router.push("/settings?tab=privacy")],
                  ] as const
                ).map(([Icon, key, fn]) => (
                  <button key={key} onClick={go(fn)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-neutral-800">
                    <Icon size={16} className="text-neutral-400" />
                    <span className="flex-1 text-left">{t(key)}</span>
                  </button>
                ))}
              {sub === "keys" &&
                Object.values(API_KEY_LINKS).map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-neutral-800">
                    <span className="flex-1">{l.label}</span>
                    <ExternalLink size={14} className="text-neutral-500" />
                  </a>
                ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => {
          setOpen((o) => !o);
          setSub(null);
        }}
        aria-label="account"
        className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-neutral-900 ${open ? "bg-neutral-900" : ""}`}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-inner"
          style={{ background: `linear-gradient(135deg, ${me.preferences.avatar_color}, ${me.preferences.avatar_color}99)` }}
        >
          {initials(me)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-neutral-100">{me.display_name || me.email.split("@")[0]}</span>
          <span className="block text-xs text-neutral-500">{planLabel}</span>
        </span>
        <ChevronsUpDown size={15} className="text-neutral-500" />
      </button>
    </div>
  );
}

function sunOrMoon(theme: Preferences["theme"]) {
  return theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
}
