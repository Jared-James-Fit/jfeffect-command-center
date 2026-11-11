/**
 * The set video outbox, on the phone (IndexedDB): every set video on its
 * way up, with the clip that goes once it's ready. iOS stops a home-screen
 * app in the background and can end it outright, which takes the picked
 * file with it; keeping the prepared clip here means the next open carries
 * on from where it was (the upload resumes from what already landed) instead
 * of the athlete having to find the video again. A record goes once its
 * video is on the set and in the coach chat, or after OUTBOX_MAX_AGE_MS.
 *
 * Light on purpose (no video code): the app checks it on open.
 */
import type { SetVideoJob } from "@/lib/set-videos/jobs";

const DB = "jf-set-videos";
const STORE = "outbox";
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type OutboxMeta = Pick<
  SetVideoJob,
  | "id"
  | "userId"
  | "clientId"
  | "rowId"
  | "dayId"
  | "resultId"
  | "setIndex"
  | "exerciseName"
  | "dayTitle"
  | "label"
  | "fileKey"
  | "fileName"
  | "createdAt"
>;

export type OutboxRecord = {
  id: string;
  userId: string;
  meta: OutboxMeta;
  /** The clip that uploads (cut / shrunk already), once it's ready. */
  file?: Blob | null;
  fileType?: string | null;
  /** Where it goes (message-attachments). */
  path?: string | null;
  posterPath?: string | null;
  poster?: Blob | null;
  posterUploaded?: boolean;
  width?: number | null;
  height?: number | null;
  uploaded?: boolean;
  /** The server's read of it (verifyVideoUploadFn). */
  check?: {
    duration: number;
    width: number | null;
    height: number | null;
    bytes: number;
    mime: string | null;
  } | null;
  /** What the phone did, for the upload record. */
  transfer?: Record<string, string | number | null> | null;
  render?: { mode: string; reason: string; ms: number } | null;
  source?: { duration: number; bytes: number; selSec: number; canEncode: boolean } | null;
  savedAt: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: "id" });
          s.createIndex("userId", "userId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const t = db.transaction(STORE, mode);
          const req = fn(t.objectStore(STORE));
          let out: T | null = null;
          if (req)
            req.onsuccess = () => {
              out = req.result as T;
            };
          t.oncomplete = () => resolve(out);
          t.onerror = () => resolve(null);
          t.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Save (or replace) a record. False when the phone wouldn't keep it (no storage, private mode, full). */
export async function outboxPut(rec: OutboxRecord): Promise<boolean> {
  const done = await tx("readwrite", (s) => s.put({ ...rec, savedAt: Date.now() }));
  return done !== null;
}

export async function outboxGet(id: string): Promise<OutboxRecord | null> {
  return (await tx<OutboxRecord>("readonly", (s) => s.get(id))) ?? null;
}

/**
 * Merge into a record in one transaction (the poster and the clip are saved
 * side by side: a read here and a write there would let one wipe the other);
 * false when it isn't there (or wasn't saved).
 */
export async function outboxPatch(id: string, patch: Partial<OutboxRecord>): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const t = db.transaction(STORE, "readwrite");
      const s = t.objectStore(STORE);
      let found = false;
      const req = s.get(id);
      req.onsuccess = () => {
        const cur = req.result as OutboxRecord | undefined;
        if (!cur) return;
        found = true;
        s.put({ ...cur, ...patch, id: cur.id, userId: cur.userId, savedAt: Date.now() });
      };
      t.oncomplete = () => resolve(found);
      t.onerror = () => resolve(false);
      t.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function outboxDelete(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/** This login's records, oldest first; stale ones are cleared on the way. */
export async function outboxForUser(userId: string, now = Date.now()): Promise<OutboxRecord[]> {
  const all = (await tx<OutboxRecord[]>("readonly", (s) => s.index("userId").getAll(userId))) ?? [];
  const keep: OutboxRecord[] = [];
  for (const r of all) {
    if (now - (r.meta?.createdAt ?? r.savedAt ?? 0) > OUTBOX_MAX_AGE_MS) await outboxDelete(r.id);
    else keep.push(r);
  }
  return keep.sort((a, b) => (a.meta?.createdAt ?? 0) - (b.meta?.createdAt ?? 0));
}

/** Anything waiting for this login (cheap: the app asks on open before loading any video code). */
export async function outboxHasAny(userId: string): Promise<boolean> {
  const n = await tx<number>("readonly", (s) => s.index("userId").count(userId));
  return (n ?? 0) > 0;
}

/** On sign-out: nothing of one person's stays for the next. */
export async function outboxClearUser(userId: string): Promise<void> {
  for (const r of await outboxForUser(userId, 0)) await outboxDelete(r.id);
}
