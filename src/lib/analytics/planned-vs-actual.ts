/**
 * Planned-vs-Actual comparison for completed workouts.
 *
 * Compares programmed prescriptions (pl_exercise_rows: sets / reps_text / load)
 * against what the client logged (pl_row_results) for the same row, grouped
 * by completed workout day.
 *
 * Read-only: no schema changes, no writes. Used by the client analytics page
 * to display adherence ("you hit your reps target on 4 / 5 sets").
 */
import { supabase } from "@/integrations/supabase/client";
import { estimate1RM, isWorkingSet, type E1RMFormula } from "./e1rm";

export interface PlannedVsActualRow {
  rowId: string;
  exerciseName: string;
  plannedSets: number | null;
  plannedRepsText: string | null;
  plannedRepsMin: number | null;
  plannedRepsMax: number | null;
  plannedLoad: number | null;
  actualSets: number;
  actualRepsTotal: number;
  actualVolume: number;
  bestE1RM: number;
  /** Percentage of planned sets actually logged (capped at 100). */
  setsPct: number | null;
  /** Percentage of logged sets that hit the planned rep target. */
  repsHitPct: number | null;
}

export interface PlannedVsActualDay {
  dayId: string;
  dayName: string | null;
  completedAt: string | null;
  rows: PlannedVsActualRow[];
  totals: {
    plannedSets: number;
    actualSets: number;
    actualVolume: number;
    setsPct: number | null;
    repsHitPct: number | null;
  };
}

/** Parse "8-10", "8", "AMRAP", "5x5" into min/max rep targets. Returns nulls for non-numeric. */
function parseRepsText(t: string | null | undefined): { min: number | null; max: number | null } {
  if (!t) return { min: null, max: null };
  const s = String(t).trim().toLowerCase();
  if (!s || s.includes("amrap") || s.includes("max")) return { min: null, max: null };
  const range = s.match(/^(\d+)\s*[-–to]+\s*(\d+)$/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = s.match(/^(\d+)$/);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return { min: null, max: null };
}

function rowHitRepTarget(reps: number, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true; // no target -> not penalized
  if (min != null && reps < min) return false;
  if (max != null && reps > max + 2) return false; // small tolerance over the top
  return true;
}

/**
 * Fetch the last `limit` completed workout days for a client and return a
 * planned-vs-actual comparison for each.
 */
export async function getRecentPlannedVsActual(
  clientId: string,
  opts: { limit?: number; formula?: E1RMFormula; workingRpeMin?: number } = {},
): Promise<PlannedVsActualDay[]> {
  const limit = opts.limit ?? 5;
  const formula = opts.formula ?? "epley";
  const rpeMin = opts.workingRpeMin ?? 6;

  const { data: completions, error: cErr } = await supabase
    .from("pl_day_completions")
    .select("id, day_id, completed_at, pl_days(name, sort_order)")
    .eq("client_id", clientId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (cErr) throw cErr;
  if (!completions || completions.length === 0) return [];

  const dayIds = completions.map((c: any) => c.day_id);

  const { data: rows, error: rErr } = await supabase
    .from("pl_exercise_rows")
    .select("id, day_id, sort_order, sets, reps_text, load_kg, load_lb, exercise_name_override, exercises(name)")
    .in("day_id", dayIds);
  if (rErr) throw rErr;

  const rowIds = (rows ?? []).map((r: any) => r.id);
  if (rowIds.length === 0) return [];

  const { data: results, error: resErr } = await supabase
    .from("pl_row_results")
    .select("row_id, set_index, actual_load, actual_reps, actual_rpe, actual_rpe_num, is_working_set, completed_at")
    .eq("client_id", clientId)
    .in("row_id", rowIds);
  if (resErr) throw resErr;

  const resultsByRow = new Map<string, any[]>();
  for (const r of results ?? []) {
    if (!resultsByRow.has(r.row_id)) resultsByRow.set(r.row_id, []);
    resultsByRow.get(r.row_id)!.push(r);
  }

  const rowsByDay = new Map<string, any[]>();
  for (const r of rows ?? []) {
    if (!rowsByDay.has(r.day_id)) rowsByDay.set(r.day_id, []);
    rowsByDay.get(r.day_id)!.push(r);
  }

  return completions.map((c: any): PlannedVsActualDay => {
    const dayRows = (rowsByDay.get(c.day_id) ?? []).sort(
      (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );

    const comparisonRows: PlannedVsActualRow[] = dayRows.map((row: any) => {
      const sets: any[] = resultsByRow.get(row.id) ?? [];
      const working = sets.filter((s) =>
        s.is_working_set === true
          ? true
          : s.is_working_set === false
            ? false
            : isWorkingSet({
                load: s.actual_load,
                reps: s.actual_reps,
                rpe: s.actual_rpe_num ?? s.actual_rpe,
              }) && (s.actual_rpe_num == null || Number(s.actual_rpe_num) >= rpeMin),
      );

      const { min, max } = parseRepsText(row.reps_text);
      const plannedSets = row.sets != null ? Number(row.sets) : null;
      const plannedLoad = row.load_lb ?? row.load_kg ?? null;

      const actualSets = working.length;
      const actualRepsTotal = working.reduce((s, r) => s + (Number(r.actual_reps) || 0), 0);
      const actualVolume = working.reduce(
        (s, r) => s + (Number(r.actual_load) || 0) * (Number(r.actual_reps) || 0),
        0,
      );
      const bestE1RM = working.reduce((best, r) => {
        const e = estimate1RM(Number(r.actual_load) || 0, Number(r.actual_reps) || 0, formula);
        return e > best ? e : best;
      }, 0);

      const setsPct =
        plannedSets && plannedSets > 0
          ? Math.min(100, Math.round((actualSets / plannedSets) * 100))
          : null;

      const targeted = working.filter((r) => r.actual_reps != null);
      const repsHit = targeted.filter((r) =>
        rowHitRepTarget(Number(r.actual_reps) || 0, min, max),
      ).length;
      const repsHitPct =
        (min != null || max != null) && targeted.length > 0
          ? Math.round((repsHit / targeted.length) * 100)
          : null;

      return {
        rowId: row.id,
        exerciseName: row.exercises?.name ?? row.exercise_name_override ?? "Exercise",
        plannedSets,
        plannedRepsText: row.reps_text ?? null,
        plannedRepsMin: min,
        plannedRepsMax: max,
        plannedLoad: plannedLoad != null ? Number(plannedLoad) : null,
        actualSets,
        actualRepsTotal,
        actualVolume,
        bestE1RM,
        setsPct,
        repsHitPct,
      };
    });

    const plannedSets = comparisonRows.reduce((s, r) => s + (r.plannedSets ?? 0), 0);
    const actualSets = comparisonRows.reduce((s, r) => s + r.actualSets, 0);
    const actualVolume = comparisonRows.reduce((s, r) => s + r.actualVolume, 0);
    const rowsWithRepTarget = comparisonRows.filter((r) => r.repsHitPct != null);

    return {
      dayId: c.day_id,
      dayName: c.pl_days?.name ?? null,
      completedAt: c.completed_at ?? null,
      rows: comparisonRows,
      totals: {
        plannedSets,
        actualSets,
        actualVolume,
        setsPct: plannedSets > 0 ? Math.min(100, Math.round((actualSets / plannedSets) * 100)) : null,
        repsHitPct:
          rowsWithRepTarget.length > 0
            ? Math.round(
                rowsWithRepTarget.reduce((s, r) => s + (r.repsHitPct ?? 0), 0) /
                  rowsWithRepTarget.length,
              )
            : null,
      },
    };
  });
}