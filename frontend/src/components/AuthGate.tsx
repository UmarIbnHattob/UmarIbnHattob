"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import * as authApi from "@/lib/authApi";
import Sidebar from "@/components/Sidebar";

type AuthCtx = { user: authApi.AuthUser; setUser: (u: authApi.AuthUser | null) => void; logout: () => Promise<void> };
const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth faqat AuthGate ichida ishlaydi");
  return ctx;
}

const PUBLIC_PATHS = ["/login"];

/** Kirmagan foydalanuvchini /login ga yo'naltiradi; kirgan bo'lsa sidebar bilan sahifani ko'rsatadi. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<authApi.AuthUser | null | undefined>(undefined); // undefined = tekshirilmoqda
  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    authApi.fetchMe().then(setUser).catch(() => setUser(null));
    const expired = () => setUser(null);
    window.addEventListener("auth-expired", expired);
    return () => window.removeEventListener("auth-expired", expired);
  }, []);

  useEffect(() => {
    if (user === undefined) return;
    if (!user && !isPublic) router.replace("/login");
    if (user && isPublic) router.replace("/chat");
  }, [user, isPublic, router]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  if (user === undefined) {
    return (
      <div className="flex h-screen items-center justify-center text-neutral-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (isPublic) return <>{children}</>;
  if (!user) return null; // yo'naltirilmoqda

  return (
    <Ctx.Provider value={{ user, setUser, logout }}>
      <div className="flex h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </Ctx.Provider>
  );
}
