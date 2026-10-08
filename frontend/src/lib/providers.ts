/** Provayder ranglari: orbitalar, "o'ylayapti" belgisi va model almashinuvi animatsiyasi uchun. */
export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#e07a5f",
  deepseek: "#4d6bfe",
  gemini: "#a78bfa",
};

export const colorOf = (provider?: string | null) => (provider && PROVIDER_COLORS[provider]) || "#a3a3a3";
