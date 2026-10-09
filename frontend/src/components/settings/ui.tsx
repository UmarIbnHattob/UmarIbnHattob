"use client";

/** Sozlamalar sahifasining umumiy qismlari: bo'lim, qator, kalit (toggle), segment, bildirishnoma. */
import { createContext, useCallback, useContext, useState } from "react";
import { Check, X } from "lucide-react";

export function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="msg-in mb-8">
      <h2 className="text-base font-semibold">{title}</h2>
      {desc && <p className="mt-0.5 text-sm text-neutral-400">{desc}</p>}
      <div className="mt-3 divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-950/40">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm text-neutral-100">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors duration-300 ${checked ? "bg-violet-600" : "bg-neutral-700"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${checked ? "translate-x-5" : "translate-x-0"}`}
        style={{ transitionTimingFunction: "cubic-bezier(.3,1.6,.5,1)" }}
      />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div className="relative flex rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
      <span
        className="absolute inset-y-0.5 rounded-md bg-neutral-800 transition-transform duration-300"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${idx * 100}%)`, transitionTimingFunction: "cubic-bezier(.3,1.3,.5,1)" }}
      />
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`relative z-10 flex-1 whitespace-nowrap px-3 py-1 text-sm transition-colors ${o.id === value ? "text-neutral-50" : "text-neutral-400 hover:text-neutral-200"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputCls = "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20";
export const btnCls = "rounded-md bg-violet-600 px-4 py-2 text-sm text-white transition hover:bg-violet-500 disabled:opacity-50";
export const btnGhostCls = "rounded-md border border-neutral-700 px-4 py-2 text-sm transition hover:bg-neutral-800 disabled:opacity-50";
export const btnDangerCls = "rounded-md border border-red-500/40 px-4 py-2 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-50";

type Toast = { id: number; text: string; ok: boolean };
const ToastCtx = createContext<(text: string, ok?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

/** Pastdan chiqib, o'zi yo'qoladigan kichik bildirishnomalar ("Saqlandi"). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, ok = true) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, ok }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pop-in flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm shadow-xl">
            {t.ok ? <Check size={15} className="text-emerald-400" /> : <X size={15} className="text-red-400" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
