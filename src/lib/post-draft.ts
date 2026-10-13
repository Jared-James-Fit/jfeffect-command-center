/**
 * The post being made, kept on the phone while it's being made: the photo,
 * the caption, who sees it and the look. If posting fails, the app is
 * reloaded, or iOS drops the app while the camera is open, the studio opens
 * on it again instead of a blank camera. One draft at a time, for one post
 * (`key` = the studio's post key); cleared once it's posted or thrown away.
 *
 * IndexedDB, because the photo is a Blob and localStorage only holds text.
 * Everything here is best effort: no storage (private mode) = no drafts.
 */
export type PostDraft = {
  key: string;
  caption: string;
  visibility: string;
  look: string | null;
  photo: Blob | null;
  live: boolean;
  at: number;
  savedAt: number;
};

const DB = "jf-post-draft";
const STORE = "draft";
const ID = "current";
/** A draft older than this is stale (the workout it was for has moved on). */
export const DRAFT_MAX_AGE = 3 * 86_400_000;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req ? (req.result as T) : null);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function saveDraft(d: Omit<PostDraft, "savedAt">): Promise<void> {
  await run("readwrite", (s) => s.put({ ...d, savedAt: Date.now() }, ID));
}

/** The draft for this post, if there is a fresh one. */
export async function loadDraft(key: string, now = Date.now()): Promise<PostDraft | null> {
  const d = await run<PostDraft | undefined>("readonly", (s) => s.get(ID));
  if (!d || d.key !== key || now - (d.savedAt ?? 0) > DRAFT_MAX_AGE) return null;
  return d;
}

export async function clearDraft(key?: string): Promise<void> {
  if (key) {
    const d = await run<PostDraft | undefined>("readonly", (s) => s.get(ID));
    if (d && d.key !== key) return;
  }
  await run("readwrite", (s) => s.delete(ID));
}

/** Worth keeping: there's a photo or some words. */
export function draftWorthKeeping(d: { caption: string; photo: Blob | null }) {
  return !!d.photo || d.caption.trim().length > 0;
}
