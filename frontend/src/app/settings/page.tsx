"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Boxes, Brain, Keyboard, KeyRound, Laptop, Shield, SlidersHorizontal, UserRound } from "lucide-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { ToastProvider } from "@/components/settings/ui";
import GeneralTab from "@/components/settings/GeneralTab";
import AiTab from "@/components/settings/AiTab";
import KeysTab from "@/components/settings/KeysTab";
import ProvidersTab from "@/components/settings/ProvidersTab";
import UsageTab from "@/components/settings/UsageTab";
import AccountTab from "@/components/settings/AccountTab";
import PrivacyTab from "@/components/settings/PrivacyTab";
import DesktopTab from "@/components/settings/DesktopTab";
import { ShortcutsList } from "@/components/Modals";

const TABS = [
  { id: "general", icon: SlidersHorizontal, label: "settings.tab.general", Comp: GeneralTab },
  { id: "ai", icon: Brain, label: "settings.tab.ai", Comp: AiTab },
  { id: "keys", icon: KeyRound, label: "settings.tab.keys", Comp: KeysTab },
  { id: "providers", icon: Boxes, label: "settings.tab.providers", Comp: ProvidersTab },
  { id: "usage", icon: BarChart3, label: "settings.tab.usage", Comp: UsageTab },
  { id: "account", icon: UserRound, label: "settings.tab.account", Comp: AccountTab },
  { id: "privacy", icon: Shield, label: "settings.tab.privacy", Comp: PrivacyTab },
  { id: "shortcuts", icon: Keyboard, label: "settings.tab.shortcuts", Comp: ShortcutsList },
  { id: "desktop", icon: Laptop, label: "settings.tab.desktop", Comp: DesktopTab },
] as const;

function SettingsInner() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = TABS.find((x) => x.id === params.get("tab")) ?? TABS[0];
  const idx = TABS.indexOf(active);
  useEffect(() => {
    document.title = `${t(active.label as TKey)} — OmniAI`;
  }, [active, t]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:flex-row md:p-8">
      <nav className="md:w-52 md:shrink-0">
        <h1 className="mb-4 text-2xl font-semibold">{t("settings.title")}</h1>
        <div className="relative flex gap-1 overflow-x-auto md:flex-col md:gap-0">
          {/* Faol bo'lim ko'rsatkichi: bo'limlar orasida silliq suriladi */}
          <span
            className="tab-indicator absolute left-0 top-0 hidden h-9 w-full rounded-md bg-neutral-800 md:block"
            style={{ transform: `translateY(${idx * 40}px)` }}
          />
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => router.replace(`${pathname}?tab=${tab.id}`, { scroll: false })}
              className={`relative z-10 flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-sm transition-colors md:mb-1 ${
                tab.id === active.id ? "bg-neutral-800 text-neutral-50 md:bg-transparent" : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              <tab.icon size={16} />
              {t(tab.label as TKey)}
            </button>
          ))}
        </div>
      </nav>
      <div key={active.id} className="min-w-0 flex-1 md:pt-12">
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
