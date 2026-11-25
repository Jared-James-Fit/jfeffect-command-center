/**
 * A meeting recording's parts kept on this device until the server has them
 * (IndexedDB), so a dropped connection, a closed tab or a crash never loses
 * what was recorded: a finished part waits here until its upload is
 * confirmed, and the part in progress is saved every few seconds. Reopening
 * the meeting offers to send what's left. Cleared once uploaded.
 */
const DB = "jf-meeting-audio";
const STORE = "parts";

export type StoredPart = {
  key: string;
  sessionId: string;
  seq: number;
  mime: string;
  offsetMs: number;
  durationMs: number | null;
  blob: Blob;
  /** the part was still recording when it was saved (a recovery copy) */
  partial: boolean;
  savedAt: number;
};

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? (req.result as T) : null);
      t.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const partKey = (sessionId: string, seq: number) => `${sessionId}:${seq}`;

export function savePart(p: Omit<StoredPart, "key" | "savedAt">): Promise<unknown> {
  return tx("readwrite", (s) =>
    s.put({ ...p, key: partKey(p.sessionId, p.seq), savedAt: Date.now() }),
  );
}

export function dropPart(sessionId: string, seq: number): Promise<unknown> {
  return tx("readwrite", (s) => s.delete(partKey(sessionId, seq)));
}

export async function partsFor(sessionId: string): Promise<StoredPart[]> {
  const all = ((await tx<StoredPart[]>("readonly", (s) => s.getAll())) ?? []) as StoredPart[];
  return all.filter((p) => p.sessionId === sessionId).sort((a, b) => a.seq - b.seq);
}
