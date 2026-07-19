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

type CompletionSummary = {
  id: string;
  day_id: string;
  completed_at: string | null;
};

export interface PlannedVsActualRow {
  rowId: string;
  exerciseName: string;
  /** "reps" (load × reps) or "time" (held/performed duration). */
  measurementType: "reps" | "time";
  plannedSets: number | null;
  plannedRepsText: string | null;
  plannedRepsMin: number | null;
  plannedRepsMax: number | null;
  plannedLoad: number | null;
  /** Programmed duration per set, seconds (time-mode only). */
  plannedDurationSeconds: number | null;
  actualSets: number;
  actualRepsTotal: number;
  actualVolume: number;
  bestE1RM: number;
  /** Total logged duration across sets, seconds (time-mode only). */
  actualDurationTotalSeconds: number;
  /** Longest single logged set, seconds (time-mode only). */
  bestDurationSeconds: number;
  /** Percentage of planned sets actually logged (capped at 100). */
  setsPct: number | null;
  /** Percentage of logged sets that hit the planned rep target. */
  repsHitPct: number | null;
  /** Percentage of logged sets that hit the planned duration target (time-mode only). */
  durationHitPct: number | null;
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

function isDateAtStartOfDay(d: Date): boolean {
  return (
    d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
  );
}

function toBoundaryIso(
  d: Date | string | null | undefined,
  boundary: "start" | "end",
): string | null {
  if (d == null) return null;
  const parsed = d instanceof Date ? new Date(d) : new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  // Block/date-picker filters pass calendar dates at midnight. Treat the end
  // date as inclusive for the whole training day, otherwise completions later
  // on the block end date are silently excluded.
  if (boundary === "end" && isDateAtStartOfDay(parsed)) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed.toISOString();
}

function dedupeCompletionsByDay(rows: CompletionSummary[]): CompletionSummary[] {
  const byDay = new Map<string, CompletionSummary>();
  for (const row of rows) {
    if (!row.day_id) continue;
    const existing = byDay.get(row.day_id);
    if (!existing) {
      byDay.set(row.day_id, row);
      continue;
    }
    const rowTime = row.completed_at ? new Date(row.completed_at).getTime() : 0;
    const existingTime = existing.completed_at ? new Date(existing.completed_at).getTime() : 0;
    if (rowTime > existingTime) byDay.set(row.day_id, row);
  }
  return [...byDay.values()].sort(
    (a, b) => new Date(b.completed_at ?? 0).getTime() - new Date(a.completed_at ?? 0).getTime(),
  );
}

/**
 * Fetch the last `limit` completed workout days for a client and return a
 * planned-vs-actual comparison for each.
 */
export async function getRecentPlannedVsActual(
  clientId: string,
  opts: {
    limit?: number;
    formula?: E1RMFormula;
    workingRpeMin?: number;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
    /** When set, only include completions from days inside the block. */
    blockId?: string | null;
  } = {},
): Promise<PlannedVsActualDay[]> {
  const limit = opts.limit ?? 5;
  const formula = opts.formula ?? "epley";
  const rpeMin = opts.workingRpeMin ?? 6;
  const startIso = toBoundaryIso(opts.startDate, "start");
  const endIso = toBoundaryIso(opts.endDate, "end");

  // Resolve block scope once — pl_day_completions.day_id must be in this set.
  let blockDayIds: string[] | null = null;
  if (opts.blockId) {
    const { data: weeks, error: weeksErr } = await supabase
      .from("pl_weeks")
      .select("id")
      .eq("block_id", opts.blockId);
    if (weeksErr) throw weeksErr;
    const weekIds = (weeks ?? []).map((w: any) => w.id);
    if (weekIds.length === 0) return [];
    const { data: days, error: daysErr } = await supabase
      .from("pl_days")
      .select("id")
      .in("week_id", weekIds);
    if (daysErr) throw daysErr;
    blockDayIds = (days ?? []).map((d: any) => d.id);
    if (blockDayIds.length === 0) return [];
  }

  const blockDayIdSet = blockDayIds ? new Set(blockDayIds) : null;

  const fetchFallbackCompletionsFromResults = async (): Promise<CompletionSummary[]> => {
    let resultQuery = supabase
      .from("pl_row_results")
      .select("row_id, completed_at")
      .eq("client_id", clientId)
      .not("completed_at", "is", null);
    if (startIso) resultQuery = resultQuery.gte("completed_at", startIso);
    if (endIso) resultQuery = resultQuery.lte("completed_at", endIso);

    const { data: recentResults, error: resultErr } = await resultQuery
      .order("completed_at", { ascending: false })
      .limit(500);
    if (resultErr) throw resultErr;

    const candidateRowIds = uniqueStrings((recentResults ?? []).map((r: any) => r.row_id));
    if (candidateRowIds.length === 0) return [];

    const { data: candidateRows, error: candidateRowsErr } = await supabase
      .from("pl_exercise_rows")
      .select("id, day_id")
      .in("id", candidateRowIds);
    if (candidateRowsErr) throw candidateRowsErr;

    const dayByRow = new Map((candidateRows ?? []).map((r: any) => [r.id, r.day_id]));
    const byDay = new Map<string, CompletionSummary>();
    for (const result of recentResults ?? []) {
      const dayId = dayByRow.get((result as any).row_id);
      if (!dayId) continue;
      if (blockDayIdSet && !blockDayIdSet.has(dayId)) continue;
      if (!byDay.has(dayId)) {
        byDay.set(dayId, {
          id: `result:${dayId}`,
          day_id: dayId,
          completed_at: (result as any).completed_at ?? null,
        });
      }
    }
    return dedupeCompletionsByDay([...byDay.values()]).slice(0, limit);
  };

  let completionsQuery = supabase
    .from("pl_day_completions")
    .select("id, day_id, completed_at")
    .eq("client_id", clientId)
    .not("completed_at", "is", null);
  if (startIso) completionsQuery = completionsQuery.gte("completed_at", startIso);
  if (endIso) completionsQuery = completionsQuery.lte("completed_at", endIso);
  if (blockDayIds) completionsQuery = completionsQuery.in("day_id", blockDayIds);
  const { data: completionRows, error: cErr } = await completionsQuery
    .order("completed_at", { ascending: false })
    .limit(Math.max(limit * 5, 25));
  if (cErr) throw cErr;
  let completions = dedupeCompletionsByDay((completionRows ?? []) as CompletionSummary[]).slice(
    0,
    limit,
  );

  // Some older workout sessions have set results but no day-completion row.
  // Use those results as a read-only fallback so the analytics card still
  // reflects real completed training instead of showing an empty state.
  if (completions.length === 0) {
    completions = await fetchFallbackCompletionsFromResults();
  }
  if (!completions || completions.length === 0) return [];

  const dayIds = uniqueStrings(completions.map((c) => c.day_id));

  const { data: dayMetaRows, error: dayMetaErr } = await supabase
    .from("pl_days")
    .select("id, title, day_index")
    .in("id", dayIds);
  if (dayMetaErr) throw dayMetaErr;
  const dayMetaById = new Map((dayMetaRows ?? []).map((d: any) => [d.id, d]));

  const { data: rows, error: rErr } = await supabase
    .from("pl_exercise_rows")
    .select(
      "id, day_id, sort_order, sets, reps_text, load_kg, load_lb, measurement_type, duration_seconds, exercise_id, exercise_name_override",
    )
    .in("day_id", dayIds);
  if (rErr) throw rErr;

  const rowIds = uniqueStrings((rows ?? []).map((r: any) => r.id));
  if (rowIds.length === 0) return [];

  const exerciseIds = uniqueStrings((rows ?? []).map((r: any) => r.exercise_id));
  const exerciseNameById = new Map<string, string>();
  if (exerciseIds.length > 0) {
    const { data: exercises, error: exercisesErr } = await supabase
      .from("exercises")
      .select("id, name")
      .in("id", exerciseIds);
    if (exercisesErr) throw exercisesErr;
    for (const ex of exercises ?? []) {
      if ((ex as any).id && (ex as any).name) {
        exerciseNameById.set((ex as any).id, (ex as any).name);
      }
    }
  }

  let resultsQuery = supabase
    .from("pl_row_results")
    .select(
      "row_id, set_index, actual_load, actual_reps, actual_rpe, actual_rpe_num, is_working_set, completed_at, completed_duration_seconds",
    )
    .eq("client_id", clientId)
    .in("row_id", rowIds);
  if (startIso) resultsQuery = resultsQuery.gte("completed_at", startIso);
  if (endIso) resultsQuery = resultsQuery.lte("completed_at", endIso);
  const { data: results, error: resErr } = await resultsQuery;
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
      const isTime = row.measurement_type === "time";
      // For time-based rows the working-set heuristic (load × reps) doesn't
      // apply: any set with a logged duration counts as completed work.
      const working = isTime
        ? sets.filter((s) => Number(s.completed_duration_seconds) > 0)
        : sets.filter((s) =>
            s.is_working_set === true
              ? true
              : s.is_working_set === false
                ? false
                : Number(s.actual_reps) > 0 ||
                  (isWorkingSet({
                    load: s.actual_load,
                    reps: s.actual_reps,
                    rpe: s.actual_rpe_num ?? s.actual_rpe,
                  }) &&
                    (s.actual_rpe_num == null || Number(s.actual_rpe_num) >= rpeMin)),
          );

      const { min, max } = parseRepsText(row.reps_text);
      const plannedSets = row.sets != null ? Number(row.sets) : null;
      const plannedLoad = row.load_lb ?? row.load_kg ?? null;
      const plannedDurationSeconds =
        row.duration_seconds != null ? Number(row.duration_seconds) : null;

      const actualSets = working.length;
      const actualRepsTotal = isTime
        ? 0
        : working.reduce((s, r) => s + (Number(r.actual_reps) || 0), 0);
      const actualVolume = isTime
        ? 0
        : working.reduce(
            (s, r) => s + (Number(r.actual_load) || 0) * (Number(r.actual_reps) || 0),
            0,
          );
      const bestE1RM = isTime
        ? 0
        : working.reduce((best, r) => {
            const e = estimate1RM(Number(r.actual_load) || 0, Number(r.actual_reps) || 0, formula);
            return e > best ? e : best;
          }, 0);
      const actualDurationTotalSeconds = isTime
        ? working.reduce((s, r) => s + (Number(r.completed_duration_seconds) || 0), 0)
        : 0;
      const bestDurationSeconds = isTime
        ? working.reduce((best, r) => Math.max(best, Number(r.completed_duration_seconds) || 0), 0)
        : 0;

      const setsPct =
        plannedSets && plannedSets > 0
          ? Math.min(100, Math.round((actualSets / plannedSets) * 100))
          : null;

      // Reps target only applies to rep-based rows; time rows track duration instead.
      const targeted = isTime ? [] : working.filter((r) => r.actual_reps != null);
      const repsHit = targeted.filter((r) =>
        rowHitRepTarget(Number(r.actual_reps) || 0, min, max),
      ).length;
      const repsHitPct =
        !isTime && (min != null || max != null) && targeted.length > 0
          ? Math.round((repsHit / targeted.length) * 100)
          : null;

      // Duration hit %: a set "hit" when it reached >=90% of the prescribed duration.
      const durationHitPct =
        isTime && plannedDurationSeconds && plannedDurationSeconds > 0 && working.length > 0
          ? Math.round(
              (working.filter(
                (r) => (Number(r.completed_duration_seconds) || 0) >= plannedDurationSeconds * 0.9,
              ).length /
                working.length) *
                100,
            )
          : null;

      return {
        rowId: row.id,
        exerciseName:
          exerciseNameById.get(row.exercise_id) ?? row.exercise_name_override ?? "Exercise",
        measurementType: isTime ? "time" : "reps",
        plannedSets,
        plannedRepsText: row.reps_text ?? null,
        plannedRepsMin: min,
        plannedRepsMax: max,
        plannedLoad: plannedLoad != null ? Number(plannedLoad) : null,
        plannedDurationSeconds,
        actualSets,
        actualRepsTotal,
        actualVolume,
        bestE1RM,
        actualDurationTotalSeconds,
        bestDurationSeconds,
        setsPct,
        repsHitPct,
        durationHitPct,
      };
    });

    const plannedSets = comparisonRows.reduce((s, r) => s + (r.plannedSets ?? 0), 0);
    const actualSets = comparisonRows.reduce((s, r) => s + r.actualSets, 0);
    const actualVolume = comparisonRows.reduce((s, r) => s + r.actualVolume, 0);
    const rowsWithRepTarget = comparisonRows.filter((r) => r.repsHitPct != null);

    return {
      dayId: c.day_id,
      dayName:
        dayMetaById.get(c.day_id)?.title ??
        (dayMetaById.get(c.day_id)?.day_index != null
          ? `Day ${Number(dayMetaById.get(c.day_id)?.day_index) + 1}`
          : null),
      completedAt: c.completed_at ?? null,
      rows: comparisonRows,
      totals: {
        plannedSets,
        actualSets,
        actualVolume,
        setsPct:
          plannedSets > 0 ? Math.min(100, Math.round((actualSets / plannedSets) * 100)) : null,
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