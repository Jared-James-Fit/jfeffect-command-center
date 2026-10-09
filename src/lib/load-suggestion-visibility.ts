import { useSyncExternalStore } from "react";

/**
 * Whether exercise cards show the full suggested-load card (range + fast/slow
 * audible). Off by default to keep the logger clean — the suggested weight
 * still sits faded in the next set's weight cell. One toggle at the top of the
 * workout flips every card at once; remembered on this device (a UI
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
