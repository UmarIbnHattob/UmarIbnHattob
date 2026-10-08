"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Ikki panel orasidagi sudraladigan ajratgich: o'ng panel kengligini (px) boshqaradi. */
export function useResizable(initial = 520, min = 320, maxRatio = 0.75) {
  const [width, setWidth] = useState(initial);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.userSelect = "none";
  }, []);

  // Boshlang'ich kenglik ekranga moslashadi: kichik ekranda chat siqilib qolmasin
  useEffect(() => {
    const w = containerRef.current?.getBoundingClientRect().width;
    if (w) setWidth(Math.round(Math.max(min, Math.min(initial, w * 0.4))));
  }, [initial, min]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = rect.right - e.clientX;
      setWidth(Math.max(min, Math.min(next, rect.width * maxRatio)));
    };
    const up = () => {
      dragging.current = false;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [min, maxRatio]);

  return { width, containerRef, onMouseDown };
}
