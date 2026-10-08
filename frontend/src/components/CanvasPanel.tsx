"use client";

import { useEffect, useRef } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const STORAGE_KEY = "omniai-canvas-v1";

/** Tashqi komponent canvasdan rasm olishi uchun ref orqali beriladigan funksiyalar. */
export type CanvasHandle = { exportPng: () => Promise<string | null> };

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { elements: JSON.parse(raw) } : undefined;
  } catch {
    return undefined;
  }
}

/** Excalidraw doska. `handleRef` orqali AI ga yuboriladigan PNG (base64) olinadi. */
export default function CanvasPanel({ handleRef }: { handleRef: { current: CanvasHandle | null } }) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    handleRef.current = {
      exportPng: async () => {
        const api = apiRef.current;
        if (!api) return null;
        const elements = api.getSceneElements().filter((e) => !e.isDeleted);
        if (elements.length === 0) return null;
        const blob = await exportToBlob({
          elements,
          appState: { ...api.getAppState(), exportBackground: true },
          files: api.getFiles(),
          mimeType: "image/png",
          maxWidthOrHeight: 1600, // rasm hajmini cheklaymiz (token va trafik tejash)
        });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  return (
    <div className="h-full w-full">
      <Excalidraw
        theme="dark"
        excalidrawAPI={(api) => (apiRef.current = api)}
        initialData={loadSaved()}
        onChange={(elements) => {
          // Har o'zgarishda emas, 500ms kutib saqlaymiz (faqat shu brauzerda)
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(elements.filter((e) => !e.isDeleted)));
            } catch {
              /* joy yetmasa yoki bloklangan bo'lsa, jim o'tamiz */
            }
          }, 500);
        }}
      />
    </div>
  );
}
