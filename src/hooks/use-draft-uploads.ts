// Composer media that uploads in the background the moment it's picked.
//
// Previously the composer awaited every upload before Send became tappable,
// so a 60 MB phone video locked the chat for a minute. Drafts start uploading
// immediately, Send stays live, and the caller awaits `draft.done` only for
// the drafts it actually sends (see `take()`).
//
// Progress lives in a tiny external store instead of React state so a
// progress tick re-renders only the chip/badge showing it, not the whole
// thread (XHR fires progress events many times per second).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type DraftUploadKind = "image" | "video" | "audio" | "file";

export type DraftUpload<A> = {
  id: string;
  file: File;
  name: string;
  kind: DraftUploadKind;
  /** Local object URL (thumbnails + the optimistic bubble). Revoke via `releaseDraft`. */
  previewUrl?: string;
  /** Resolves with the uploaded attachment; rejects on failure/abort. */
  done: Promise<A>;
  abort: () => void;
};

type UploadFn<A> = (file: File, onProgress: (pct: number) => void, signal: AbortSignal) => Promise<A>;

const MAX_PARALLEL = 2;

/**
 * Runs at most `maxParallel` uploads at once (phones choke on more) and
 * rejects queued tasks whose signal was aborted without ever starting them.
 */
export function createUploadQueue(maxParallel = MAX_PARALLEL) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const pump = () => {
    while (active < maxParallel && waiting.length) {
      active++;
      waiting.shift()!();
    }
  };
  return {
    run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          const settle = () => { active--; pump(); };
          if (signal.aborted) {
            settle();
            reject(new Error("Upload cancelled."));
            return;
          }
          task().then(resolve, reject).finally(settle);
        });
        pump();
      });
    },
  };
}

export class ProgressStore {
  private pct = new Map<string, number>();
  private subs = new Set<() => void>();
  set(id: string, pct: number) {
    const next = Math.max(0, Math.min(100, Math.round(pct)));
    if ((this.pct.get(id) ?? -1) >= next) return; // monotonic, and skips duplicate ticks
    this.pct.set(id, next);
    this.subs.forEach((fn) => fn());
  }
  get(id: string) {
    return this.pct.get(id) ?? 0;
  }
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };
}

export type DraftProgressStore = ProgressStore;

/** Average upload % across `ids` (0–100). Re-renders only the caller. */
export function useDraftProgress(store: DraftProgressStore, ids: string[]): number {
  const key = ids.join("|");
  const read = useCallback(() => {
    if (!ids.length) return 100;
    return Math.round(ids.reduce((sum, id) => sum + store.get(id), 0) / ids.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key]);
  return useSyncExternalStore(store.subscribe, read, read);
}

function kindOf(file: File): DraftUploadKind {
  const m = (file.type || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}

export function releaseDraft(d: Pick<DraftUpload<unknown>, "previewUrl">) {
  if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
}

export function useDraftUploads<A>() {
  const [drafts, setDrafts] = useState<DraftUpload<A>[]>([]);
  const draftsRef = useRef<DraftUpload<A>[]>([]);
  draftsRef.current = drafts;
  const [store] = useState(() => new ProgressStore());
  const [queue] = useState(() => createUploadQueue());

  const remove = useCallback((id: string) => {
    draftsRef.current = draftsRef.current.filter((d) => d.id !== id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  /** Start uploading `files` now. `upload` is bound per call so it always sees the current thread. */
  const add = useCallback((files: File[], upload: UploadFn<A>, onError?: (d: DraftUpload<A>, e: unknown) => void) => {
    if (!files.length) return;
    const created: DraftUpload<A>[] = files.map((file) => {
      const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const kind = kindOf(file);
      const controller = new AbortController();
      const previewUrl = URL.createObjectURL(file);
      store.set(id, 1);
      const done = queue.run(async () => {
        const res = await upload(file, (pct) => store.set(id, Math.min(99, pct)), controller.signal);
        store.set(id, 100);
        return res;
      }, controller.signal);
      const draft: DraftUpload<A> = {
        id, file, name: file.name, kind, previewUrl, done,
        abort: () => controller.abort(),
      };
      // Failures are surfaced to whoever owns the draft at the time: the
      // composer (still a chip) or doSend (already queued in a bubble).
      done.catch((e) => {
        if (controller.signal.aborted) return;
        if (draftsRef.current.some((d) => d.id === id)) {
          remove(id);
          releaseDraft(draft);
          onError?.(draft, e);
        }
      });
      return draft;
    });
    // Keep the ref ahead of the render so an immediate take() sees them.
    draftsRef.current = [...draftsRef.current, ...created];
    setDrafts((prev) => [...prev, ...created]);
  }, [queue, remove, store]);

  /** User removed a chip: stop the upload and drop it. */
  const cancel = useCallback((id: string) => {
    const d = draftsRef.current.find((x) => x.id === id);
    if (!d) return;
    d.abort();
    releaseDraft(d);
    remove(id);
  }, [remove]);

  /** Hand all current drafts to the sender. Uploads keep running; the caller owns them now. */
  const take = useCallback((): DraftUpload<A>[] => {
    const taken = draftsRef.current;
    draftsRef.current = [];
    setDrafts([]);
    return taken;
  }, []);

  /** Abort and drop everything still in the composer (e.g. switching conversations). */
  const reset = useCallback(() => {
    for (const d of draftsRef.current) { d.abort(); releaseDraft(d); }
    draftsRef.current = [];
    setDrafts([]);
  }, []);

  useEffect(() => () => {
    for (const d of draftsRef.current) { d.abort(); releaseDraft(d); }
  }, []);

  return { drafts, add, cancel, take, reset, store };
}
