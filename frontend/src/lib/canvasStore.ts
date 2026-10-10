/**
 * Canvas (Excalidraw) chizmasi faqat shu brauzerda, har bir foydalanuvchiga alohida saqlanadi.
 * Elementlar — localStorage (`omniai-canvas-v1:<userId>`), qo'yilgan rasmlar (katta dataURL) — IndexedDB.
 * Chiqishda (logout, hisobni o'chirish) hammasi tozalanadi: keyingi foydalanuvchi oldingisining chizmasini ko'rmaydi.
 */
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

const PREFIX = "omniai-canvas-v1";
const DB_NAME = "omniai-canvas";
const STORE = "files";

const sceneKey = (userId: string) => `${PREFIX}:${userId}`;

/** Saqlangan elementlar (bo'lmasa null). */
export function loadElements(userId: string): unknown[] | null {
  try {
    // Eski umumiy kalit kimning chizmasi ekani noma'lum: hech kimga ko'rsatmay o'chiramiz
    localStorage.removeItem(PREFIX);
    const raw = localStorage.getItem(sceneKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveElements(userId: string, elements: readonly unknown[]) {
  try {
    localStorage.setItem(sceneKey(userId), JSON.stringify(elements));
  } catch {
    /* joy yetmasa yoki bloklangan bo'lsa, jim o'tamiz */
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Chizmadagi rasmlar (fileId -> dataURL). Xato bo'lsa bo'sh. */
export async function loadFiles(userId: string): Promise<BinaryFiles> {
  try {
    return ((await withStore("readonly", (s) => s.get(userId))) as BinaryFiles | undefined) ?? {};
  } catch {
    return {};
  }
}

export async function saveFiles(userId: string, files: BinaryFiles) {
  try {
    await withStore("readwrite", (s) => s.put(files, userId));
  } catch {
    /* saqlab bo'lmasa, rasmlar faqat shu sessiyada qoladi */
  }
}

/** Chiqishda: barcha foydalanuvchilarning canvas ma'lumotlari o'chiriladi. */
export function clearCanvasData() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  } catch {
    /* e'tiborsiz */
  }
  try {
    indexedDB.deleteDatabase(DB_NAME);
  } catch {
    /* e'tiborsiz */
  }
}
