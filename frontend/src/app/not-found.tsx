"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** 404: noma'lum manzil — ilova ichida, joriy tilda, chatga qaytish havolasi bilan. */
export default function NotFound() {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${t("notFound.title")} — OmniAI`;
  }, [t]);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="msg-in max-w-md text-center">
        <p className="bg-gradient-to-br from-violet-400 to-blue-500 bg-clip-text text-7xl font-bold tabular-nums text-transparent">404</p>
        <h1 className="mt-4 text-xl font-semibold">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm text-neutral-400">{t("notFound.text")}</p>
        <Link
          href="/chat"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm text-white transition hover:bg-violet-500"
        >
          <MessageSquare size={16} /> {t("notFound.back")}
        </Link>
      </div>
    </div>
  );
}
