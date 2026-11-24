/**
 * The unit analytics shows weights in: one choice for every analytics screen
 * (the page, the Workouts progress card), remembered on this phone for the
 * person looking (`jf-analytics-unit`), starting from the athlete's own unit
 * until they pick. Only what's shown changes: nothing stored is converted,
 * and the big totals always show the other unit beside it.
 */
import { useCallback, useEffect, useState } from "react";
import type { Unit } from "@/lib/analytics/units";

const KEY = "jf-analytics-unit";
const EVENT = "jf-analytics-unit-change";

function read(): Unit | null {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    return v === "kg" || v === "lb" ? v : null;
  } catch {
    return null;
  }
}

export function useAnalyticsUnit(fallback: Unit): [Unit, (u: Unit) => void] {
  const [picked, setPicked] = useState<Unit | null>(() => read());
  useEffect(() => {
    const on = () => setPicked(read());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  const set = useCallback((u: Unit) => {
    try {
      window.localStorage.setItem(KEY, u);
    } catch {
      /* private mode: it still changes for this visit */
    }
    setPicked(u);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [picked ?? fallback, set];
}
