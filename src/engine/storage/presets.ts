import type { PresetAdjustments } from "@/types/editor";

const DB_NAME = "pictoe-presets";
const DB_VERSION = 1;
const STORE_NAME = "presets";

export type StoredPreset = {
  id: string;
  name: string;
  adjustments: PresetAdjustments;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Fails silently, same convention as session.ts — presets are a
 *  convenience, never a blocker for actual editing. */
export async function listPresets(): Promise<StoredPreset[]> {
  try {
    const db = await openDb();
    const result = await new Promise<StoredPreset[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return [];
  }
}

export async function savePreset(preset: StoredPreset): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(preset);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function deletePreset(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

/**
 * Saves several presets in one go (an import). Unlike the single-preset calls it says whether it
 * worked, because an import reports what it did and must not claim a save that didn't happen.
 * All or nothing: one transaction.
 */
export async function savePresets(presets: readonly StoredPreset[]): Promise<boolean> {
  if (presets.length === 0) return true;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const preset of presets) store.put(preset);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}
