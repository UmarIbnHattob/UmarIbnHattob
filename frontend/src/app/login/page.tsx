"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import * as authApi from "@/lib/authApi";
import { RequestError } from "@/lib/api";
import { patchMe } from "@/lib/me";
import { safeNextPath } from "@/lib/nav";
import OrbitLogo from "@/components/OrbitLogo";
import { LANGS, useI18n } from "@/lib/i18n";

/** Kirish / ro'yxatdan o'tish formasi. */
export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
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
      // Yangi hisob: login sahifasida tanlangan tilni profilga yozamiz
      if (mode === "register") await patchMe({ preferences: { language: lang } }).catch(() => {});
      // To'liq yuklash: AuthGate foydalanuvchini yangi cookie bilan qayta o'qiydi.
      // Kirishdan oldin ochilgan sahifaga (?next=) qaytamiz — faqat shu saytning ichki manzili bo'lsa
      window.location.assign(safeNextPath(new URLSearchParams(window.location.search).get("next")) ?? "/chat");
    } catch (err) {
      setError(friendly(err as Error));
      setBusy(false);
    }
  }

  // FastAPI tekshiruv xatolari (422): email yoki parol formati noto'g'ri
  function friendly(err: Error) {
    if (err instanceof RequestError && err.status === 422) return t("login.invalid");
    return err.message;
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
        <p className="text-center text-sm text-neutral-400">{mode === "login" ? t("login.signIn") : t("login.signUp")}</p>

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
          placeholder={t("login.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />

        {error && <p className="rounded bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}

        <button
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 text-white py-2 text-sm hover:bg-blue-500 disabled:opacity-60"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {mode === "login" ? t("login.submitIn") : t("login.submitUp")}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          className="w-full text-center text-sm text-neutral-400 hover:text-neutral-50"
        >
          {mode === "login" ? t("login.toSignUp") : t("login.toSignIn")}
        </button>

        {/* Til tanlash: kirishdan oldin ham */}
        <div className="flex justify-center gap-1 pt-1">
          {LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLang(l.id)}
              className={`rounded-md px-2 py-1 text-xs transition ${lang === l.id ? "bg-neutral-800 text-neutral-50" : "text-neutral-500 hover:text-neutral-200"}`}
            >
              {l.flag} {l.id.toUpperCase()}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
