"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Image as ImageIcon, Settings } from "lucide-react";

const links = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/media", label: "Media Studio", icon: ImageIcon },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Chap tomondagi asosiy navigatsiya paneli. */
export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 flex-col gap-1 border-r border-neutral-800 bg-neutral-950 p-3">
      <div className="mb-4 px-2 text-lg font-semibold">OmniAI Workspace</div>
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
    </aside>
  );
}
