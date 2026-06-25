import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error" | "offline";

type Options<T> = {
  /** Stable storage key used for the local draft mirror. Pass `null` to disable local draft. */
  key: string | null;
  /** Current value to save. */
  value: T;
  /** Async save function. Throw to mark error. */
  onSave: (value: T) => Promise<void> | void;
  /** Equality check — defaults to JSON.stringify compare. */
  equals?: (a: T, b: T) => boolean;
  /** Debounce in ms (default 800). */
  delay?: number;
  /** Disable autosave entirely (e.g. while focused on a different control). */
  enabled?: boolean;
  /** Fired once when a save has failed N times in a row (default 3). */
  onPermanentFailure?: (info: { value: T; attempt: number; error: unknown }) => void;
  /** Threshold for onPermanentFailure (default 3). */
  permanentFailureAfter?: number;
  /** Hard timeout per save attempt (ms). Defaults to 8000. After this elapses
   * the save is considered failed (no more spinner) and normal retry/backoff
   * kicks in. Set to 0 to disable. */
  timeoutMs?: number;
};

const DRAFT_PREFIX = "lov:draft:";
const defaultEquals = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Manual-save helper. Emergency safety lock 2026-06-25:
 * this hook must not persist anything on value changes, mount, hydration,
 * reconnect, failures, or unmount. Only explicit flush()/retry() calls may
 * write to the backend or local draft storage.
 */
export function useAutosave<T>({
  key,
  value,
  onSave,
  equals = defaultEquals,
  delay = 800,
  enabled = true,
  onPermanentFailure,
  permanentFailureAfter = 3,
  timeoutMs = 8000,
}: Options<T>) {
  const [state, setState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const lastSaved = useRef<T>(value);
  const lastSavedSet = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = useRef(0);
  const pendingValue = useRef<T>(value);
  const inflight = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onPermFailRef = useRef(onPermanentFailure);
  onPermFailRef.current = onPermanentFailure;
  const reportedFailRef = useRef(false);

  // Track online state
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const writeDraft = useCallback((v: T) => {
    if (!key || typeof window === "undefined") return;
    try { window.localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ v, t: Date.now() })); } catch {}
  }, [key]);

  const clearDraft = useCallback(() => {
    if (!key || typeof window === "undefined") return;
    try { window.localStorage.removeItem(DRAFT_PREFIX + key); } catch {}
  }, [key]);

  const doSave = useCallback(async () => {
    if (inflight.current) return;
    const v = pendingValue.current;
    if (lastSavedSet.current && equals(lastSaved.current, v)) {
      setState((s) => (s === "saving" ? "saved" : s));
      return;
    }
    if (!online) {
      setState("offline");
      writeDraft(v);
      return;
    }
    inflight.current = true;
    setState("saving");
    try {
      // Hard timeout — a hung save (e.g. PostgREST stuck on an aborted
      // pooled transaction) must never spin forever. Race the user-provided
      // save against an 8s timeout; the loser still resolves in the
      // background but the UI moves on to the error/retry path.
      if (timeoutMs && timeoutMs > 0) {
        await new Promise<void>((resolve, reject) => {
          let done = false;
          const t = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error("Save timed out — will retry"));
          }, timeoutMs);
          Promise.resolve()
            .then(() => onSaveRef.current(v))
            .then(() => { if (done) return; done = true; clearTimeout(t); resolve(); })
            .catch((e) => { if (done) return; done = true; clearTimeout(t); reject(e); });
        });
      } else {
        await onSaveRef.current(v);
      }
      lastSaved.current = v;
      lastSavedSet.current = true;
      retryAttempt.current = 0;
      reportedFailRef.current = false;
      setSavedAt(Date.now());
      clearDraft();
      // If value changed mid-save, leave it pending for the next explicit
      // Save tap. Never schedule a follow-up write automatically.
      if (!equals(pendingValue.current, v)) {
        setState("idle");
      } else {
        setState("saved");
      }
    } catch (err) {
      console.error("[useAutosave] save failed", err);
      setState("error");
      writeDraft(v);
      // Manual-save mode: never retry in the background. Retrying requires an
      // explicit user action via retry()/flush(). This prevents hydration/page
      // load from repeatedly overwriting workout rows.
      retryAttempt.current = Math.min(retryAttempt.current + 1, 5);
      if (retryAttempt.current >= permanentFailureAfter && !reportedFailRef.current) {
        reportedFailRef.current = true;
        try { onPermFailRef.current?.({ value: v, attempt: retryAttempt.current, error: err }); } catch {}
      }
    } finally {
      inflight.current = false;
    }
  }, [equals, online, writeDraft, clearDraft, permanentFailureAfter, timeoutMs]);

  // Track value changes for explicit manual saves only. Do not persist anything
  // from hydration, typing, unit toggles, reconnects, or refetches.
  useEffect(() => {
    pendingValue.current = value;
    if (!lastSavedSet.current) {
      lastSaved.current = value;
      lastSavedSet.current = true;
      return;
    }
    setState((s) => (s === "saving" || s === "error" || equals(lastSaved.current, value) ? s : "idle"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled]);

  // Establish the synced baseline at mount, regardless of `enabled`. This
  // ensures bulk fills (e.g. "Copy Previous", "Quick Inputs") that flip
  // `enabled` from false→true with populated values are detected as a
  // change vs. the empty mount value and trigger a save — instead of being
  // mistaken for the initial baseline.
  useEffect(() => {
    if (!lastSavedSet.current) {
      lastSaved.current = pendingValue.current;
      lastSavedSet.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconnect must not trigger a save. Users retry manually.
  useEffect(() => {
    if (online && state === "offline") setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // Never flush on unmount; unmount/page-load saves caused workout corruption.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, [doSave, equals]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await doSave();
  }, [doSave]);

  // Stable read of "is there any unsaved change pending right now?". Used by
  // manual Save buttons so they can avoid issuing a second persist() after
  // flush() has already drained the queue.
  const hasPending = useCallback(() => {
    if (!lastSavedSet.current) return false;
    return !equals(lastSaved.current, pendingValue.current);
  }, [equals]);

  /** Adopt the current value as the synced baseline WITHOUT firing a save.
   * Use this when a value-change is purely cosmetic (e.g. KG/LB display
   * conversion) and must not trigger persistence. */
  const markClean = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    lastSaved.current = pendingValue.current;
    lastSavedSet.current = true;
    setState((s) => (s === "saving" ? s : "idle"));
  }, []);

  /** Manual retry for callers showing an error state. */
  const retry = useCallback(() => {
    retryAttempt.current = 0;
    reportedFailRef.current = false;
    void doSave();
  }, [doSave]);

  return { state, savedAt, online, flush, hasPending, markClean, retry };
}

/** Read a previously-saved local draft for the given key. */
export function readLocalDraft<T>(key: string): { value: T; savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { value: parsed.v as T, savedAt: parsed.t as number };
  } catch { return null; }
}

export function clearLocalDraft(key: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(DRAFT_PREFIX + key); } catch {}
}