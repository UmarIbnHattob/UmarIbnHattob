"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import * as authApi from "@/lib/authApi";
import OrbitLogo from "@/components/OrbitLogo";

/** Kirish / ro'yxatdan o'tish formasi. */
export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === "login" ? authApi.login : authApi.register)(email.trim(), password);
      // To'liq yuklash: AuthGate foydalanuvchini yangi cookie bilan qayta o'qiydi
      window.location.assign("/chat");
    } catch (err) {
      setError(friendly((err as Error).message));
      setBusy(false);
    }
  }

  // FastAPI tekshiruv xatolari (422) inglizcha keladi: tushunarli qilamiz
  function friendly(msg: string) {
    if (msg.includes("Server xatosi (422)")) return "Email to‘g‘ri emas yoki parol 8 belgidan qisqa.";
    return msg;
  }

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden p-4">
      {/* Fon: model ranglaridagi sekin suzuvchi aurora */}
      <div className="aurora left-[10%] top-[15%] h-72 w-72 bg-[#e07a5f]" />
      <div className="aurora bottom-[10%] right-[12%] h-80 w-80 bg-[#4d6bfe]" style={{ animationDelay: "-6s" }} />
      <div className="aurora left-[45%] top-[50%] h-64 w-64 bg-[#a78bfa]" style={{ animationDelay: "-12s" }} />

      <form
        onSubmit={submit}
        className="msg-in relative w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-neutral-950/70 p-6 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex flex-col items-center gap-3 pb-2">
          <OrbitLogo size={72} />
          <h1 className="text-xl font-semibold">OmniAI Workspace</h1>
        </div>
        <p className="text-center text-sm text-neutral-400">{mode === "login" ? "Hisobingizga kiring" : "Yangi hisob yarating"}</p>

        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder="Parol (kamida 8 belgi)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />

        {error && <p className="rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>}

        <button
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2 text-sm hover:bg-blue-500 disabled:opacity-60"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {mode === "login" ? "Kirish" : "Ro‘yxatdan o‘tish"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          className="w-full text-center text-sm text-neutral-400 hover:text-white"
        >
          {mode === "login" ? "Hisobingiz yo‘qmi? Ro‘yxatdan o‘ting" : "Hisobingiz bormi? Kiring"}
        </button>
      </form>
    </div>
  );
}
