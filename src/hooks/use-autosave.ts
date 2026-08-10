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
 * Debounced autosave helper with a local draft fallback.
 *
 * Contract for workout rows: callers gate `enabled` while an input is focused;
 * once focus clears, the latest value is saved after `delay`. Failed saves keep
 * the draft locally and retry with backoff so transient backend/network issues
 * do not leave the row permanently stuck.
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
  const enabledRef = useRef(enabled);
  const delayRef = useRef(delay);
  const doSaveRef = useRef<(() => Promise<void>) | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  enabledRef.current = enabled;
  delayRef.current = delay;
  const onPermFailRef = useRef(onPermanentFailure);
  onPermFailRef.current = onPermanentFailure;
  const reportedFailRef = useRef(false);
  // Waiters for flush(). flush() must only resolve after a CONFIRMED write
  // and must reject on failure — otherwise a manual "Save now" click can
  // show a green success state while the save actually failed (the
  // "Saved to X's Program" + "Save failed · retrying" contradiction).
  const flushWaiters = useRef<Array<{ resolve: () => void; reject: (e: unknown) => void }>>([]);
  const settleFlush = useCallback((err?: unknown) => {
    const ws = flushWaiters.current.splice(0);
    for (const w of ws) { if (err) w.reject(err); else w.resolve(); }
  }, []);

  // Auto-clear the "saved" indicator after a short window so the status
  // visibly resets to idle (Pencil/"Unsaved changes" hidden, green check
  // dismissed). Without this the green "Saved" label can linger until the
  // user types again, which reads as "stuck status".
  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => {
      setState((s) => (s === "saved" ? "idle" : s));
    }, 2500);
    return () => clearTimeout(t);
  }, [state, savedAt]);

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

  const scheduleSave = useCallback((ms?: number) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!enabledRef.current) return;
    const wait = Math.max(0, ms ?? delayRef.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void doSaveRef.current?.();
    }, wait);
  }, []);

  const doSave = useCallback(async () => {
    if (!enabledRef.current) { settleFlush(); return; }
    if (inflight.current) {
      // A previous attempt is still in flight — most commonly a TIMED-OUT
      // save whose underlying request is still running in the background.
      // Never drop the save (data loss) and never start a parallel request
      // that could race a stale write over newer data — queue behind it.
      scheduleSave(1500);
      return;
    }
    const v = pendingValue.current;
    if (lastSavedSet.current && equals(lastSaved.current, v)) {
      setState((s) => (s === "saving" ? "saved" : s));
      settleFlush();
      return;
    }
    if (!online) {
      setState("offline");
      writeDraft(v);
      settleFlush(new Error("You're offline — the save will retry when you're back online."));
      return;
    }
    inflight.current = true;
    setState("saving");
    let underlying: Promise<void> | null = null;
    try {
      // Hard timeout — a hung save (e.g. PostgREST stuck on an aborted
      // pooled transaction) must never spin forever. Race the user-provided
      // save against an 8s timeout; the loser still resolves in the
      // background but the UI moves on to the error/retry path.
      if (timeoutMs && timeoutMs > 0) {
        underlying = Promise.resolve().then(() => onSaveRef.current(v));
        await new Promise<void>((resolve, reject) => {
          let done = false;
          const t = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error("Save timed out — will retry"));
          }, timeoutMs);
          underlying!
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
      if (!equals(pendingValue.current, v)) {
        setState("idle");
        scheduleSave(delayRef.current);
      } else {
        setState("saved");
      }
      settleFlush();
    } catch (err) {
      console.error("[useAutosave] save failed", err);
      setState("error");
      writeDraft(v);
      retryAttempt.current = Math.min(retryAttempt.current + 1, 5);
      if (retryAttempt.current >= permanentFailureAfter && !reportedFailRef.current) {
        reportedFailRef.current = true;
        try { onPermFailRef.current?.({ value: v, attempt: retryAttempt.current, error: err }); } catch {}
      }
      const retryDelay = Math.min(30_000, 1000 * 2 ** retryAttempt.current);
      scheduleSave(retryDelay);
      settleFlush(err);
    } finally {
      if (underlying) {
        // Hold the inflight gate until the timed-out request ACTUALLY
        // settles. Releasing it immediately would let the queued retry
        // overlap the background write — the "older failed request
        // overwrote a newer successful save" race. Calls that arrive
        // while the gate is held reschedule instead of being dropped.
        void underlying.catch(() => {}).finally(() => { inflight.current = false; });
      } else {
        inflight.current = false;
      }
    }
  }, [equals, online, writeDraft, clearDraft, permanentFailureAfter, timeoutMs, scheduleSave, settleFlush]);

  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // Track value changes and schedule a save only when the caller says it is
  // safe (`enabled`). Workout rows set enabled=false while an input has focus,
  // so the save fires after the user stops typing AND leaves the field.
  useEffect(() => {
    pendingValue.current = value;
    if (!lastSavedSet.current) {
      lastSaved.current = value;
      lastSavedSet.current = true;
      return;
    }
    const dirty = !equals(lastSaved.current, value);
    if (!dirty) {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      return;
    }
    setState((s) => {
      if (s === "saving") return s;
      return "idle";
    });
    if (!enabled) {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      return;
    }
    scheduleSave(delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled, delay, scheduleSave]);

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

  // Reconnect should retry the latest dirty draft; otherwise a temporary
  // offline state can leave the row stuck until the user edits it again.
  useEffect(() => {
    if (online && state === "offline") {
      setState("idle");
      if (lastSavedSet.current && !equals(lastSaved.current, pendingValue.current)) {
        scheduleSave(0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // Never flush on unmount; unmount/page-load saves caused workout corruption.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, [doSave, equals]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    // Resolve only after a confirmed write; reject when the save fails so
    // callers (manual Save buttons, Finish Workout) surface the truth
    // instead of a false success state.
    const p = new Promise<void>((resolve, reject) => {
      flushWaiters.current.push({ resolve, reject });
    });
    void doSave();
    await p;
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