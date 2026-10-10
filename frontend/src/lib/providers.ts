/**
 * Provayder ranglari (CSS o'zgaruvchilari, globals.css): har bir mavzu uchun alohida tanlangan
 * va rang-ko'rlik tekshiruvidan o'tgan qadamlar. Chat, grafik va logotip bir xil rangni ishlatadi.
 */
import { translate, type Lang, type TKey } from "@/lib/i18n";

export const PROVIDERS = ["anthropic", "deepseek", "gemini"] as const;
export const PROVIDER_LABELS: Record<string, string> = { anthropic: "Claude", deepseek: "Deepseek", gemini: "Gemini" };
export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "var(--p-anthropic)",
  deepseek: "var(--p-deepseek)",
  gemini: "var(--p-gemini)",
};

export const colorOf = (provider?: string | null) => (provider && PROVIDER_COLORS[provider]) || "rgb(var(--n-400))";

/** Grafikdagi boshqa qatorlar (Whisper, OpenRouter, Groq…) uchun qo'shimcha ranglar (globals.css: --s-1…--s-5). */
const EXTRA_COLORS = ["var(--s-1)", "var(--s-2)", "var(--s-3)", "var(--s-4)", "var(--s-5)"];

/**
 * Har bir qatorga rang: o'rnatilgan provayderlar o'z rangida, qolganlari qo'shimcha ranglardan tartib bilan
 * (aylantirilmaydi: ular tugasa — betaraf kulrang). Rang har doim nom yonida (legenda, maslahat) ko'rsatiladi.
 */
export function seriesColors(keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  for (const k of keys) out[k] = PROVIDER_COLORS[k] ?? EXTRA_COLORS[i++] ?? "rgb(var(--n-500))";
  return out;
}

type T = (key: TKey, vars?: Record<string, string | number>) => string;

/** Son bilan so'z: "1 model / 2 models", "1 модель / 2 модели / 5 моделей". i18n da `<base>.one/.few/.many/.other` bor. */
export function plural(t: T, lang: Lang, base: "prov.modelsN" | "prov.freeN", n: number): string {
  let cat = "other";
  try {
    cat = new Intl.PluralRules(lang).select(n);
  } catch {
    /* e'tiborsiz */
  }
  if (cat !== "one" && cat !== "few" && cat !== "many") cat = "other";
  return t(`${base}.${cat}` as TKey, { n });
}

// Backend preset nomlari va izohlari o'zbekcha keladi: interfeysda tur (kind) bo'yicha tarjima qilinadi
const KIND_NAMES: Record<string, TKey> = { ollama: "prov.kind.ollama", lmstudio: "prov.kind.lmstudio", custom: "prov.kind.custom" };
const KIND_NOTES: Record<string, TKey> = {
  openrouter: "prov.note.openrouter", groq: "prov.note.groq", openai: "prov.note.openai", mistral: "prov.note.mistral",
  xai: "prov.note.xai", together: "prov.note.together", ollama: "prov.note.ollama", lmstudio: "prov.note.lmstudio",
  custom: "prov.note.custom",
};

/** Preset nomi va izohi joriy tilda (tarjimasi bo'lmasa — serverdagi matn). */
export const presetName = (t: T, kind: string, serverName: string) => (KIND_NAMES[kind] ? t(KIND_NAMES[kind]) : serverName);
export const presetNote = (t: T, kind: string, serverNote: string) => (KIND_NOTES[kind] ? t(KIND_NOTES[kind]) : serverNote);

/**
 * Ulangan provayder nomi: foydalanuvchi nom bermagan bo'lsa bazada preset nomi (o'zbekcha) saqlangan —
 * uni joriy tilga almashtiramiz; foydalanuvchi o'zi yozgan nom o'zgarishsiz qoladi.
 */
export function providerName(t: T, kind: string, name: string): string {
  const key = KIND_NAMES[kind];
  return key && name === translate("uz", key) ? t(key) : name;
}
