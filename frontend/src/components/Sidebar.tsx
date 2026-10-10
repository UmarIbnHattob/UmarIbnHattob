"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Image as ImageIcon, Menu, MessageSquare, Settings, X } from "lucide-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { useDrawer } from "@/hooks/useDrawer";
import OrbitLogo from "@/components/OrbitLogo";
import AccountMenu from "@/components/AccountMenu";

const links: { href: string; label: TKey; icon: typeof Bot }[] = [
  { href: "/chat", label: "nav.chat", icon: MessageSquare },
  { href: "/agent", label: "nav.agent", icon: Bot },
  { href: "/media", label: "nav.media", icon: ImageIcon },
  { href: "/settings", label: "nav.settings", icon: Settings },
];

/**
 * Chap tomondagi asosiy navigatsiya paneli.
 * Telefon/kichik ekranda (md dan tor) u yashiringan: yuqoridagi ingichka satrdagi tugma uni chapdan ochadi.
 */
export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  useDrawer(open, () => setOpen(false), asideRef, menuBtnRef, "(min-width: 768px)");
  // Boshqa sahifaga o'tilganda panel yopiladi
  useEffect(() => setOpen(false), [pathname]);
  const current = links.find(({ href }) => pathname.startsWith(href));

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-2 md:hidden">
        <button
          ref={menuBtnRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("nav.openMenu")}
          aria-expanded={open}
          aria-controls="app-sidebar"
          className="rounded-md p-2 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50"
        >
          <Menu size={20} />
        </button>
        <OrbitLogo size={22} />
        <span className="font-semibold">OmniAI</span>
        {current && <span className="min-w-0 truncate text-sm text-neutral-400">· {t(current.label)}</span>}
      </header>

      {open && <div className="backdrop-in fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside
        id="app-sidebar"
        ref={asideRef}
        aria-label={t("nav.menu")}
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        className={`fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col gap-1 border-r border-neutral-800 bg-neutral-950 p-3 transition-[transform,visibility] duration-200 md:visible md:static md:z-auto md:w-56 md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none ${
          open ? "translate-x-0 shadow-2xl" : "invisible -translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center gap-2 px-2 text-lg font-semibold">
          <OrbitLogo size={26} />
          OmniAI
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("common.close")}
            className="ml-auto rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50 md:hidden"
          >
            <X size={18} />
          </button>
        </div>
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
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
    </>
  );
}
