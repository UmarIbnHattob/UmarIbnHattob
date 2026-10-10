"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import * as authApi from "@/lib/authApi";
import { fetchMe, patchMe, type Me, type MePatch } from "@/lib/me";
import { useI18n } from "@/lib/i18n";
import { clearCanvasData } from "@/lib/canvasStore";
import { safeNextPath } from "@/lib/nav";
import Sidebar from "@/components/Sidebar";
import Modals, { type ModalId } from "@/components/Modals";

type AuthCtx = {
  me: Me;
  updateMe: (patch: MePatch) => Promise<void>;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
  openModal: (id: ModalId) => void;
};
const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth faqat AuthGate ichida ishlaydi");
  return ctx;
}

const PUBLIC_PATHS = ["/login"];

/** Mavzu va shrift: <html data-theme/data-font>. Keyingi ochilishda miltillamasligi uchun brauzerda ham saqlanadi. */
function applyAppearance(theme: Me["preferences"]["theme"], font: Me["preferences"]["font_size"]) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.font = font;
  try {
    localStorage.setItem("omniai-theme", theme);
    localStorage.setItem("omniai-font", font);
  } catch {
    /* e'tiborsiz */
  }
}

/** Kirmagan foydalanuvchini /login ga yo'naltiradi; kirgan bo'lsa profil, mavzu, til va tezkor tugmalarni boshqaradi. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setLang } = useI18n();
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = tekshirilmoqda
  const [modal, setModal] = useState<ModalId | null>(null);
  const isPublic = PUBLIC_PATHS.includes(pathname);
  // Chiqishda (logout, barcha qurilmalardan chiqish, hisobni o'chirish) shu brauzerdagi canvas chizmasi o'chiriladi
  const wipeOnLogout = useRef(false);
  // O'zi chiqqan foydalanuvchi uchun "next" kerak emas (keyingi kirgan odam uning sahifasiga tushmasin)
  const leftOnPurpose = useRef(false);
  const meRef = useRef(me);
  meRef.current = me;

  const refreshMe = useCallback(async () => {
    const next = await fetchMe().catch(() => null);
    if (!next && meRef.current) wipeOnLogout.current = leftOnPurpose.current = true;
    setMe(next);
  }, []);

  useEffect(() => {
    refreshMe();
    const expired = () => setMe(null);
    window.addEventListener("auth-expired", expired);
    return () => window.removeEventListener("auth-expired", expired);
  }, [refreshMe]);

  useEffect(() => {
    if (me === undefined) return;
    if (!me && !isPublic) {
      // Kirgandan keyin shu sahifaga qaytish uchun: /login?next=/settings?tab=account
      const here = leftOnPurpose.current ? null : safeNextPath(window.location.pathname + window.location.search);
      leftOnPurpose.current = false;
      router.replace(here && here !== "/" ? `/login?next=${encodeURIComponent(here)}` : "/login");
    }
    if (me && isPublic) router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")) ?? "/chat");
  }, [me, isPublic, router]);

  // Sahifalar (canvas) yopilib bo'lgach tozalaymiz: ular chiqishda oxirgi o'zgarishni saqlab ulgurmasin
  useEffect(() => {
    if (me === null && wipeOnLogout.current) {
      wipeOnLogout.current = false;
      clearCanvasData();
    }
  }, [me]);

  // Sozlamalarni qo'llash (va tizim mavzusi o'zgarsa kuzatish)
  useEffect(() => {
    if (!me) return;
    const { theme, font_size, language } = me.preferences;
    applyAppearance(theme, font_size);
    setLang(language);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance("system", font_size);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [me, setLang]);

  const updateMe = useCallback(
    async (patch: MePatch) => {
      // Darhol ko'rinsin (optimistik), keyin server javobi bilan tasdiqlanadi
      setMe((m) => (m ? { ...m, ...patch, preferences: { ...m.preferences, ...patch.preferences } } as Me : m));
      try {
        setMe(await patchMe(patch));
      } catch (e) {
        await refreshMe();
        throw e;
      }
    },
    [refreshMe],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      wipeOnLogout.current = leftOnPurpose.current = true;
      setMe(null);
    }
  }, []);

  // Tezkor tugmalar
  useEffect(() => {
    if (!me) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === ",") {
        e.preventDefault();
        router.push("/settings");
      } else if (e.key === "/") {
        e.preventDefault();
        setModal("shortcuts");
      } else if (e.shiftKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        window.dispatchEvent(new Event("omni:new-chat"));
        router.push("/chat");
      } else if (e.shiftKey && (e.key === "L" || e.key === "l")) {
        e.preventDefault();
        const current = document.documentElement.dataset.theme;
        updateMe({ preferences: { theme: current === "dark" ? "light" : "dark" } }).catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [me, router, updateMe]);

  // Desktop ilova menyusidan kelgan buyruqlar (masalan "Sozlamalar")
  useEffect(() => {
    const onNav = (e: Event) => router.push((e as CustomEvent<string>).detail);
    const onModal = (e: Event) => setModal((e as CustomEvent<ModalId>).detail);
    window.addEventListener("omni:navigate", onNav);
    window.addEventListener("omni:modal", onModal);
    return () => {
      window.removeEventListener("omni:navigate", onNav);
      window.removeEventListener("omni:modal", onModal);
    };
  }, [router]);

  if (me === undefined) {
    return (
      <div className="flex h-screen items-center justify-center text-neutral-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (isPublic) return <>{children}</>;
  if (!me) return null; // yo'naltirilmoqda

  return (
    <Ctx.Provider value={{ me, updateMe, refreshMe, logout, openModal: setModal }}>
      {/* Telefonda: yuqorida ingichka satr + chapdan chiqadigan menyu; md dan kengda: doimiy chap panel */}
      <div className="flex h-dvh flex-col md:flex-row">
        <Sidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
      <Modals open={modal} onClose={() => setModal(null)} />
    </Ctx.Provider>
  );
}
