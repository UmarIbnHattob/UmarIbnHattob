/**
 * Provayder ranglari (CSS o'zgaruvchilari, globals.css): har bir mavzu uchun alohida tanlangan
 * va rang-ko'rlik tekshiruvidan o'tgan qadamlar. Chat, grafik va logotip bir xil rangni ishlatadi.
 */
export const PROVIDERS = ["anthropic", "deepseek", "gemini"] as const;
export const PROVIDER_LABELS: Record<string, string> = { anthropic: "Claude", deepseek: "Deepseek", gemini: "Gemini" };
export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "var(--p-anthropic)",
  deepseek: "var(--p-deepseek)",
  gemini: "var(--p-gemini)",
};

export const colorOf = (provider?: string | null) => (provider && PROVIDER_COLORS[provider]) || "rgb(var(--n-400))";
