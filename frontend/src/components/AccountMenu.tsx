"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { LANGS, useI18n, type TKey } from "@/lib/i18n";
import { API_KEY_LINKS, initials, type Preferences } from "@/lib/me";

type Sub = "language" | "learn" | "keys" | "theme" | null;
const SUB_LABEL: Record<Exclude<Sub, null>, TKey> = { theme: "menu.theme", language: "menu.language", learn: "menu.learn", keys: "menu.apiKeys" };

const SUB_W = 256; // yon menyu kengligi (w-64)
const itemCls = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-neutral-200 outline-none transition-colors hover:bg-neutral-800 focus-visible:bg-neutral-800";

/** Fokusni ro'yxat ichidagi keyingi/oldingi bandga o'tkazadi (↑/↓, Home/End). */
function moveFocus(container: HTMLElement | null, e: React.KeyboardEvent) {
  if (!container || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return false;
  // Faqat shu ro'yxatning o'z bandlari (ichki yon menyu bandlari emas)
  const items = [...container.querySelectorAll<HTMLElement>("[data-mi]")].filter((el) => el.closest("[role=menu]") === container);
  if (!items.length) return false;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[i < 0 && e.key === "ArrowUp" ? items.length - 1 : next]?.focus();
  return true;
}

/**
 * Menyu bandi. Komponent tashqarida e'lon qilingan: hover holati o'zgarganda bandlar qayta yaratilmaydi
 * (aks holda ro'yxat har safar miltillab, animatsiyasi qaytadan boshlanadi).
 */
function MenuItem({
  icon: Icon,
  label,
  right,
  onClick,
  subId,
  sub,
  onHoverSub,
  onOpenSub,
}: {
  icon: typeof Sun;
  label: string;
  right?: React.ReactNode;
  onClick?: () => void;
  subId?: Exclude<Sub, null>;
  sub: Sub;
  onHoverSub: (s: Sub) => void;
  onOpenSub: (s: Exclude<Sub, null>, focus: boolean) => void;
}) {
  const expanded = !!subId && sub === subId;
  return (
    <button
      type="button"
      role="menuitem"
      data-mi=""
      data-sub={subId}
      aria-haspopup={subId ? "menu" : undefined}
      aria-expanded={subId ? expanded : undefined}
      // Sichqoncha bilan ustiga kelganda yon menyu ochiladi; barmoq bilan bosilganda — onClick
      onPointerEnter={(e) => e.pointerType === "mouse" && onHoverSub(subId ?? null)}
      onClick={(e) => (subId ? onOpenSub(subId, e.detail === 0) : onClick?.())}
      onKeyDown={(e) => {
        if (subId && e.key === "ArrowRight") {
          e.preventDefault();
          onOpenSub(subId, true);
        }
      }}
      className={`${itemCls} ${expanded ? "bg-neutral-800" : ""}`}
    >
      <Icon size={17} className="shrink-0 text-neutral-400" />
      <span className="flex-1">{label}</span>
      {right}
      {subId && <ChevronRight size={15} className="text-neutral-500" />}
    </button>
  );
}

/** Chap pastdagi hisob tugmasi va undan ochiladigan menyu (Anthropic uslubida). */
export default function AccountMenu() {
  const { me, updateMe, logout, openModal } = useAuth();
  const { t, lang } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<Sub>(null);
  const [inline, setInline] = useState(false); // tor ekranda yon menyu band ostida ochiladi
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const focusFirst = useRef<"menu" | "sub" | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // Capture bosqichida va preventDefault bilan: Esc faqat menyuni yopadi (telefondagi chap panel ochiq qoladi)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Fokus yon menyuda bo'lsa — uning o'z ishlovchisi (subKeys) faqat yon menyuni yopadi
      if (subRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Yon menyu ekranga sig'adimi? Sig'masa (telefon) — band ostida ochiladi. Menyu ochilganda bir marta o'lchanadi.
  useLayoutEffect(() => {
    if (open && panelRef.current) setInline(panelRef.current.getBoundingClientRect().right + 8 + SUB_W > window.innerWidth);
  }, [open]);

  // Klaviatura bilan ochilganda fokus menyuning (yoki yon menyuning) birinchi bandiga o'tadi
  useEffect(() => {
    const target = focusFirst.current === "sub" ? subRef.current : focusFirst.current === "menu" ? listRef.current : null;
    if (!target) return;
    focusFirst.current = null;
    target.querySelector<HTMLElement>("[data-mi]")?.focus();
  }, [open, sub]);

  const go = (fn: () => void) => () => {
    setOpen(false);
    setSub(null);
    btnRef.current?.focus(); // oyna yopilganda fokus shu tugmaga qaytadi
    fn();
  };
  const openSub = (s: Exclude<Sub, null>, focus: boolean) => {
    if (focus) focusFirst.current = "sub";
    setSub(s);
  };
  const closeSub = () => {
    const parent = listRef.current?.querySelector<HTMLElement>(`[data-sub="${sub}"]`);
    setSub(null);
    parent?.focus();
  };
  const mod = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl";
  const planLabel = t(me.plan === "byok" ? "plan.byok" : me.plan === "free" ? "plan.free" : "plan.none");
  const themes: { id: Preferences["theme"]; icon: typeof Sun; label: string }[] = [
    { id: "system", icon: Monitor, label: t("theme.system") },
    { id: "light", icon: Sun, label: t("theme.light") },
    { id: "dark", icon: Moon, label: t("theme.dark") },
  ];
  const item = { sub, onHoverSub: setSub, onOpenSub: openSub };

  const subItems = () => (
    <>
      {sub === "theme" &&
        themes.map(({ id, icon: Icon, label }) => (
          <button key={id} type="button" role="menuitemradio" aria-checked={me.preferences.theme === id} data-mi="" onClick={go(() => updateMe({ preferences: { theme: id } }))} className={itemCls}>
            <Icon size={16} className="text-neutral-400" />
            <span className="flex-1">{label}</span>
            {me.preferences.theme === id && <span className="h-2 w-2 rounded-full bg-violet-400" />}
          </button>
        ))}
      {sub === "language" &&
        LANGS.map((l) => (
          <button key={l.id} type="button" role="menuitemradio" aria-checked={lang === l.id} data-mi="" onClick={go(() => updateMe({ preferences: { language: l.id } }))} className={itemCls}>
            <span>{l.flag}</span>
            <span className="flex-1">{l.label}</span>
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
          <button key={key} type="button" role="menuitem" data-mi="" onClick={go(fn)} className={itemCls}>
            <Icon size={16} className="text-neutral-400" />
            <span className="flex-1">{t(key)}</span>
          </button>
        ))}
      {sub === "keys" &&
        Object.values(API_KEY_LINKS).map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" role="menuitem" data-mi="" onClick={() => setOpen(false)} className={itemCls}>
            <span className="flex-1">{l.label}</span>
            <ExternalLink size={14} className="text-neutral-500" />
          </a>
        ))}
    </>
  );
  const subKeys = (e: React.KeyboardEvent) => {
    if (moveFocus(subRef.current, e)) return;
    if (e.key === "ArrowLeft" || e.key === "Escape") {
      // Faqat yon menyu yopiladi, asosiy menyu ochiq qoladi
      e.preventDefault();
      e.stopPropagation();
      closeSub();
    }
  };
  const subPanel = (side: boolean) => (
    <div
      key={sub}
      ref={subRef}
      role="menu"
      aria-label={sub ? t(SUB_LABEL[sub]) : undefined}
      onKeyDown={subKeys}
      onMouseLeave={side ? () => setSub(null) : undefined}
      className={
        side
          ? "slide-in-right absolute bottom-0 left-full ml-2 w-64 rounded-xl border border-neutral-800 bg-neutral-900 p-1.5 shadow-2xl"
          : "pop-in mb-1 ml-5 border-l border-neutral-800 pl-1.5"
      }
    >
      {subItems()}
    </div>
  );
  // Asosiy bandlar; tor ekranda ochilgan yon menyu o'z bandining ostida chiziladi
  const withSub = (s: Exclude<Sub, null>, node: React.ReactNode) => (
    <div key={s}>
      {node}
      {inline && sub === s && subPanel(false)}
    </div>
  );

  return (
    <div
      ref={ref}
      className="relative"
      // Tab bilan menyudan chiqilsa — yopiladi
      onBlur={(e) => open && e.relatedTarget && !ref.current?.contains(e.relatedTarget as Node) && setOpen(false)}
    >
      <button
        ref={btnRef}
        onClick={(e) => {
          if (!open && e.detail === 0) focusFirst.current = "menu";
          setOpen((o) => !o);
          setSub(null);
        }}
        aria-label={t("menu.account")}
        aria-haspopup="menu"
        aria-expanded={open}
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

      {open && (
        <div ref={panelRef} className="pop-in absolute bottom-full left-0 z-40 mb-2 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-neutral-800 bg-neutral-900 p-1.5 shadow-2xl">
          <div className="truncate px-3 pb-1.5 pt-1 text-xs text-neutral-500">{me.email}</div>
          <div
            ref={listRef}
            role="menu"
            aria-label={t("menu.account")}
            onKeyDown={(e) => moveFocus(listRef.current, e)}
            className="stagger max-h-[calc(100vh-7rem)] overflow-y-auto"
          >
            <MenuItem {...item} icon={Settings} label={t("menu.settings")} right={<kbd className="text-xs text-neutral-500">{mod}+,</kbd>} onClick={go(() => router.push("/settings"))} />
            <MenuItem {...item} icon={BarChart3} label={t("menu.usage")} onClick={go(() => router.push("/settings?tab=usage"))} />
            {withSub("theme", <MenuItem {...item} icon={sunOrMoon(me.preferences.theme)} label={t("menu.theme")} subId="theme" />)}
            {withSub("language", <MenuItem {...item} icon={Globe} label={t("menu.language")} subId="language" right={<span className="text-xs text-neutral-500">{lang.toUpperCase()}</span>} />)}
            <MenuItem {...item} icon={HelpCircle} label={t("menu.help")} onClick={go(() => openModal("help"))} />
            <div role="separator" className="my-1 h-px bg-neutral-800" />
            <MenuItem {...item} icon={ArrowUpCircle} label={t("menu.upgrade")} onClick={go(() => openModal("upgrade"))} />
            <MenuItem {...item} icon={LayoutGrid} label={t("menu.apps")} onClick={go(() => openModal("apps"))} />
            {withSub("learn", <MenuItem {...item} icon={Info} label={t("menu.learn")} subId="learn" />)}
            <div role="separator" className="my-1 h-px bg-neutral-800" />
            {withSub("keys", <MenuItem {...item} icon={KeyRound} label={t("menu.apiKeys")} subId="keys" />)}
            <MenuItem {...item} icon={LogOut} label={t("menu.logout")} onClick={go(logout)} />
          </div>
          {sub && !inline && subPanel(true)}
        </div>
      )}
    </div>
  );
}

function sunOrMoon(theme: Preferences["theme"]) {
  return theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
}
