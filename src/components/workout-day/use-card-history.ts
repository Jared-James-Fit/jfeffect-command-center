import { useCallback, useEffect, useRef, useState } from "react";
import {
  canResetTo,
  record,
  resetTarget,
  snapshotKey,
  stepBack,
  stepForward,
  type CardHistory,
  type CardSnapshot,
} from "@/lib/card-history";

/** Typing a set is many saves; a change counts as one step once it has sat this long. */
const SETTLE_MS = 1200;

type Entry = { history: CardHistory; origin: number };
/**
 * Per card, for this app load: survives the card remounting (moving it,
 * collapsing the workout) but not a reload — undo is for "I just did that".
 */
const store = new Map<string, Entry>();

export type CardHistoryAction = "undo" | "redo" | "reset";

/**
 * Undo / redo / reset for one exercise card. Watches the card's logged state
 * (`snapshot`, only while `ready` — server data settled, nothing in flight)
 * and turns each settled change into a step. `apply` writes a snapshot back
 * and resolves once it's saved and refetched.
 */
export function useCardHistory({
  storeKey,
  snapshot,
  ready,
  apply,
}: {
  storeKey: string;
  snapshot: CardSnapshot;
  ready: boolean;
  apply: (target: CardSnapshot, current: CardSnapshot) => Promise<void>;
}) {
  const key = snapshotKey(snapshot);
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  // The latest render's writer (it reads the card's current rows), so a
  // toast's Undo tapped later still writes against what's there now.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const [entry, setEntryState] = useState<Entry | null>(() => store.get(storeKey) ?? null);
  const entryRef = useRef(entry);
  const setEntry = useCallback((e: Entry) => {
    entryRef.current = e;
    store.set(storeKey, e);
    setEntryState(e);
  }, [storeKey]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Make a change that hasn't settled yet a step now (so Undo undoes it). */
  const settle = useCallback((): Entry | null => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const e = entryRef.current;
    if (!e?.history.present) return e;
    const history = record(e.history, snapRef.current);
    if (history === e.history) return e;
    const next = { ...e, history };
    setEntry(next);
    return next;
  }, [setEntry]);

  useEffect(() => {
    if (!ready || busy) return;
    const e = entryRef.current;
    if (!e?.history.present) {
      // First settled look at the card: the baseline, and the set count Reset returns to.
      setEntry({ history: { past: [], present: snapRef.current, future: [] }, origin: e?.origin ?? snapRef.current.setCount });
      return;
    }
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (snapshotKey(e.history.present) === key) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!busyRef.current) settle();
    }, SETTLE_MS);
  }, [ready, busy, key, settle, setEntry]);

  // Leaving mid-change: keep the step for when the card comes back.
  useEffect(() => () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    const e = entryRef.current;
    if (e?.history.present) store.set(storeKey, { ...e, history: record(e.history, snapRef.current) });
  }, [storeKey]);

  const run = useCallback(async (action: CardHistoryAction): Promise<boolean> => {
    if (busyRef.current) return false;
    const e = settle();
    if (!e?.history.present) return false;
    let target: CardSnapshot;
    let history: CardHistory;
    if (action === "reset") {
      if (!canResetTo(snapRef.current, e.origin)) return false;
      target = resetTarget(e.origin);
      history = record(e.history, target);
    } else {
      const step = action === "undo" ? stepBack(e.history) : stepForward(e.history);
      if (!step) return false;
      ({ target, history } = step);
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await applyRef.current(target, snapRef.current);
      setEntry({ ...e, history });
      return true;
    } catch (err) {
      // Some writes may have landed: start again from whatever is there now.
      setEntry({ origin: e.origin, history: { past: [], present: null, future: [] } });
      throw err;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [settle, setEntry]);

  const present = entry?.history.present ?? null;
  const unsettled = !!present && snapshotKey(present) !== key;
  return {
    busy,
    canUndo: !!present && ((entry?.history.past.length ?? 0) > 0 || unsettled),
    canRedo: !!present && !unsettled && (entry?.history.future.length ?? 0) > 0,
    canReset: !!entry && !!present && canResetTo(snapshot, entry.origin),
    run,
  };
}

/** Test seam: forget every card's history. */
export function clearCardHistories() {
  store.clear();
}
