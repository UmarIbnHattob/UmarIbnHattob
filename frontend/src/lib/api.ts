/** Backend API manzili va umumiy fetch yordamchisi. */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API xatosi: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
