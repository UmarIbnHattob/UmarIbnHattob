"use client";

import { useEffect, useRef, useState } from "react";
import { Excalidraw, exportToBlob, restoreElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useI18n } from "@/lib/i18n";
import { loadElements, loadFiles, saveElements, saveFiles } from "@/lib/canvasStore";

// Shriftlar o'z serverimizdan (public/excalidraw/, scripts/copy-excalidraw-assets.mjs); topilmasa Excalidraw o'zi CDN ga o'tadi
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw/";

/** Tashqi komponent canvasdan rasm olishi uchun ref orqali beriladigan funksiyalar. */
export type CanvasHandle = { exportPng: () => Promise<string | null> };

type Elements = readonly ExcalidrawElement[];

/** Chizmadan AI ga yuboriladigan PNG (base64, prefikssiz). Chizma bo'sh bo'lsa null. */
async function toPngBase64(elements: Elements, appState: Partial<AppState>, files: BinaryFiles): Promise<string | null> {
  const live = elements.filter((e) => !e.isDeleted);
  if (live.length === 0) return null;
  const blob = await exportToBlob({
    elements: live,
    appState: { ...appState, exportBackground: true },
    files,
    mimeType: "image/png",
    maxWidthOrHeight: 1600, // rasm hajmini cheklaymiz (token va trafik tejash)
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Panel hali ochilmagan bo'lsa ham: shu brauzerda saqlangan chizmadan PNG. */
export async function exportSavedCanvas(userId: string): Promise<string | null> {
  const saved = loadElements(userId);
  if (!saved?.length) return null;
  const elements = restoreElements(saved as Parameters<typeof restoreElements>[0], null);
  return toPngBase64(elements, { viewBackgroundColor: "#ffffff" }, await loadFiles(userId));
}

/** Chizmada ishlatilayotgan rasmlarning id lari (saqlash kerakmi — shu bo'yicha aniqlanadi). */
const usedFileIds = (elements: Elements) =>
  [...new Set(elements.flatMap((e) => (e.type === "image" && e.fileId && !e.isDeleted ? [e.fileId] : [])))].sort();

/** Excalidraw doska. `handleRef` orqali AI ga yuboriladigan PNG (base64) olinadi. */
export default function CanvasPanel({ handleRef, userId }: { handleRef: { current: CanvasHandle | null }; userId: string }) {
  const { lang } = useI18n();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // Canvas ilova mavzusiga moslashadi (Sozlamalar > Mavzu)
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingSave = useRef<(() => void) | null>(null);
  const savedFiles = useRef(""); // oxirgi saqlangan rasmlar to'plami

  // Saqlangan chizma va uning rasmlari (rasmlarsiz reloaddan keyin AI ga bo'sh "placeholder" ketardi)
  const [initialData] = useState(() =>
    (async (): Promise<ExcalidrawInitialDataState | null> => {
      const elements = loadElements(userId);
      if (!elements) return null;
      const files = await loadFiles(userId);
      savedFiles.current = Object.keys(files).sort().join(",");
      return { elements: elements as Elements, files };
    })(),
  );

  useEffect(() => {
    handleRef.current = {
      exportPng: async () => {
        const api = apiRef.current;
        if (!api) return exportSavedCanvas(userId);
        return toPngBase64(api.getSceneElements(), api.getAppState(), api.getFiles());
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, userId]);

  // Sahifadan chiqishda kutib turgan saqlash yo'qolmasin
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      pendingSave.current?.();
    },
    [],
  );

  return (
    <div className="h-full w-full">
      <Excalidraw
        theme={theme}
        // Excalidraw da o'zbekcha yo'q: uz uchun inglizcha
        langCode={lang === "ru" ? "ru-RU" : "en"}
        excalidrawAPI={(api) => (apiRef.current = api)}
        initialData={initialData}
        onChange={(elements, _appState, files) => {
          // Har o'zgarishda emas, 500ms kutib saqlaymiz (faqat shu brauzerda)
          clearTimeout(saveTimer.current);
          pendingSave.current = () => {
            pendingSave.current = null;
            saveElements(
              userId,
              elements.filter((e) => !e.isDeleted),
            );
            const ids = usedFileIds(elements);
            const sig = ids.join(",");
            // Rasmlar katta: faqat to'plam o'zgarganda yoziladi. Fayl hali yuklanmagan bo'lsa keyingi safar.
            if (sig === savedFiles.current || ids.some((id) => !files[id])) return;
            savedFiles.current = sig;
            saveFiles(userId, Object.fromEntries(ids.map((id) => [id, files[id]])));
          };
          saveTimer.current = setTimeout(() => pendingSave.current?.(), 500);
        }}
      />
    </div>
  );
}
