/** Autentifikatsiya API chaqiruvlari. */
import { API_URL, apiFetch } from "@/lib/api";

export type AuthUser = { id: string; email: string };

/** Joriy foydalanuvchi; kirmagan bo'lsa null. (401 hodisasini yubormaydi: oddiy fetch.) */
export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
  return res.ok ? res.json() : null;
}

export const login = (email: string, password: string) =>
  apiFetch<AuthUser>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const register = (email: string, password: string) =>
  apiFetch<AuthUser>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
export const logout = () => apiFetch<void>("/auth/logout", { method: "POST" });
