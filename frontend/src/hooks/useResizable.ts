"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// O'lchov birinchi chizishdan oldin olinadi (aks holda bir kadr panel noto'g'ri joyda ko'rinadi)
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Ikki panel orasidagi sudraladigan ajratgich: o'ng panel kengligini (px) boshqaradi.
 * Kenglik doim konteynerga moslanadi (oyna o'zgarsa ham): chap tomonda kamida `keep` px qoladi.
 * `fits=false` — yonma-yon joy yetmaydi (panel ustma-ust ochilishi kerak).
 */
export function useResizable(initial = 520, min = 320, keep = 360) {
  // Foydalanuvchi sudrab tanlagan kenglik (null — avtomatik: konteynerning ~45% i)
  const [desired, setDesired] = useState<number | null>(null);
  const [available, setAvailable] = useState(0);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Konteyner kengligini kuzatamiz: oyna kichraysa panel ham kichrayadi, chat ustuni yo'qolib qolmaydi
  useIsoLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.getBoundingClientRect().width);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const max = Math.max(0, available - keep - 4); // 4 — ajratgich chizig'i
  const fits = available > 0 && max >= min;
  const auto = Math.max(min, Math.min(initial, available * 0.45));
  const width = Math.round(Math.max(min, Math.min(desired ?? auto, max)));

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.userSelect = "none";
  }, []);

  // Klaviatura: ajratgichda ←/→ panelni kengaytiradi/toraytiradi
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setDesired(Math.max(min, Math.min(width + (e.key === "ArrowLeft" ? 32 : -32), max)));
    },
    [width, min, max],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setDesired(Math.max(min, Math.min(rect.right - e.clientX, rect.width - keep - 4)));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [min, keep]);

  return { width, fits, min, max, containerRef, onPointerDown, onKeyDown };
}
