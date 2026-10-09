"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Image as ImageIcon, MessageSquare, Settings } from "lucide-react";
import { useI18n, type TKey } from "@/lib/i18n";
import OrbitLogo from "@/components/OrbitLogo";
import AccountMenu from "@/components/AccountMenu";

const links: { href: string; label: TKey; icon: typeof Bot }[] = [
  { href: "/chat", label: "nav.chat", icon: MessageSquare },
  { href: "/agent", label: "nav.agent", icon: Bot },
  { href: "/media", label: "nav.media", icon: ImageIcon },
  { href: "/settings", label: "nav.settings", icon: Settings },
];

/** Chap tomondagi asosiy navigatsiya paneli. */
export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-neutral-800 bg-neutral-950 p-3">
      <div className="mb-4 flex items-center gap-2 px-2 text-lg font-semibold">
        <OrbitLogo size={26} />
        OmniAI
      </div>
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
              active ? "bg-neutral-800 text-neutral-50" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-50"
            }`}
          >
            {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-violet-400" />}
            <Icon size={16} />
            {t(label)}
          </Link>
        );
      })}
      <div className="mt-auto border-t border-neutral-800 pt-2">
        <AccountMenu />
      </div>
    </aside>
  );
}
