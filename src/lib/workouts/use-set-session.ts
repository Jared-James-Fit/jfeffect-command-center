import { useSyncExternalStore } from "react";
import { setSessionsVersion, subscribeSetSessions } from "@/lib/workouts/set-session";

/** Re-renders whenever a card's added / skipped sets change (set-session.ts). */
export function useSetSessionsVersion(): number {
  return useSyncExternalStore(subscribeSetSessions, setSessionsVersion, setSessionsVersion);
}
