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
const INPUTS_KEY = (rowId: string) => `jf.logas.inputs.${rowId}`;

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

/**
 * Which set inputs are shown for this exercise row. Undefined entries fall
 * back to the coach's prescription — this only records explicit client
 * choices made through the input-type dropdown.
 */
export type RowInputOverrides = { reps?: boolean; weight?: boolean; timer?: boolean };

export function getRowInputs(rowId: string): RowInputOverrides {
  const raw = safeGet(INPUTS_KEY(rowId));
  if (!raw) return {};
  try {
    const p = JSON.parse(raw) as RowInputOverrides;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

export function setRowInputs(rowId: string, inputs: RowInputOverrides) {
  const clean: RowInputOverrides = {};
  if (typeof inputs.reps === "boolean") clean.reps = inputs.reps;
  if (typeof inputs.weight === "boolean") clean.weight = inputs.weight;
  if (typeof inputs.timer === "boolean") clean.timer = inputs.timer;
  safeSet(INPUTS_KEY(rowId), Object.keys(clean).length ? JSON.stringify(clean) : null);
}
