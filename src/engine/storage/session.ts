import type { EditState, MaskLayer } from "@/types/editor";
import { SESSION_SCHEMA_VERSION } from "./sessionSchema";
import { photoBlob, withBytes, type StoredPhoto } from "./sessionBlob";

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
  /** Which version of the saved shape this is. Stamped by saveSession; absent in older saves. */
  schemaVersion?: number;
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

function putRecord(db: IDBDatabase, record: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record, SESSION_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Session persistence is a convenience, not a requirement.
 * Persistence failures never interrupt editing, but they are no longer silent: a warning is
 * logged, so a save that quietly never happens can be found.
 */
export async function saveSession(session: SavedSession): Promise<void> {
  let db: IDBDatabase | undefined;

  try {
    db = await openDb();
    const record = { ...session, maskSpace: "source", schemaVersion: SESSION_SCHEMA_VERSION };
    try {
      await putRecord(db, record);
    } catch (error) {
      // Some browsers will not store a Blob in IndexedDB in some modes (WebKit in private
      // browsing, for one) but will store the same bytes, so try again with those.
      console.warn("[pictoe] saving the photo as a Blob failed; retrying with its bytes:", error);
      await putRecord(db, await withBytes(record));
    }
  } catch (error) {
    console.warn("[pictoe] could not save the session:", error);
  } finally {
    db?.close();
  }
}

export async function loadSession(): Promise<SavedSession | null> {
  let db: IDBDatabase | undefined;

  try {
    db = await openDb();

    const stored = await new Promise<(Omit<SavedSession, "imageBlob"> & StoredPhoto) | null>(
      (resolve, reject) => {
        const tx = db!.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(SESSION_KEY);

        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error);
      },
    );
    if (!stored) return null;

    const blob = photoBlob(stored);
    if (!blob) {
      console.warn("[pictoe] the saved session has no usable photo; ignoring it");
      return null;
    }
    const { imageBlob: _blob, imageBytes: _bytes, ...rest } = stored;
    return { ...rest, imageBlob: blob } as SavedSession;
  } catch (error) {
    console.warn("[pictoe] could not load the saved session:", error);
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
