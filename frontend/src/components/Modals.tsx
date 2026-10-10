"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Globe, Laptop, Smartphone, Sparkles, X } from "lucide-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { getDesktop } from "@/lib/desktop";
import { useAuth } from "@/components/AuthGate";
import OrbitLogo from "@/components/OrbitLogo";

export type ModalId = "help" | "upgrade" | "apps" | "about" | "shortcuts";
export const APP_VERSION = "0.2.0";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Oyna qobig'i: ochilganda fokus oynaga o'tadi, Tab oyna ichida aylanadi, yopilganda fokus avvalgi joyiga qaytadi.
 * Esc va Ctrl+, (sozlamalarga o'tish) oynani yopadi.
 */
function Shell({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    // Capture bosqichida: oyna ochiq bo'lsa Esc faqat uni yopadi (orqadagi panel yoki ovoz yozuviga yetmaydi)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === ",") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      if (prev?.isConnected) prev.focus();
    };
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return e.preventDefault();
    const first = items[0], last = items[items.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || cur === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trap}
        onClick={(e) => e.stopPropagation()}
        className={`modal-in max-h-[85vh] w-full overflow-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl outline-none ${wide ? "max-w-3xl" : "max-w-lg"}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Help() {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(1); // birinchi savol ochiq
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="rounded-lg border border-neutral-800">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium"
          >
            {t(`help.q${i}` as TKey)}
            <ChevronDown size={16} className={`shrink-0 text-neutral-500 transition-transform ${open === i ? "rotate-180" : ""}`} />
          </button>
          <div className="accordion" data-open={open === i}>
            <div>
              <p className="px-4 pb-3 text-sm text-neutral-400">{t(`help.a${i}` as TKey)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Upgrade() {
  const { t } = useI18n();
  const { me } = useAuth();
  const plans = [
    { id: "free", title: t("upgrade.free"), desc: t("upgrade.freeDesc"), price: "0", features: ["upgrade.f.chat", "upgrade.f.agent", "upgrade.f.voice"] },
    { id: "byok", title: t("upgrade.byok"), desc: t("upgrade.byokDesc"), price: "API", features: ["upgrade.f.chat", "upgrade.f.agent", "upgrade.f.voice", "upgrade.f.unlimited"] },
    { id: "pro", title: t("upgrade.pro"), desc: t("upgrade.proDesc"), price: "—", features: ["upgrade.f.unlimited", "upgrade.f.priority", "upgrade.f.video"] },
  ] as const;
  return (
    <div className="stagger grid gap-4 md:grid-cols-3">
      {plans.map((p, i) => {
        const current = me.plan === p.id || (p.id === "free" && me.plan === "none");
        return (
          <div
            key={p.id}
            style={{ animationDelay: `${i * 70}ms` }}
            className={`flex flex-col rounded-xl border p-4 ${p.id === "pro" ? "glow-border border-transparent bg-neutral-950" : "border-neutral-800"}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{p.title}</h3>
              {current && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">{t("upgrade.current")}</span>}
              {p.id === "pro" && <Sparkles size={16} className="text-violet-300" />}
            </div>
            <p className="mt-1 min-h-10 text-xs text-neutral-400">{p.desc}</p>
            <ul className="mt-3 flex-1 space-y-1.5 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-400" /> {t(f as TKey)}
                </li>
              ))}
            </ul>
            {p.id === "pro" && (
              <button disabled className="mt-4 rounded-md bg-violet-600/60 py-2 text-sm text-white">
                {t("common.soon")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Apps() {
  const { t } = useI18n();
  const desktop = !!getDesktop();
  const rows = [
    { icon: Laptop, title: t("apps.desktop"), desc: t("apps.desktopDesc"), status: desktop ? t("apps.installed") : null },
    { icon: Globe, title: t("apps.web"), desc: t("apps.webDesc"), status: desktop ? null : t("apps.installed") },
    { icon: Smartphone, title: t("apps.mobile"), desc: "iOS, Android", status: t("common.soon") },
  ];
  return (
    <div className="stagger space-y-3">
      {rows.map((r, i) => (
        <div key={r.title} style={{ animationDelay: `${i * 60}ms` }} className="flex items-center gap-4 rounded-xl border border-neutral-800 p-4">
          <r.icon size={22} className="text-violet-300" />
          <div className="flex-1">
            <div className="font-medium">{r.title}</div>
            <div className="text-sm text-neutral-400">{r.desc}</div>
          </div>
          {r.status && <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{r.status}</span>}
        </div>
      ))}
      {!desktop && (
        <pre className="overflow-auto rounded-lg bg-neutral-950 p-3 text-xs text-neutral-300">{`cd desktop\nnpm install\nOMNIAI_URL=${typeof window !== "undefined" ? window.location.origin : ""} npm start`}</pre>
      )}
    </div>
  );
}

function About() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <OrbitLogo size={88} />
      <p className="text-neutral-300">{t("about.text")}</p>
      <p className="text-sm text-neutral-500">
        {t("about.version")} {APP_VERSION}
      </p>
    </div>
  );
}

/** Tezkor tugmalar. Yuborish tugmasi sozlamaga qarab: Enter yoki Ctrl+Enter. `plain` — tashqi ramkasiz (Section ichida). */
export function ShortcutsList({ plain }: { plain?: boolean }) {
  const { t } = useI18n();
  const { me } = useAuth();
  const mod = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl";
  const rows: [string[], TKey][] = [
    ...(me.preferences.send_with_enter
      ? ([
          [["Enter"], "shortcuts.send"],
          [["Shift", "Enter"], "shortcuts.newline"],
        ] as [string[], TKey][])
      : ([
          [[mod, "Enter"], "shortcuts.send"],
          [["Enter"], "shortcuts.newline"],
        ] as [string[], TKey][])),
    [[mod, "Shift", "O"], "shortcuts.newChat"],
    [[mod, ","], "shortcuts.settings"],
    [[mod, "Shift", "L"], "shortcuts.toggleTheme"],
    [[mod, "/"], "shortcuts.list"],
    [["Esc"], "shortcuts.cancelVoice"],
  ];
  const list = rows.map(([keys, label]) => (
    <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
      <span className="text-neutral-300">{t(label)}</span>
      <span className="flex shrink-0 gap-1">
        {keys.map((k) => (
          <kbd key={k} className="min-w-6 rounded-md border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-center font-mono text-xs shadow-[0_2px_0_rgb(var(--n-700))]">
            {k}
          </kbd>
        ))}
      </span>
    </div>
  ));
  return plain ? <>{list}</> : <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">{list}</div>;
}

export default function Modals({ open, onClose }: { open: ModalId | null; onClose: () => void }) {
  const { t } = useI18n();
  if (!open) return null;
  const map: Record<ModalId, { title: string; body: React.ReactNode; wide?: boolean }> = {
    help: { title: t("help.title"), body: <Help /> },
    upgrade: { title: t("upgrade.title"), body: <Upgrade />, wide: true },
    apps: { title: t("apps.title"), body: <Apps /> },
    about: { title: t("about.title"), body: <About /> },
    shortcuts: { title: t("menu.shortcuts"), body: <ShortcutsList /> },
  };
  const m = map[open];
  return (
    <Shell title={m.title} onClose={onClose} wide={m.wide}>
      {m.body}
    </Shell>
  );
}

