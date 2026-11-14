import { supabase } from "@/integrations/supabase/client";
import { roundLoad } from "@/lib/pl-programs";
import { competitionMax, plannedLoadLabel, type LiftFamily } from "@/lib/workouts/load-reference";

const db = supabase as any;

export type MaxSource = "tested" | "estimated" | "manual";
export type RoundingMode = "nearest" | "up" | "down" | "exact";

export interface ClientMaxRow {
  id: string;
  client_id: string;
  lift: string;
  exercise_id: string | null;
  one_rm: number | null;
  training_max: number | null;
  estimated_1rm: number | null;
  unit: "kg" | "lb";
  notes: string | null;
  tested_at: string | null;
  source: MaxSource;
  active: boolean;
  source_lift: string | null;
  source_exercise_id: string | null;
  variation_modifier: number | null;
  manual_override: boolean;
  rounding_step: number | null;
  rounding_mode: RoundingMode;
  block_id: string | null;
  updated_at: string;
  created_at: string;
}

export const ROUNDING_MODES: { value: RoundingMode; label: string }[] = [
  { value: "nearest", label: "Round to nearest" },
  { value: "up", label: "Round up" },
  { value: "down", label: "Round down" },
  { value: "exact", label: "Exact (no rounding)" },
];

export const MAX_SOURCES: { value: MaxSource; label: string }[] = [
  { value: "tested", label: "Tested" },
  { value: "estimated", label: "Estimated" },
  { value: "manual", label: "Manual entry" },
];

export function defaultRoundingStep(unit: "kg" | "lb") {
  return unit === "kg" ? 2.5 : 5;
}

export function roundLoadWithMode(
  load: number,
  step: number,
  mode: RoundingMode,
): number {
  if (!step || mode === "exact") return Math.round(load * 100) / 100;
  if (mode === "up") return Math.ceil(load / step) * step;
  if (mode === "down") return Math.floor(load / step) * step;
  return Math.round(load / step) * step;
}

/** Resolve effective 1RM / Training Max for a max row, accounting for variation mapping. */
export function effectiveMax(
  row: ClientMaxRow,
  allByLift: Map<string, ClientMaxRow>,
): { one_rm: number | null; training_max: number | null; estimated_1rm: number | null; basisLabel?: string } {
  // Manual override: use the row's own numbers, even if a source_lift is set.
  if (row.manual_override || (!row.source_lift && !row.source_exercise_id)) {
    return { one_rm: row.one_rm, training_max: row.training_max, estimated_1rm: row.estimated_1rm };
  }
  const src = row.source_lift ? allByLift.get(row.source_lift.toLowerCase()) : null;
  if (!src) return { one_rm: row.one_rm, training_max: row.training_max, estimated_1rm: row.estimated_1rm };
  const mod = row.variation_modifier != null ? Number(row.variation_modifier) / 100 : 1;
  const apply = (v: number | null) => (v == null ? null : Number((v * mod).toFixed(2)));
  return {
    one_rm: row.one_rm ?? apply(src.one_rm),
    training_max: row.training_max ?? apply(src.training_max),
    estimated_1rm: row.estimated_1rm ?? apply(src.estimated_1rm),
    basisLabel: `${row.variation_modifier ?? 100}% of ${src.lift}`,
  };
}

/**
 * List a client's maxes.
 * When `blockId` is provided, returns both the client's global maxes
 * (block_id IS NULL) AND any block-scoped maxes for that block.
 * When omitted, only global maxes are returned.
 */
export async function listClientMaxes(
  clientId: string,
  blockId?: string | null,
): Promise<ClientMaxRow[]> {
  let q = db.from("pl_client_maxes").select("*").eq("client_id", clientId);
  if (blockId) q = q.or(`block_id.is.null,block_id.eq.${blockId}`);
  else q = q.is("block_id", null);
  const { data, error } = await q
    .order("active", { ascending: false })
    .order("lift");
  if (error) throw error;
  return (data ?? []) as ClientMaxRow[];
}

/**
 * Insert-or-update a client max. If `block_id` is set the row is block-scoped,
 * otherwise it is the client's global max for that lift. Uses an explicit
 * find-then-write so it works with the partial unique indexes that gate
 * (client_id, lift) global vs (client_id, block_id, lift) block-scoped rows.
 */
export async function upsertClientMax(
  input: Partial<ClientMaxRow> & { client_id: string; lift: string },
) {
  const payload: Record<string, unknown> = { ...input };
  delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  const block_id = (input.block_id ?? null) as string | null;
  let q = db
    .from("pl_client_maxes")
    .select("id")
    .eq("client_id", input.client_id)
    .eq("lift", input.lift);
  q = block_id ? q.eq("block_id", block_id) : q.is("block_id", null);
  const { data: existing, error: findErr } = await q.maybeSingle();
  if (findErr) throw findErr;
  if (existing?.id) {
    const { data, error } = await db
      .from("pl_client_maxes")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as ClientMaxRow;
  }
  const { data, error } = await db
    .from("pl_client_maxes")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data as ClientMaxRow;
}

export async function deleteClientMax(id: string) {
  const { error } = await db.from("pl_client_maxes").delete().eq("id", id);
  if (error) throw error;
}

/** Lookup a client's max row by lift name (case-insensitive). */
export function findMaxByLift(
  rows: ClientMaxRow[],
  lift: string | null | undefined,
): ClientMaxRow | null {
  if (!lift) return null;
  const lower = lift.toLowerCase();
  return rows.find((r) => r.lift.toLowerCase() === lower && r.active) ?? null;
}

/**
 * Build map keyed by lift name (lowercase). Block-scoped rows win over
 * global rows for the same lift, so percentage calculations always prefer
 * the temporary block max when one exists.
 */
export function buildMaxIndex(rows: ClientMaxRow[]): Map<string, ClientMaxRow> {
  const m = new Map<string, ClientMaxRow>();
  // First pass: globals.
  for (const r of rows) {
    if (!r.active || r.block_id) continue;
    m.set(r.lift.toLowerCase(), r);
  }
  // Second pass: block-scoped overrides.
  for (const r of rows) {
    if (!r.active || !r.block_id) continue;
    m.set(r.lift.toLowerCase(), r);
  }
  return m;
}

/**
 * Compute the prescribed load for a row, returning enough metadata to display in the UI.
 * The max is the exercise's own (by name) or, failing that, the competition max of its
 * lift family (`family`, load-reference.ts); a % of e1RM falls back to `loggedE1rmKg`
 * (their recent logged competition sets) when no e1RM is stored. `label` is what the
 * athlete reads under the weight ("70% TM", "65% Comp Squat TM").
 */
export function computeRowLoad(opts: {
  exerciseName: string | null | undefined;
  basis: string | null | undefined;
  percentage: number | null | undefined;
  manualLoadKg: number | null | undefined;
  manualLoadLb: number | null | undefined;
  unit: "kg" | "lb";
  maxesIndex: Map<string, ClientMaxRow>;
  /** the competition lift this exercise's % reads when it has no max of its own */
  family?: LiftFamily | null;
  /** the exercise is that competition lift itself (its label then needs no lift name) */
  ownCompetition?: boolean;
  /** a recent e1RM from their logged sets of that lift, in kg (loggedE1rm) */
  loggedE1rmKg?: number | null;
}): {
  load: number | null;
  unit: "kg" | "lb";
  exact: number | null;
  base: number | null;
  baseLabel: string;
  status: "ok" | "no-max" | "no-percentage" | "manual" | "needs-link" | "no-load";
  max?: ClientMaxRow | null;
  /** "70% TM" / "65% Comp Squat TM" (only with status "ok") */
  label?: string | null;
  /** the lift whose max it read (a logged e1RM's competition lift has no max row) */
  refLift?: string | null;
} {
  const { exerciseName, basis, percentage, manualLoadKg, manualLoadLb, unit, maxesIndex } = opts;
  const manualLoad = unit === "kg" ? manualLoadKg : manualLoadLb;

  if (basis === "none") {
    return { load: null, unit, exact: null, base: null, baseLabel: "none", status: "no-load" };
  }

  if (!basis || basis === "manual") {
    return { load: manualLoad ?? null, unit, exact: manualLoad ?? null, base: null, baseLabel: "manual", status: "manual" };
  }

  if (basis === "top_set" || basis === "prev_set" || basis === "prev_week") {
    return { load: null, unit, exact: null, base: null, baseLabel: basis, status: "needs-link" };
  }

  if (!percentage) {
    return { load: null, unit, exact: null, base: null, baseLabel: basis, status: "no-percentage" };
  }

  const all = Array.from(maxesIndex.values());
  // its own max by name, else its lift family's competition max (a High Bar Squat's % reads the Competition Squat)
  let row = findMaxByLift(all, exerciseName);
  let viaFamily = false;
  if (!row && opts.family) {
    row = competitionMax(all, opts.family);
    viaFamily = !!row && !opts.ownCompetition;
  }
  const logged = basis === "est_1rm" && opts.loggedE1rmKg != null && opts.loggedE1rmKg > 0 ? opts.loggedE1rmKg : null;
  if (!row && logged == null) return { load: null, unit, exact: null, base: null, baseLabel: basis, status: "no-max", max: null };

  const eff = row ? effectiveMax(row, maxesIndex) : null;
  let base: number | null = null;
  let baseUnit: "kg" | "lb" = row?.unit ?? "kg";
  let baseLabel = "1RM";
  if (basis === "1rm") { base = eff?.one_rm ?? null; baseLabel = "1RM"; }
  else if (basis === "training_max") { base = eff?.training_max ?? null; baseLabel = "Training Max"; }
  else if (basis === "est_1rm") {
    baseLabel = "Est. 1RM";
    base = eff?.estimated_1rm ?? null;
    // no e1RM stored: their logged one (kg), from the same lift
    if (base == null && logged != null) { base = logged; baseUnit = "kg"; viaFamily = !opts.ownCompetition && !!opts.family; }
  }

  if (base == null) return { load: null, unit, exact: null, base: null, baseLabel, status: "no-max", max: row };

  // Convert base to row's unit if different from prescription unit.
  const baseInUnit =
    baseUnit === unit
      ? base
      : unit === "kg"
      ? base / 2.20462262 // lb→kg
      : base * 2.20462262; // kg→lb

  const exact = (baseInUnit * percentage) / 100;
  const step = row?.rounding_step ?? defaultRoundingStep(unit);
  const load = roundLoadWithMode(exact, step, row?.rounding_mode ?? "nearest");
  const refLift = row?.lift ?? (opts.family ? `Competition ${opts.family === "bench" ? "Bench" : opts.family === "squat" ? "Squat" : "Deadlift"}` : null);
  const label = plannedLoadLabel({ percentage, basis, refLift, viaFamily });
  return { load, unit, exact, base: baseInUnit, baseLabel, status: "ok", max: row, label, refLift };
}

// Re-export so callers can use a consistent rounding helper.
export { roundLoad };