import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSession, loadSession, saveSession, type SavedSession } from "./session";
import { SESSION_SCHEMA_VERSION } from "./sessionSchema";
import { DEFAULT_EDIT_STATE } from "@/types/editor";

/** A minimal in-memory stand-in for the parts of IndexedDB that session.ts uses. */
type FakeRequest = { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void };
type FakeTx = { oncomplete?: () => void; objectStore?: () => unknown };

function fakeIndexedDB() {
  const data = new Map<string, unknown>();
  const later = (fn: () => void) => queueMicrotask(fn);
  const db = {
    createObjectStore() {},
    close() {},
    transaction() {
      const tx: FakeTx = {};
      const request = (work: () => unknown) => {
        const req: FakeRequest = {};
        later(() => {
          req.result = work();
          req.onsuccess?.();
          tx.oncomplete?.();
        });
        return req;
      };
      tx.objectStore = () => ({
        put: (value: unknown, key: string) => request(() => void data.set(key, value)),
        get: (key: string) => request(() => data.get(key)),
        delete: (key: string) => request(() => void data.delete(key)),
      });
      return tx;
    },
  };
  return {
    data,
    open() {
      const req: FakeRequest = { result: db };
      later(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

const session = (): SavedSession => ({
  imageBlob: new Blob(["x"]),
  name: "a.jpg",
  type: "image/jpeg",
  edit: DEFAULT_EDIT_STATE,
});

afterEach(() => vi.unstubAllGlobals());

describe("session storage", () => {
  it("stamps the schema version and mask space on every save, whatever the caller passed", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB());
    await saveSession({ ...session(), schemaVersion: 0 });
    const loaded = await loadSession();
    expect(loaded?.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(loaded?.maskSpace).toBe("source");
    expect(loaded?.name).toBe("a.jpg");
  });

  it("returns null when nothing is saved, and after clearing", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB());
    expect(await loadSession()).toBeNull();
    await saveSession(session());
    expect(await loadSession()).not.toBeNull();
    await clearSession();
    expect(await loadSession()).toBeNull();
  });

  it("never throws when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        throw new Error("blocked");
      },
    });
    await expect(saveSession(session())).resolves.toBeUndefined();
    await expect(loadSession()).resolves.toBeNull();
    await expect(clearSession()).resolves.toBeUndefined();
  });
});
