/** Backend API manzili va umumiy fetch yordamchisi. */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

/** Server javob bergan, lekin so'rov bajarilmagan xato (4xx/5xx). */
export class RequestError extends Error {}

export const NETWORK_ERROR = "Backend bilan aloqa yo‘q. Server (uvicorn) ishlayotganini tekshiring.";

/** fetch ni chaqiradi; tarmoq xatosini va server `detail` xabarini tushunarli Error ga aylantiradi. */
export async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    // credentials: "include" — sessiya cookie'si backendga yuboriladi
    res = await fetch(`${API_URL}${path}`, { credentials: "include", ...init });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(NETWORK_ERROR);
  }
  if (res.status === 401) {
    // Sessiya tugagan: AuthGate eshitib, kirish sahifasiga o'tkazadi
    window.dispatchEvent(new Event("auth-expired"));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail = typeof data?.detail === "string" ? data.detail : `Server xatosi (${res.status})`;
    throw new RequestError(detail);
  }
  return res;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}
