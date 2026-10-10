"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** Matnni buferga yozadi. Xavfsiz kontekst bo'lmasa (masalan, http) eski usul bilan. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** "Nusxa olish" tugmasi: bosilgach ~1.5 s "Nusxa olindi" ko'rinadi. `text` — matn yoki uni qaytaruvchi funksiya. */
export default function CopyButton({
  text,
  label,
  className = "",
  showLabel = false,
}: {
  text: string | (() => string);
  label: string;
  className?: string;
  showLabel?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const current = copied ? t("chat.copied") : label;
  return (
    <button
      type="button"
      onClick={async () => {
        if (!(await copyText(typeof text === "function" ? text() : text))) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={current}
      title={current}
      className={`flex items-center gap-1 rounded transition-colors ${className}`}
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
      {showLabel && <span>{current}</span>}
      {/* Ekran o'quvchilar uchun: "Nusxa olindi" e'lon qilinadi */}
      <span className="sr-only" aria-live="polite">
        {copied ? t("chat.copied") : ""}
      </span>
    </button>
  );
}
