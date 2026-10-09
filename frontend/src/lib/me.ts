/** Profil va sozlamalar API'si. */
import { API_URL, apiFetch } from "@/lib/api";
import type { Lang } from "@/lib/i18n";

export type Provider = "anthropic" | "deepseek" | "gemini";
export type Preferences = {
  theme: "system" | "light" | "dark";
  language: Lang;
  response_language: "auto" | Lang;
  default_model: string | null;
  custom_instructions: string;
  font_size: "sm" | "md" | "lg";
  send_with_enter: boolean;
  avatar_color: string;
};
export type Me = {
  id: string;
  email: string;
  display_name: string | null;
  nickname: string | null;
  preferences: Preferences;
  created_at: string;
  own_keys: Provider[];
  platform_providers: Provider[];
  plan: "byok" | "free" | "none";
};
export type MePatch = { display_name?: string | null; nickname?: string | null; preferences?: Partial<Preferences> };

/** Kirmagan bo'lsa null (401 hodisasini yubormaydi). */
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch(`${API_URL}/me`, { credentials: "include" });
  return res.ok ? res.json() : null;
}
export const patchMe = (body: MePatch) => apiFetch<Me>("/me", { method: "PATCH", body: JSON.stringify(body) });

/** Avatar harflari: ismdan ikki harf ("Umar Ibn" -> "UI"), ism bo'lmasa emailning birinchi harfi. */
export const initials = (me: Pick<Me, "display_name" | "email">) =>
  me.display_name?.trim()
    ? me.display_name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join("")
    : me.email[0]!.toUpperCase();

export const API_KEY_LINKS: Record<Provider, { label: string; url: string }> = {
  anthropic: { label: "Claude (Anthropic Console)", url: "https://console.anthropic.com/settings/keys" },
  deepseek: { label: "Deepseek Platform", url: "https://platform.deepseek.com/api_keys" },
  gemini: { label: "Google AI Studio (Gemini)", url: "https://aistudio.google.com/apikey" },
};
