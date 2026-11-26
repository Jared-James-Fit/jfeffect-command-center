/**
 * The setup sheet's autosave (pure timing, tested in setup-autosave.test.ts):
 * a change is sent a moment after typing pauses (or at once on `flush`, when
 * the sheet closes, switches equipment or the app goes to the background),
 * one save at a time, always the newest version, never a version that's
 * already saved. A save that fails is tried again by itself (a few seconds,
 * then longer); what it was trying to send stays the newest version until it
 * goes through.
 *
 * The sheet decides what a version is (the draft's stored form, formKey);
 * this only decides when, and in what order, it's sent.
 */

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export type Autosave<T> = {
  /** A new version (after a change). Saved `delay` ms after the last one unless flushed. */
  change: (value: T, key: string) => void;
  /** Send the newest version now; resolves true once everything up to now is saved. */
  flush: () => Promise<boolean>;
  /** What's saved now (after a load or a restore): later changes are compared with it. */
  reset: (key: string) => void;
  /** Stop: no more timers or retries (what's pending is left for the outbox). */
  dispose: () => void;
  /** Whether a version is waiting or on its way. */
  busy: () => boolean;
  status: () => AutosaveStatus;
  /** The version waiting to be sent (null: nothing waiting). */
  pending: () => { value: T; key: string } | null;
};

export const AUTOSAVE_DELAY_MS = 700;
/** Waits before trying a failed save again. */
export const RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const;

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
};

const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (t) => globalThis.clearTimeout(t as ReturnType<typeof setTimeout>),
};

export function createAutosave<T>({
  save,
  savedKey,
  delay = AUTOSAVE_DELAY_MS,
  onStatus,
  onError,
  timers = realTimers,
}: {
  save: (value: T) => Promise<void>;
  /** The key of what's saved now. */
  savedKey: string;
  delay?: number;
  onStatus?: (s: AutosaveStatus) => void;
  /** Each failed try (the sheet keeps the change on the phone meanwhile). */
  onError?: (e: unknown, tries: number) => void;
  timers?: Timers;
}): Autosave<T> {
  let saved = savedKey;
  let waiting: { value: T; key: string } | null = null;
  let inFlight: Promise<boolean> | null = null;
  let timer: unknown = null;
  let retryTimer: unknown = null;
  let tries = 0;
  let status: AutosaveStatus = "idle";
  let disposed = false;
  let flushers: Array<(ok: boolean) => void> = [];

  const set = (s: AutosaveStatus) => {
    if (status === s) return;
    status = s;
    onStatus?.(s);
  };
  const clear = () => {
    if (timer != null) timers.clearTimeout(timer);
    timer = null;
  };
  const clearRetry = () => {
    if (retryTimer != null) timers.clearTimeout(retryTimer);
    retryTimer = null;
  };
  const settle = (ok: boolean) => {
    const f = flushers;
    flushers = [];
    for (const r of f) r(ok);
  };

  const run = (): Promise<boolean> => {
    if (inFlight) return inFlight;
    clear();
    clearRetry();
    const next = waiting;
    if (!next || next.key === saved) {
      waiting = null;
      if (status === "pending" || status === "error") set("saved");
      settle(true);
      return Promise.resolve(true);
    }
    set("saving");
    inFlight = (async () => {
      try {
        await save(next.value);
        saved = next.key;
        tries = 0;
        if (waiting && waiting.key === next.key) waiting = null;
        return true;
      } catch (e) {
        tries += 1;
        onError?.(e, tries);
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight.then((ok) => {
      if (disposed) {
        settle(ok);
        return ok;
      }
      if (!ok) {
        set("error");
        // try again by itself; a flush (or a new change) tries sooner
        const wait = RETRY_MS[Math.min(tries - 1, RETRY_MS.length - 1)];
        retryTimer = timers.setTimeout(() => {
          retryTimer = null;
          void run();
        }, wait);
        settle(false);
        return false;
      }
      if (waiting && waiting.key !== saved) {
        // typed more while it was on its way: send that too
        return run();
      }
      waiting = null;
      set("saved");
      settle(true);
      return true;
    });
  };

  return {
    change(value, key) {
      if (disposed) return;
      if (key === saved && !inFlight) {
        waiting = null;
        clear();
        if (status === "pending" || status === "error") set("saved");
        return;
      }
      waiting = { value, key };
      if (!inFlight) set("pending");
      clear();
      timer = timers.setTimeout(() => {
        timer = null;
        void run();
      }, delay);
    },
    flush() {
      if (disposed) return Promise.resolve(!waiting);
      clear();
      if (!waiting && !inFlight) return Promise.resolve(status !== "error");
      return new Promise<boolean>((resolve) => {
        flushers.push(resolve);
        void run();
      });
    },
    reset(key) {
      saved = key;
      waiting = null;
      tries = 0;
      clear();
      clearRetry();
      // nothing waiting: a "Saved" a moment ago stays (it was); anything else is quiet
      if (!inFlight && status !== "saved") set("idle");
    },
    dispose() {
      disposed = true;
      clear();
      clearRetry();
    },
    busy: () => !!waiting || !!inFlight,
    status: () => status,
    pending: () => waiting,
  };
}
