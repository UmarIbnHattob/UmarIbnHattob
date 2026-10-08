"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, MessageSquare, Image as ImageIcon, Settings } from "lucide-react";
import { useAuth } from "@/components/AuthGate";
import OrbitLogo from "@/components/OrbitLogo";

const links = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/media", label: "Media Studio", icon: ImageIcon },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Chap tomondagi asosiy navigatsiya paneli. */
export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-neutral-800 bg-neutral-950 p-3">
      <div className="mb-4 flex items-center gap-2 px-2 text-lg font-semibold">
        <OrbitLogo size={26} />
        OmniAI
      </div>
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
            pathname.startsWith(href)
              ? "bg-neutral-800 text-white"
              : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
          }`}
        >
          <Icon size={16} />
          {label}
        </Link>
      ))}
      <div className="mt-auto border-t border-neutral-800 pt-3">
        <div className="truncate px-2 text-xs text-neutral-500" title={user.email}>
          {user.email}
        </div>
        <button
          onClick={logout}
          className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-900 hover:text-white"
        >
          <LogOut size={16} /> Chiqish
        </button>
      </div>
    </aside>
  );
}
