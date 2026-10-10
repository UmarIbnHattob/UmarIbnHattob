/**
 * Kirgandan keyin qaytiladigan manzil (`/login?next=...`): faqat shu saytning ichki sahifasi.
 * Matn prefiksini tekshirishning o'zi yetmaydi: brauzer URL dagi tab/yangi qator belgilarini olib tashlaydi
 * ("/\t/evil.com" -> "//evil.com"), "\" ni "/" deb o'qiydi. Shuning uchun manzil URL sifatida tahlil qilinib,
 * origin solishtiriladi. /login ning o'zi ham rad etiladi (aylanib qolmasin). Yaroqsiz bo'lsa null.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return null;
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
