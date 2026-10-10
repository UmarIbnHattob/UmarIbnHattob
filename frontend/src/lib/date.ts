/**
 * Sanalarni interfeys tilida yozish.
 * Chromium (va Electron) ICU ma'lumotlarida o'zbekcha oy nomlari yo'q: toLocaleDateString("uz-Latn") "2026 M10 10"
 * qaytaradi. Shuning uchun o'zbekcha sanani o'zimiz yig'amiz (CLDR shakli: "10-oktabr, 2026", "10-okt").
 */
import type { Lang } from "@/lib/i18n";

const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const UZ_MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];

/**
 * long  — "10-oktabr, 2026" / "October 10, 2026" / "10 октября 2026 г."
 * short — "10-okt" / "Oct 10" / "10 окт."
 * month — "oktabr, 2026" / "October 2026" / "октябрь 2026 г."
 */
export type DateStyle = "long" | "short" | "month";

const OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  long: { day: "numeric", month: "long", year: "numeric" },
  short: { day: "numeric", month: "short" },
  month: { month: "long", year: "numeric" },
};

/** Sana obyekti yoki ISO satr ("2026-10-10", "2026-10-10T08:00:00Z", "2026-10"). Faqat sana bo'lsa — mahalliy kun. */
function toDate(d: Date | string): Date {
  if (d instanceof Date) return d;
  if (/^\d{4}-\d{2}$/.test(d)) return new Date(`${d}-01T00:00:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T00:00:00`);
  return new Date(d);
}

export function formatDate(value: Date | string, lang: Lang, style: DateStyle = "long"): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  if (lang === "uz") {
    const day = d.getDate(), m = d.getMonth(), y = d.getFullYear();
    if (style === "short") return `${day}-${UZ_MONTHS_SHORT[m]}`;
    if (style === "month") return `${UZ_MONTHS[m]}, ${y}`;
    return `${day}-${UZ_MONTHS[m]}, ${y}`;
  }
  return d.toLocaleDateString(lang, OPTIONS[style]);
}
