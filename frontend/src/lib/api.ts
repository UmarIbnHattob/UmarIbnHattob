/** Backend API manzili va umumiy fetch yordamchisi. */
import { translate, type Lang, type TKey } from "@/lib/i18n";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

/** Server javob bergan, lekin so'rov bajarilmagan xato (4xx/5xx). `status` — HTTP holat kodi. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/**
 * Joriy interfeys tili. api.ts React komponenti emas, shuning uchun tilni i18n saqlagan joydan o'qiymiz:
 * avval brauzer xotirasi (I18nProvider tanlovni shu yerga yozadi), keyin <html lang>.
 */
function currentLang(): Lang {
  const ok = (l: string | null | undefined): l is Lang => l === "uz" || l === "en" || l === "ru";
  try {
    const saved = localStorage.getItem("omniai-lang");
    if (ok(saved)) return saved;
  } catch {
    /* e'tiborsiz */
  }
  const html = typeof document !== "undefined" ? document.documentElement.lang : null;
  return ok(html) ? html : "uz";
}

const tr = (key: TKey, vars?: Record<string, string | number>) => translate(currentLang(), key, vars);

/** Tarmoq xatosi matni (foydalanuvchi uchun, joriy tilda). */
export const networkErrorText = () => tr("err.network");

// Pydantic maydon nomlari -> foydalanuvchiga tushunarli nom
const FIELDS: Record<string, TKey> = {
  key: "field.key", api_key: "field.key", content: "field.content", question: "field.content", prompt: "field.prompt",
  name: "field.name", title: "field.title", password: "field.password", current_password: "field.password",
  new_password: "field.password", display_name: "field.displayName", nickname: "field.nickname", email: "field.email",
  base_url: "field.baseUrl", folder: "field.folder", messages: "field.messages",
};

type PydanticError = { type?: string; loc?: (string | number)[]; msg?: string; ctx?: Record<string, unknown> };

/** FastAPI 422 tafsiloti (ro'yxat) -> o'qiladigan, tarjima qilingan xabar ("API kalit: kamida 8 belgi…"). */
function validationText(errors: PydanticError[]): string {
  const lines = errors.slice(0, 3).map((e) => {
    const name = [...(e.loc ?? [])].reverse().find((x): x is string => typeof x === "string" && x !== "body");
    const field = name ? (FIELDS[name] ? tr(FIELDS[name]) : name) : tr("field.value");
    const n = Number(e.ctx?.min_length ?? e.ctx?.max_length ?? 0);
    switch (e.type) {
      case "string_too_short":
        return n <= 1 ? tr("err.missing", { field }) : tr("err.tooShort", { field, n });
      case "string_too_long":
        return tr("err.tooLong", { field, n });
      case "too_long":
        return tr("err.tooMany", { field, n });
      case "missing":
        return tr("err.missing", { field });
      default:
        return tr("err.invalid", { field });
    }
  });
  return [...new Set(lines)].join(" ");
}

/** fetch ni chaqiradi; tarmoq xatosini va server `detail` xabarini tushunarli Error ga aylantiradi. */
export async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    // credentials: "include" — sessiya cookie'si backendga yuboriladi; no-store — chiqqandan keyin
    // "Orqaga" bosilganda oldingi foydalanuvchi ma'lumoti brauzer keshidan ko'rinmasin
    res = await fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store", ...init });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(networkErrorText());
  }
  if (res.status === 401) {
    // Sessiya tugagan: AuthGate eshitib, kirish sahifasiga o'tkazadi
    window.dispatchEvent(new Event("auth-expired"));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : Array.isArray(data?.detail) && data.detail.length
          ? validationText(data.detail)
          : tr("err.server", { n: res.status });
    throw new RequestError(detail, res.status);
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
