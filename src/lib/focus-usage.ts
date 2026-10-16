import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WorkoutView } from "@/lib/use-workout-view";

/**
 * Is Focus useful? Per person per workout (workout_view_sessions): time on
 * screen in each view, sets logged in each, switches, the view it opened in and
 * the one it was finished in. The app keeps a running tally and sends only
 * what's new (workout_view_session_add adds it up server-side), batched: 20s
 * after a change, and right away on a switch, a finish, leaving the workout or
 * the app going to the background. A failed send stays in the tally for the
 * next one. A coach's "View as client" is never counted.
 */

const db = supabase as any;
const BATCH_MS = 20_000;

export type FocusTally = {
  focusMs: number;
  listMs: number;
  setsFocus: number;
  setsList: number;
  toFocus: number;
  toList: number;
  openedIn: WorkoutView | null;
  finishedIn: WorkoutView | null;
};

export const emptyTally = (): FocusTally => ({
  focusMs: 0, listMs: 0, setsFocus: 0, setsList: 0, toFocus: 0, toList: 0, openedIn: null, finishedIn: null,
});

/** Nothing worth a request (under a second on screen and nothing else). */
export function tallyIsEmpty(t: FocusTally): boolean {
  return t.focusMs + t.listMs < 1000 && !t.setsFocus && !t.setsList && !t.toFocus && !t.toList && !t.finishedIn;
}

/** Sets logged since the last look, credited to the view on screen (an un-tick never subtracts). */
export function creditSets(t: FocusTally, view: WorkoutView, before: number | null, now: number): number {
  if (before != null && now > before) {
    if (view === "story") t.setsFocus += now - before;
    else t.setsList += now - before;
  }
  return now;
}

export function useFocusUsage({
  enabled,
  dayId,
  clientId,
  view,
  ready,
  setsDone,
  finished,
}: {
  enabled: boolean;
  dayId: string;
  clientId: string | null;
  view: WorkoutView;
  /** The workout's exercises and logged sets have loaded. */
  ready: boolean;
  /** Sets logged in this workout so far. */
  setsDone: number;
  finished: boolean;
}) {
  const tally = useRef<FocusTally>(emptyTally());
  const viewRef = useRef<WorkoutView>(view);
  const since = useRef<number | null>(null);
  const setsSeen = useRef<number | null>(null);
  const wasFinished = useRef<boolean | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const sending = useRef(false);
  // opened already finished (just looking back at it): not counted
  const off = useRef(false);
  const live = useRef({ enabled, dayId, clientId });
  live.current = { enabled, dayId, clientId };

  const clock = () => {
    if (since.current == null) return;
    const now = Date.now();
    if (viewRef.current === "story") tally.current.focusMs += now - since.current;
    else tally.current.listMs += now - since.current;
    since.current = typeof document !== "undefined" && document.visibilityState === "hidden" ? null : now;
  };

  const send = async () => {
    window.clearTimeout(timer.current);
    if (!live.current.enabled || off.current || sending.current) return;
    clock();
    const t = tally.current;
    if (tallyIsEmpty(t)) return;
    tally.current = { ...emptyTally(), openedIn: null };
    sending.current = true;
    try {
      const { error } = await db.rpc("workout_view_session_add", {
        _day_id: live.current.dayId,
        _client_id: live.current.clientId,
        _opened_in: t.openedIn,
        _focus_ms: Math.round(t.focusMs),
        _list_ms: Math.round(t.listMs),
        _sets_focus: t.setsFocus,
        _sets_list: t.setsList,
        _to_focus: t.toFocus,
        _to_list: t.toList,
        _finished_in: t.finishedIn,
      });
      if (error) throw error;
    } catch {
      // keep it for the next send
      const n = tally.current;
      tally.current = {
        focusMs: n.focusMs + t.focusMs, listMs: n.listMs + t.listMs,
        setsFocus: n.setsFocus + t.setsFocus, setsList: n.setsList + t.setsList,
        toFocus: n.toFocus + t.toFocus, toList: n.toList + t.toList,
        openedIn: t.openedIn ?? n.openedIn, finishedIn: n.finishedIn ?? t.finishedIn,
      };
    } finally {
      sending.current = false;
    }
  };
  const sendSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void send(), BATCH_MS);
  };

  // Start once the workout is on screen: which view it opened in, and the sets already there.
  useEffect(() => {
    if (!enabled || !ready || since.current != null || setsSeen.current != null) return;
    if (finished) off.current = true;
    viewRef.current = view;
    tally.current.openedIn = view;
    setsSeen.current = setsDone;
    wasFinished.current = finished;
    since.current = document.visibilityState === "hidden" ? null : Date.now();
  }, [enabled, ready, view, setsDone, finished]);

  // A switch: close the time on the old view, count it, send.
  useEffect(() => {
    if (!enabled || setsSeen.current == null || view === viewRef.current) return;
    clock();
    viewRef.current = view;
    if (view === "story") tally.current.toFocus += 1;
    else tally.current.toList += 1;
    void send();
  }, [enabled, view]);

  // Sets logged go to the view they were logged in.
  useEffect(() => {
    if (!enabled || setsSeen.current == null) return;
    const before = setsSeen.current;
    setsSeen.current = creditSets(tally.current, viewRef.current, before, setsDone);
    if (setsDone > before) sendSoon();
  }, [enabled, setsDone]);

  // Finished here.
  useEffect(() => {
    if (!enabled || wasFinished.current == null) return;
    if (finished && !wasFinished.current) {
      tally.current.finishedIn = viewRef.current;
      void send();
    }
    wasFinished.current = finished;
  }, [enabled, finished]);

  // The app to the background (or back), and leaving the workout.
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void send();
      else if (since.current == null && setsSeen.current != null) since.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void send();
    };
  }, [enabled, dayId]);
}

/** Renders nothing: the tally for one workout (lives in the page's tree, so it starts and stops with it). */
export function FocusUsageTracker(props: Parameters<typeof useFocusUsage>[0]) {
  useFocusUsage(props);
  return null;
}
