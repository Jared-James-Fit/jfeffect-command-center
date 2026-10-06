/**
 * The optional "final warm-up" an athlete can enter before their first working
 * set of a squat / bench / deadlift lift (see load-suggestion.ts, note 8).
 *
 * It only matters for THIS session's first working-set suggestion, so it is kept
 * on the device (survives a reload mid-workout) and expires after 16 hours. It is
 * deliberately not written to the set-log tables: those feed records, tonnage,
 * league points, completion and coach review, none of which should ever see a
 * warm-up. Never throws — storage can be blocked (private mode).
 */
export type WarmupUnit = "kg" | "lb";

export interface StoredWarmup {
  load: number;
  unit: WarmupUnit;
  reps: number;
  /** How hard it felt (6–10), or null when the athlete didn't say. */
  rpe: number | null;
  savedAt: number;
}

export const WARMUP_TTL_MS = 16 * 3_600_000;
const KG_PER_LB = 0.45359237;

export function warmupKey(dayId: string, rowId: string): string {
  return `jf-final-warmup:${dayId}:${rowId}`;
}

export function readWarmup(key: string, now: number = Date.now()): StoredWarmup | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredWarmup>;
    const ok =
      typeof v.load === "number" && v.load > 0 &&
      typeof v.reps === "number" && v.reps >= 1 &&
      (v.unit === "kg" || v.unit === "lb") &&
      typeof v.savedAt === "number" && now - v.savedAt <= WARMUP_TTL_MS && now >= v.savedAt - 60_000;
    if (!ok) { window.localStorage.removeItem(key); return null; }
    return { load: v.load!, unit: v.unit!, reps: v.reps!, rpe: typeof v.rpe === "number" ? v.rpe : null, savedAt: v.savedAt! };
  } catch {
    return null;
  }
}

export function writeWarmup(key: string, v: StoredWarmup | null): void {
  try {
    if (!v) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(v));
  } catch { /* storage blocked — the warm-up just won't survive a reload */ }
}

/** The warm-up in the unit the logger is showing (the athlete may toggle kg/lb mid-session). */
export function warmupInUnit(w: StoredWarmup, unit: WarmupUnit): { load: number; reps: number; rpe: number | null } {
  const load = w.unit === unit ? w.load : unit === "kg" ? w.load * KG_PER_LB : w.load / KG_PER_LB;
  return { load, reps: w.reps, rpe: w.rpe };
}

/** Human summary: "140 kg × 2 · RPE 7". */
export function describeWarmup(w: StoredWarmup, unit: WarmupUnit): string {
  const { load, reps, rpe } = warmupInUnit(w, unit);
  const n = Math.round(load * 10) / 10;
  return `${n} ${unit} × ${reps}${rpe != null ? ` · RPE ${rpe}` : ""}`;
}
