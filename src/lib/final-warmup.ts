/**
 * Logged warm-up sets (optional, any external-load exercise).
 *
 * They live in their own table (pl_warmup_sets), never in pl_row_results: that
 * table feeds records, tonnage, league points, completion and coach review, none
 * of which should ever see a warm-up. The load-suggestion engine reads only the
 * heaviest warm-up of the day (the "final" one) — see load-suggestion.ts, note 8.
 */
export type WarmupUnit = "kg" | "lb";

export interface WarmupSetRow {
  id: string;
  load: number;
  unit: WarmupUnit;
  reps: number;
  /** How hard it felt (6–10), or null when the athlete didn't say. */
  rpe: number | null;
  created_at?: string;
}

const KG_PER_LB = 0.45359237;

export function warmupInUnit(w: Pick<WarmupSetRow, "load" | "unit" | "reps" | "rpe">, unit: WarmupUnit): { load: number; reps: number; rpe: number | null } {
  const load = w.unit === unit ? w.load : unit === "kg" ? w.load * KG_PER_LB : w.load / KG_PER_LB;
  return { load, reps: w.reps, rpe: w.rpe };
}

/** Normalises a raw DB row (numeric columns can arrive as strings). */
export function normalizeWarmupRow(r: any): WarmupSetRow | null {
  const load = Number(r?.load);
  const reps = Number(r?.reps);
  if (!(load > 0) || !(reps >= 1) || (r?.unit !== "kg" && r?.unit !== "lb")) return null;
  const rpe = r?.rpe == null ? null : Number(r.rpe);
  return { id: String(r.id), load, unit: r.unit, reps, rpe: rpe != null && Number.isFinite(rpe) ? rpe : null, created_at: r.created_at };
}

/** The "final" warm-up = the heaviest one logged (ties: the latest), in the display unit. */
export function pickFinalWarmup(sets: WarmupSetRow[], unit: WarmupUnit): { load: number; reps: number; rpe: number | null } | null {
  let best: { load: number; reps: number; rpe: number | null } | null = null;
  for (const s of sets) {
    const c = warmupInUnit(s, unit);
    if (!best || c.load >= best.load) best = c;
  }
  return best;
}

/** Human summary: "140 kg × 2 · RPE 7". */
export function describeWarmup(w: Pick<WarmupSetRow, "load" | "unit" | "reps" | "rpe">, unit: WarmupUnit): string {
  const { load, reps, rpe } = warmupInUnit(w, unit);
  const n = Math.round(load * 10) / 10;
  return `${n} ${unit} × ${reps}${rpe != null ? ` · RPE ${rpe}` : ""}`;
}
