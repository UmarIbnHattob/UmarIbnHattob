"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Chetdan chiqadigan panel (drawer) uchun: ochilganda fokus panel ichiga o'tadi va Tab bilan undan chiqmaydi,
 * Esc yopadi, yopilganda fokus ochgan tugmaga qaytadi. `closeAt` media so'rovi mos kelsa (katta ekran —
 * panel doimiy ko'rinadi) drawer holati yopiladi.
 */
export function useDrawer(
  open: boolean,
  close: () => void,
  panelRef: RefObject<HTMLElement>,
  triggerRef: RefObject<HTMLElement>,
  closeAt?: string,
) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const items = () => [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.getClientRects().length > 0);
    // Panel ko'rinadigan bo'lgach (keyingi kadrda) birinchi elementga fokus
    const raf = requestAnimationFrame(() => items()[0]?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (!panel?.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const mq = closeAt ? window.matchMedia(closeAt) : null;
    const onMq = () => mq?.matches && closeRef.current();
    mq?.addEventListener("change", onMq);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      mq?.removeEventListener("change", onMq);
      // Fokus panel ichida qolgan bo'lsa (yoki yo'qolgan bo'lsa), ochgan tugmaga qaytaramiz
      const active = document.activeElement;
      if (!active || active === document.body || panel?.contains(active)) trigger?.focus({ preventScroll: true });
    };
  }, [open, panelRef, triggerRef, closeAt]);
}
