import type { EditState, MaskLayer } from "@/types/editor";

const DB_NAME = "pictoe";
const DB_VERSION = 1;
const STORE_NAME = "session";
const SESSION_KEY = "current";

export type SavedSession = {
  imageBlob: Blob;
  name: string;
  type: string;
  edit: EditState;
  maskLayers?: MaskLayer[];
  /** "source": strokes are relative to the source image. Absent in older saves (relative to the visible frame). */
  maskSpace?: "source";
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Session persistence is a convenience, not a requirement.
 * Persistence failures never interrupt editing.
 */
export async function saveSession(session: SavedSession): Promise<void> {
  let db: IDBDatabase | undefined;

  try {
    db = await openDb();

    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readwrite");

      tx.objectStore(STORE_NAME).put(session, SESSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Ignore persistence failures.
  } finally {
    db?.close();
  }
}

export async function loadSession(): Promise<SavedSession | null> {
  let db: IDBDatabase | undefined;

  try {
    db = await openDb();

    return await new Promise<SavedSession | null>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(SESSION_KEY);

      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function clearSession(): Promise<void> {
  let db: IDBDatabase | undefined;

  try {
    db = await openDb();

    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readwrite");

      tx.objectStore(STORE_NAME).delete(SESSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Ignore persistence failures.
  } finally {
    db?.close();
  }
}
