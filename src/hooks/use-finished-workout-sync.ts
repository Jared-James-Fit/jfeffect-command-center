/**
 * A finished workout edited in the logger: once the edits settle, the server
 * brings everything that copied its numbers at Finish back in step
 * (syncFinishedWorkout: the stored count, logged % and "fully logged", the set
 * videos' captions) and every screen that reads logged sets is marked stale
 * (refreshWorkoutData), so the recap, Workouts, records, analytics and
 * Rankings read the new numbers the next time they're on screen.
 *
 * Only edits count: the signature of the workout's sets and set counts when it
 * was first on screen (or when it was finished here) is the baseline, so just
 * opening an old workout never rewrites anything. The app going to the
 * background or `flush()` (Done, View score) sends what's waiting at once, and
 * leaving an edited workout sends one more a moment later, once whatever was
 * saving on the way out has landed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { syncFinishedWorkout } from "@/lib/workout-completion.functions";
import { refreshWorkoutData, workoutEditSignature } from "@/lib/workout-data-refresh";

/** How long after the last change the sync waits (a fill-down saves several sets in a burst). */
export const FINISHED_SYNC_DELAY_MS = 1500;
/**
 * After leaving an edited workout, one more sync this long after: a number
 * typed and committed on the way out (Done, Back) saves after the page has
 * gone, and the server reads whatever has landed by then. Idempotent: in
 * step, it writes nothing.
 */
export const FINISHED_SYNC_AFTER_LEAVE_MS = 1500;

export type FinishedSyncState = "idle" | "pending" | "syncing" | "synced" | "error";

type Opts = {
  /** A finished client workout whose sets and exercises are loaded and not mid-fetch. */
  enabled: boolean;
  dayId: string;
  scheduledWorkoutId: string | null;
  /** The athlete (a coach viewing as them passes their id). */
  clientId: string | null;
  rows: readonly any[];
  results: readonly any[];
  /** Finish's fallback weight total for this workout, worked out from the sets on screen. */
  sessionWeight: () => { total: number | null; unit: "kg" | "lb" | null };
  /**
   * Edit workout is on: leaving always sends a last sync (a number typed on the
   * way out can land after the page has gone, before the sets on screen show it).
   */
  syncOnLeave?: boolean;
};

export function useFinishedWorkoutSync(opts: Opts): {
  state: FinishedSyncState;
  flush: () => Promise<void>;
} {
  const qc = useQueryClient();
  const syncFn = useServerFn(syncFinishedWorkout);
  const [state, setState] = useState<FinishedSyncState>("idle");
  const baseline = useRef<string | null>(null);
  const dirty = useRef(false);
  /** The workout edited on this visit (decides the sync after leaving it). */
  const touched = useRef(false);
  const edited = useRef<Opts | null>(null);
  /** A sync went through on this visit. */
  const synced = useRef(false);
  const timer = useRef<number | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const syncRef = useRef(syncFn);
  syncRef.current = syncFn;

  const send = useCallback((o: Opts, withWeight: boolean) => {
    const weight = withWeight ? o.sessionWeight() : null;
    return syncRef.current({
      data: {
        workouts: [{ dayId: o.dayId, scheduledWorkoutId: o.scheduledWorkoutId }],
        ...(weight ? { sessionWeightTotal: weight.total, sessionWeightUnit: weight.unit } : {}),
        clientId: o.clientId,
      },
    });
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) {
      await running.current;
      if (!dirty.current) return;
    }
    if (!dirty.current) return;
    dirty.current = false;
    const o = latest.current;
    const sig = workoutEditSignature(o.rows as any[], o.results as any[]);
    // the sets settled back to what they were (a value put back, a copy on the
    // phone that briefly differed from the database): nothing to send
    if (sig === baseline.current) {
      setState((s) => (s === "pending" ? (synced.current ? "synced" : "idle") : s));
      return;
    }
    setState("syncing");
    const p = (async () => {
      try {
        await send(o, true);
        baseline.current = sig;
        synced.current = true;
        await refreshWorkoutData(qc, { dayId: o.dayId });
        setState(dirty.current ? "pending" : "synced");
      } catch (err) {
        console.warn("[finished-workout-sync] failed", err);
        // tried again on the next change, on Done or on leaving
        dirty.current = true;
        setState("error");
      }
    })();
    running.current = p;
    try {
      await p;
    } finally {
      if (running.current === p) running.current = null;
    }
  }, [qc, send]);

  // One workout at a time: a different one on screen (or leaving) closes this
  // one off with a last sync when it was edited, a moment after it's gone.
  useEffect(() => {
    baseline.current = null;
    dirty.current = false;
    touched.current = false;
    synced.current = false;
    setState("idle");
    const forDay = opts.dayId;
    const forInstance = opts.scheduledWorkoutId;
    return () => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      // what was edited, else (Edit workout on) this workout as last on screen; never the next one's
      const cur = latest.current;
      const sameWorkout = cur.dayId === forDay && cur.scheduledWorkoutId === forInstance;
      const o = edited.current ?? (cur.syncOnLeave && sameWorkout ? cur : null);
      if (!o || !(touched.current || o.syncOnLeave)) return;
      touched.current = false;
      dirty.current = false;
      edited.current = null;
      window.setTimeout(() => {
        // the fallback weight total is left as the last sync wrote it (the sets on screen are gone)
        void send(o, false)
          .then(() => refreshWorkoutData(qc, { dayId: o.dayId }))
          .catch((err) => console.warn("[finished-workout-sync] after leaving", err));
      }, FINISHED_SYNC_AFTER_LEAVE_MS);
    };
  }, [opts.dayId, opts.scheduledWorkoutId, qc, send]);

  const signature = opts.enabled
    ? workoutEditSignature(opts.rows as any[], opts.results as any[])
    : null;
  useEffect(() => {
    if (signature == null) return;
    if (baseline.current == null) {
      baseline.current = signature;
      return;
    }
    if (signature === baseline.current) {
      // back to what it was before anything was sent: no edit after all
      if (timer.current != null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      if (dirty.current) {
        dirty.current = false;
        if (!synced.current) touched.current = false;
        setState((s) => (s === "pending" ? (synced.current ? "synced" : "idle") : s));
      }
      return;
    }
    dirty.current = true;
    touched.current = true;
    edited.current = latest.current;
    setState((s) => (s === "syncing" ? s : "pending"));
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(), FINISHED_SYNC_DELAY_MS);
  }, [signature, run]);

  // the app going to the background sends what's waiting (iOS may not bring it back)
  useEffect(() => {
    const away = () => {
      if (dirty.current) void run();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") away();
    };
    window.addEventListener("pagehide", away);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", away);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [run]);

  const flush = useCallback(async () => {
    await run();
  }, [run]);

  return { state, flush };
}
