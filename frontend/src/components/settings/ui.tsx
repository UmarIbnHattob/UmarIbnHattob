"use client";

/** Sozlamalar sahifasining umumiy qismlari: bo'lim, qator, kalit (toggle), segment, o'chirishni tasdiqlash, bildirishnoma. */
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    // msg-in animatsiyasi bo'limni alohida qatlamga (stacking context) aylantiradi: ichidagi ochiluvchi ro'yxat
    // (masalan model tanlagich) keyingi bo'limlar ostida qolmasligi uchun fokus ichida bo'lsa bo'lim yuqoriga ko'tariladi
    <section className="msg-in relative mb-8 focus-within:z-20">
      <h2 className="text-base font-semibold">{title}</h2>
      {desc && <p className="mt-0.5 text-sm text-neutral-400">{desc}</p>}
      <div className="mt-3 divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-950/40">{children}</div>
    </section>
  );
}

/** Nom va boshqaruv elementi bir qatorda; joy yetmasa boshqaruv nom ostiga o'tadi (ustma-ust chiqmaydi). */
export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
      <div className="min-w-0 flex-1 basis-52">
        <div className="text-sm text-neutral-100">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
      </div>
      <div className="min-w-0 max-w-full">{children}</div>
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

/**
 * Segmentli tanlov. Fon "tabletkasi" faol tugmaning HAQIQIY o'lchami va joyiga qo'yiladi
 * (tugmalar kengligi tilga va shrift o'lchamiga qarab har xil bo'ladi).
 */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number; animate: boolean } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const place = () => {
      const btn = box.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!btn) return setPill(null);
      // Birinchi joylashtirishda animatsiya yo'q (chapdan sirpanib kelmasin)
      setPill((p) => ({ left: btn.offsetLeft, width: btn.offsetWidth, animate: p !== null }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(box);
    box.querySelectorAll("button").forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [value, options.length]);

  return (
    <div ref={ref} className="relative flex max-w-full overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
      {pill && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0 rounded-md bg-neutral-800"
          style={{
            width: pill.width,
            transform: `translateX(${pill.left}px)`,
            transition: pill.animate ? "transform .3s cubic-bezier(.3,1.3,.5,1), width .3s cubic-bezier(.3,1.3,.5,1)" : "none",
          }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={`relative z-10 flex-1 whitespace-nowrap rounded-md px-3 py-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500/60 ${o.id === value ? "text-neutral-50" : "text-neutral-400 hover:text-neutral-200"}`}
        >
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

/**
 * O'chirish tugmasi (axlat qutisi): bosilganda darhol o'chirmaydi — yonida savol va "Bekor qilish / O'chirish" chiqadi.
 * `onConfirm` tugaguncha tugma bloklanadi (ikki marta bosish ikki so'rov yubormaydi).
 */
export function ConfirmDelete({
  question,
  onConfirm,
  disabled,
  className = "rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-red-400 disabled:opacity-50",
  size = 15,
}: {
  question: string;
  onConfirm: () => Promise<unknown>;
  disabled?: boolean;
  className?: string;
  size?: number;
}) {
  const { t } = useI18n();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ask) {
    return (
      <button type="button" onClick={() => setAsk(true)} disabled={disabled} aria-label={t("common.delete")} title={t("common.delete")} className={className}>
        <Trash2 size={size} />
      </button>
    );
  }
  return (
    <span className="pop-in flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs text-red-400">{question}</span>
      <button type="button" autoFocus onClick={() => setAsk(false)} className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800">
        {t("common.cancel")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsk(false);
          }
        }}
        className="rounded-md bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-500 disabled:opacity-50"
      >
        {t("common.delete")}
      </button>
    </span>
  );
}

type Toast = { id: number; text: string; ok: boolean };
const ToastCtx = createContext<(text: string, ok?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

/** Pastdan chiqib, o'zi yo'qoladigan kichik bildirishnomalar ("Saqlandi"). Xatolar uzoqroq turadi. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, ok = true) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, ok }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ok ? 2600 : 6000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pop-in flex items-center gap-2 rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm shadow-xl">
            {t.ok ? <Check size={15} className="shrink-0 text-emerald-400" /> : <X size={15} className="shrink-0 text-red-400" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
