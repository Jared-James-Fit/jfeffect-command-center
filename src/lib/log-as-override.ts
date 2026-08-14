/**
 * Per-row client-side "Log As" override + adjustable timer target.
 *
 * A coach prescribes a row as Time or Reps in the builder. The client can
 * flip how they LOG it (e.g. a plank logged as reps, or a rep row they'd
 * rather time) without mutating the coach's prescription. The choice is
 * remembered per exercise row on the device only.
 */

export type LogAsMode = "reps" | "time";

const MODE_KEY = (rowId: string) => `jf.logas.mode.${rowId}`;
const TARGET_KEY = (rowId: string) => `jf.logas.target.${rowId}`;

function safeGet(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function getLogAsMode(rowId: string): LogAsMode | null {
  const raw = safeGet(MODE_KEY(rowId));
  return raw === "reps" || raw === "time" ? raw : null;
}

export function setLogAsMode(rowId: string, mode: LogAsMode | null) {
  safeSet(MODE_KEY(rowId), mode);
}

export function getTimerTarget(rowId: string): number | null {
  const raw = safeGet(TARGET_KEY(rowId));
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function setTimerTarget(rowId: string, seconds: number | null) {
  safeSet(TARGET_KEY(rowId), seconds && seconds > 0 ? String(Math.round(seconds)) : null);
}
