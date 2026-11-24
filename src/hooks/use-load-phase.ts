import { useCallback, useEffect, useRef, useState } from "react";
import { LOAD_TIMING, loadPhase, nextPhaseAt, type LoadPhase, type LoadTiming } from "@/lib/loading/load-state";

/**
 * Where a wait is (instant → loading → slow → stalled), from the moment
 * `active` turned true. One timer for the next change, never a tick a second,
 * and back to "instant" the moment the wait ends.
 */
export function useLoadPhase(active: boolean, timing: LoadTiming = LOAD_TIMING): LoadPhase {
  const [phase, setPhase] = useState<LoadPhase>("instant");
  const startedAt = useRef<number | null>(null);
  const { showAfterMs, slowAfterMs, stalledAfterMs } = timing;

  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      setPhase("instant");
      return;
    }
    if (startedAt.current == null) startedAt.current = Date.now();
    const t = { showAfterMs, slowAfterMs, stalledAfterMs };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const step = () => {
      const elapsed = Date.now() - (startedAt.current ?? Date.now());
      setPhase(loadPhase(elapsed, t));
      const next = nextPhaseAt(elapsed, t);
      if (next != null) timer = setTimeout(step, Math.max(16, next - elapsed));
    };
    step();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [active, showAfterMs, slowAfterMs, stalledAfterMs]);

  return active ? phase : "instant";
}

/** True once `active` has stayed true for `ms`: a loader that never flashes for an instant answer. */
export function useShowAfter(active: boolean, ms: number = LOAD_TIMING.showAfterMs): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return active && shown;
}

/** Milliseconds since `active` turned true, updated every `tickMs` while it stays true (for long work). */
export function useElapsed(active: boolean, opts: { since?: number | null; tickMs?: number } = {}): number {
  const { since, tickMs = 1000 } = opts;
  const startedAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      return;
    }
    if (startedAt.current == null) startedAt.current = Date.now();
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [active, tickMs]);
  if (!active) return 0;
  const from = since ?? startedAt.current ?? now;
  return Math.max(0, now - from);
}

/**
 * One run at a time for an async action, decided before the first await: a
 * second tap, Enter key or double click while it runs does nothing. `pending`
 * drives the button's loading state; the guard itself is a ref, so it holds
 * even before React re-renders.
 */
export function useSingleFlight<A extends unknown[], R>(fn: (...args: A) => Promise<R> | R) {
  const inflight = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (inflight.current) return undefined;
    inflight.current = true;
    setPending(true);
    try {
      return await fnRef.current(...args);
    } finally {
      inflight.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);
  return { run, pending };
}

/**
 * `useSingleFlight` for a list of things (a menu per row, a button per sale):
 * one run per key at a time, guarded before the first await, with `isBusy(key)`
 * for the item's own loading state. Different keys run side by side.
 */
export function useKeyedSingleFlight() {
  const inflight = useRef(new Set<string>());
  const mounted = useRef(true);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const run = useCallback(async <R,>(key: string, fn: () => Promise<R> | R): Promise<R | undefined> => {
    if (inflight.current.has(key)) return undefined;
    inflight.current.add(key);
    setBusy(new Set(inflight.current));
    try {
      return await fn();
    } finally {
      inflight.current.delete(key);
      if (mounted.current) setBusy(new Set(inflight.current));
    }
  }, []);
  const isBusy = useCallback((key: string) => busy.has(key), [busy]);
  return { run, isBusy, anyBusy: busy.size > 0 };
}
