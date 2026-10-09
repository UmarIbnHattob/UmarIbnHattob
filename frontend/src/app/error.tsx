"use client";

import { useI18n } from "@/lib/i18n";

/** Kutilmagan xato sahifani butunlay buzib qo'ymasligi uchun umumiy chegara. */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">{t("error.title")}</h1>
      <p className="mt-2 text-sm text-neutral-400">{t("error.text")}</p>
      <button onClick={reset} className="mt-4 rounded-md bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-500">
        {t("error.retry")}
      </button>
    </div>
  );
}
