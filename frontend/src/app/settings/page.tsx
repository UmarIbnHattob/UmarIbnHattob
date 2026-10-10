"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Brain, Keyboard, KeyRound, Laptop, Shield, SlidersHorizontal, UserRound } from "lucide-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { Section, ToastProvider } from "@/components/settings/ui";
import GeneralTab from "@/components/settings/GeneralTab";
import AiTab from "@/components/settings/AiTab";
import KeysTab from "@/components/settings/KeysTab";
import UsageTab from "@/components/settings/UsageTab";
import AccountTab from "@/components/settings/AccountTab";
import PrivacyTab from "@/components/settings/PrivacyTab";
import DesktopTab from "@/components/settings/DesktopTab";
import { ShortcutsList } from "@/components/Modals";

/** Tezkor tugmalar bo'limi: boshqa bo'limlar kabi sarlavha bilan. */
function ShortcutsTab() {
  const { t } = useI18n();
  return (
    <Section title={t("settings.tab.shortcuts")}>
      <ShortcutsList plain />
    </Section>
  );
}

const TABS = [
  { id: "general", icon: SlidersHorizontal, label: "settings.tab.general", Comp: GeneralTab },
  { id: "ai", icon: Brain, label: "settings.tab.ai", Comp: AiTab },
  { id: "keys", icon: KeyRound, label: "settings.tab.keys", Comp: KeysTab },
  { id: "usage", icon: BarChart3, label: "settings.tab.usage", Comp: UsageTab },
  { id: "account", icon: UserRound, label: "settings.tab.account", Comp: AccountTab },
  { id: "privacy", icon: Shield, label: "settings.tab.privacy", Comp: PrivacyTab },
  { id: "shortcuts", icon: Keyboard, label: "settings.tab.shortcuts", Comp: ShortcutsTab },
  { id: "desktop", icon: Laptop, label: "settings.tab.desktop", Comp: DesktopTab },
] as const;

/** "?tab=providers" bilan kelinganda "Boshqa provayderlar" sarlavhasigacha necha ms davomida kuzatamiz. */
const PROVIDERS_SCROLL_MS = 3000;

function SettingsInner() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // "providers" eski havola: endi barcha provayderlar "API kalitlar" bo'limida
  const wantProviders = params.get("tab") === "providers";
  const asked = wantProviders ? "keys" : params.get("tab");
  const active = TABS.find((x) => x.id === asked) ?? TABS[0];
  const navRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stripScrolled = useRef(false);
  const [ind, setInd] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    document.title = `${t(active.label as TKey)} — OmniAI`;
  }, [active, t]);

  // "?tab=providers": sarlavha ustidagi ma'lumotlar (limit, kalitlar) yuklanib sahifa siljisa, qayta to'g'rilaymiz.
  // ~3 soniyadan keyin yoki foydalanuvchi o'zi aylantira boshlasa — to'xtaymiz.
  useEffect(() => {
    const box = contentRef.current;
    if (!wantProviders || !box) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scroll = () => document.getElementById("providers")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(scroll, 150);
    };
    const ro = new ResizeObserver(schedule);
    const userEvents = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    const stop = () => {
      clearTimeout(timer);
      clearTimeout(limit);
      ro.disconnect();
      userEvents.forEach((ev) => window.removeEventListener(ev, stop));
    };
    const limit = setTimeout(stop, PROVIDERS_SCROLL_MS);
    ro.observe(box);
    schedule();
    userEvents.forEach((ev) => window.addEventListener(ev, stop, { passive: true }));
    return stop;
  }, [wantProviders]);

  // Ko'rsatkich faol tugmaning HAQIQIY joyiga qo'yiladi (shrift o'lchami/til o'zgarsa ham siljimaydi)
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = () => {
      const btn = nav.querySelector<HTMLElement>(`[data-tab="${active.id}"]`);
      if (!btn) return;
      const a = btn.getBoundingClientRect(), b = nav.getBoundingClientRect();
      setInd({ top: a.top - b.top, height: a.height });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [active.id]);

  // Kichik ekranda bo'limlar gorizontal tasma: faol bo'lim ko'rinadigan joyga suriladi (sahifa o'zi siljimaydi)
  useEffect(() => {
    const nav = navRef.current;
    const btn = nav?.querySelector<HTMLElement>(`[data-tab="${active.id}"]`);
    if (!nav || !btn || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: btn.offsetLeft - (nav.clientWidth - btn.offsetWidth) / 2, behavior: stripScrolled.current ? "smooth" : "auto" });
    stripScrolled.current = true;
  }, [active.id]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:p-8">
      <nav className="min-w-0 lg:w-52 lg:shrink-0">
        <h1 className="mb-4 text-2xl font-semibold">{t("settings.title")}</h1>
        <div ref={navRef} className="relative -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
          {/* Faol bo'lim ko'rsatkichi: bo'limlar orasida silliq suriladi */}
          {ind && (
            <span
              aria-hidden
              className="tab-indicator absolute left-0 top-0 hidden w-full rounded-md bg-neutral-800 lg:block"
              style={{ transform: `translateY(${ind.top}px)`, height: ind.height }}
            />
          )}
          {TABS.map((tab) => (
            <button
              key={tab.id}
              data-tab={tab.id}
              aria-current={tab.id === active.id ? "page" : undefined}
              onClick={() => router.replace(`${pathname}?tab=${tab.id}`, { scroll: false })}
              className={`relative z-10 flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-500/60 ${
                tab.id === active.id ? "bg-neutral-800 text-neutral-50 lg:bg-transparent" : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              <tab.icon size={16} />
              {t(tab.label as TKey)}
            </button>
          ))}
        </div>
      </nav>
      <div ref={contentRef} key={active.id} className="min-w-0 flex-1 lg:pt-12">
        <active.Comp />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <ToastProvider>
      <Suspense>
        <SettingsInner />
      </Suspense>
    </ToastProvider>
  );
}
