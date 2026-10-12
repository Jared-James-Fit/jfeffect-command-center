import { useSyncExternalStore } from "react";

/**
 * Whether exercise cards show the suggested-load card (range + fast/slow
 * audible). Off by default to keep the logger clean. The "Suggest" chip on any
 * exercise card flips every card at once; remembered on this device (a UI
 * preference, not data).
 */
const KEY = "jf.workout.showLoadSuggestions";
const listeners = new Set<() => void>();
let current: boolean | null = null;

function read(): boolean {
  if (current != null) return current;
  try {
    current = typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
  } catch {
    current = false;
  }
  return current;
}

export function setShowLoadSuggestions(next: boolean) {
  current = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* private mode / blocked storage: still works for this session */
  }
  listeners.forEach((l) => l());
}

export function useShowLoadSuggestions(): [boolean, (next: boolean) => void] {
  const show = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => false,
  );
  return [show, setShowLoadSuggestions];
}

/** feature_announcement_views key: the athlete has turned suggestions on at least once. */
export const LOAD_SUGGESTIONS_TRIED_KEY = "load_suggestions_tried";

// "Not now" on the try-it nudge lasts until the app is reloaded (module state),
// so it comes back on the next launch only while it was never tried.
let nudgeDismissed = false;
export function suggestionsNudgeDismissed(): boolean {
  return nudgeDismissed;
}
export function dismissSuggestionsNudgeForNow() {
  nudgeDismissed = true;
}
