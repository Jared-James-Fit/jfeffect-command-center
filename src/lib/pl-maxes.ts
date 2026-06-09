import { supabase } from "@/integrations/supabase/client";
import { roundLoad } from "@/lib/pl-programs";

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

export async function listClientMaxes(clientId: string): Promise<ClientMaxRow[]> {
  const { data, error } = await db
    .from("pl_client_maxes")
    .select("*")
    .eq("client_id", clientId)
    .order("active", { ascending: false })
    .order("lift");
  if (error) throw error;
  return (data ?? []) as ClientMaxRow[];
}

export async function upsertClientMax(input: Partial<ClientMaxRow> & { client_id: string; lift: string }) {
  const payload: Record<string, unknown> = { ...input };
  delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  const { data, error } = await db
    .from("pl_client_maxes")
    .upsert(payload, { onConflict: "client_id,lift" })
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

/** Build map keyed by lift name (lowercase). */
export function buildMaxIndex(rows: ClientMaxRow[]): Map<string, ClientMaxRow> {
  const m = new Map<string, ClientMaxRow>();
  for (const r of rows) if (r.active) m.set(r.lift.toLowerCase(), r);
  return m;
}

/** Compute the prescribed load for a row, returning enough metadata to display in the UI. */
export function computeRowLoad(opts: {
  exerciseName: string | null | undefined;
  basis: string | null | undefined;
  percentage: number | null | undefined;
  manualLoadKg: number | null | undefined;
  manualLoadLb: number | null | undefined;
  unit: "kg" | "lb";
  maxesIndex: Map<string, ClientMaxRow>;
}): {
  load: number | null;
  unit: "kg" | "lb";
  exact: number | null;
  base: number | null;
  baseLabel: string;
  status: "ok" | "no-max" | "no-percentage" | "manual" | "needs-link";
  max?: ClientMaxRow | null;
} {
  const { exerciseName, basis, percentage, manualLoadKg, manualLoadLb, unit, maxesIndex } = opts;
  const manualLoad = unit === "kg" ? manualLoadKg : manualLoadLb;

  if (!basis || basis === "manual") {
    return { load: manualLoad ?? null, unit, exact: manualLoad ?? null, base: null, baseLabel: "manual", status: "manual" };
  }

  if (basis === "top_set" || basis === "prev_set" || basis === "prev_week") {
    return { load: null, unit, exact: null, base: null, baseLabel: basis, status: "needs-link" };
  }

  if (!percentage) {
    return { load: null, unit, exact: null, base: null, baseLabel: basis, status: "no-percentage" };
  }

  const row = findMaxByLift(Array.from(maxesIndex.values()), exerciseName);
  if (!row) return { load: null, unit, exact: null, base: null, baseLabel: basis, status: "no-max", max: null };

  const eff = effectiveMax(row, maxesIndex);
  let base: number | null = null;
  let baseLabel = "1RM";
  if (basis === "1rm") { base = eff.one_rm; baseLabel = "1RM"; }
  else if (basis === "training_max") { base = eff.training_max; baseLabel = "Training Max"; }
  else if (basis === "est_1rm") { base = eff.estimated_1rm; baseLabel = "Est. 1RM"; }

  if (base == null) return { load: null, unit, exact: null, base: null, baseLabel, status: "no-max", max: row };

  // Convert base to row's unit if different from prescription unit.
  const baseInUnit =
    row.unit === unit
      ? base
      : unit === "kg"
      ? base / 2.20462262 // lb→kg
      : base * 2.20462262; // kg→lb

  const exact = (baseInUnit * percentage) / 100;
  const step = row.rounding_step ?? defaultRoundingStep(unit);
  const load = roundLoadWithMode(exact, step, row.rounding_mode);
  return { load, unit, exact, base: baseInUnit, baseLabel, status: "ok", max: row };
}

// Re-export so callers can use a consistent rounding helper.
export { roundLoad };