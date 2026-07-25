import { GlossaryEntry, StoreName } from "../types";

const DB_NAME = "rdat_copilot_db";
const DB_VERSION = 2;

// Key used inside the `sync_meta` object store to persist the set of
// reference DB IDs that the user has downloaded. Stored as a string[]
// so it survives page reloads (previously this was local useState only,
// which reset on every reload and showed "Download" again — see PHASE
// 2 task 2.3).
export const DOWNLOADED_DBS_KEY = "downloaded_reference_dbs";

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("tm_entries")) {
        db.createObjectStore("tm_entries", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("glossary")) {
        db.createObjectStore("glossary", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("segments")) {
        db.createObjectStore("segments", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("sync_meta")) {
        db.createObjectStore("sync_meta", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putToStore<T>(storeName: StoreName, entry: T): Promise<number | string> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(entry);

    request.onsuccess = () => resolve(request.result as number | string);
    request.onerror = () => reject(tx.error);
  });
}

export async function putBatchToStore<T>(storeName: StoreName, entries: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const entry of entries) {
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllofStore<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(tx.error);
  });
}

export async function deleteFromStore(storeName: StoreName, id: number | string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(tx.error);
  });
}

export async function clearStore(storeName: StoreName): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(tx.error);
  });
}

// Performant large database importer that processes entries in small chunks to avoid blocking the browser process
export async function importGlossaryChunked(
  entries: GlossaryEntry[],
  onProgress?: (progress: number) => void
): Promise<void> {
  const CHUNK_SIZE = 400;
  const total = entries.length;

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    await putBatchToStore("glossary", chunk);

    if (onProgress) {
      onProgress(Math.min(100, Math.round(((i + chunk.length) / total) * 100)));
    }

    // Yield control back to the browser's paint and main lifecycle loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// ─── Single-record read (for editing existing glossary entries) ──────
// Returns the record with the given key from the given store, or
// undefined if not found. Used by GlossaryView's edit flow so we can
// show the current values when the user starts editing. See PHASE 2
// task 2.4.
export async function getFromStore<T>(
  storeName: StoreName,
  id: number | string
): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(tx.error);
  });
}

// ─── Reference-DB download-state persistence ────────────────────────
// The set of reference DB IDs the user has downloaded is stored in the
// sync_meta object store keyed by DOWNLOADED_DBS_KEY. This survives
// page reloads so the GlossaryView can show "Use" instead of "Download"
// on revisits. See PHASE 2 task 2.3.

export async function getDownloadedDbs(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_meta", "readonly");
    const store = tx.objectStore("sync_meta");
    const request = store.get(DOWNLOADED_DBS_KEY);

    request.onsuccess = () => {
      const result = request.result as { key: string; value: string[] } | undefined;
      resolve(result?.value ?? []);
    };
    request.onerror = () => reject(tx.error);
  });
}

export async function setDownloadedDbs(ids: string[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_meta", "readwrite");
    const store = tx.objectStore("sync_meta");
    const request = store.put({ key: DOWNLOADED_DBS_KEY, value: ids });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(tx.error);
  });
}
