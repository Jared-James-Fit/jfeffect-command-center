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
};

const DRAFT_PREFIX = "lov:draft:";
const defaultEquals = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Generic debounced autosave with local-draft mirror, offline queueing,
 * and exponential-backoff retry. Never disrupts typing — value is owned
 * by the caller; this hook only schedules background saves when it changes.
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
      await onSaveRef.current(v);
      lastSaved.current = v;
      lastSavedSet.current = true;
      retryAttempt.current = 0;
      setSavedAt(Date.now());
      clearDraft();
      // If value changed mid-save, schedule another
      if (!equals(pendingValue.current, v)) {
        setState("idle");
        schedule();
      } else {
        setState("saved");
      }
    } catch (err) {
      console.error("[useAutosave] save failed", err);
      setState("error");
      writeDraft(v);
      // exponential backoff retry
      retryAttempt.current = Math.min(retryAttempt.current + 1, 5);
      const backoff = Math.min(1000 * 2 ** (retryAttempt.current - 1), 15000);
      setTimeout(() => { void doSave(); }, backoff);
      if (retryAttempt.current >= permanentFailureAfter && !reportedFailRef.current) {
        reportedFailRef.current = true;
        try { onPermFailRef.current?.({ value: v, attempt: retryAttempt.current, error: err }); } catch {}
      }
    } finally {
      inflight.current = false;
    }
  }, [equals, online, writeDraft, clearDraft, permanentFailureAfter]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void doSave(); }, delay);
  }, [doSave, delay]);

  // Schedule whenever value changes
  useEffect(() => {
    pendingValue.current = value;
    if (!enabled) return;
    if (!lastSavedSet.current) {
      // Treat the very first value as the synced baseline; don't fire on mount.
      lastSaved.current = value;
      lastSavedSet.current = true;
      return;
    }
    if (equals(lastSaved.current, value)) return;
    writeDraft(value);
    setState((s) => (s === "saving" ? s : "idle"));
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled]);

  // Retry when back online
  useEffect(() => {
    if (online && state === "offline") schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // Flush on unmount if pending
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (!equals(lastSaved.current, pendingValue.current)) {
      // Best-effort fire-and-forget; we can't await in cleanup
      void doSave();
    }
  }, [doSave, equals]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await doSave();
  }, [doSave]);

  return { state, savedAt, online, flush };
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