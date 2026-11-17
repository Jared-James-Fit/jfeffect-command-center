/**
 * Training load on the analytics page: the logged sets the page already has
 * (getClientResults) and the workouts written for the same dates, read with
 * the viewer's own login (RLS decides: the athlete, their coach, an admin),
 * then `buildTrainingLoad`. A plan that can't be read leaves the read without
 * prescribed numbers, never without the rest.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { chunk, fetchAllPages } from "@/lib/supabase-paginate";
import { isPrimaryProgramBlock } from "@/lib/at-home-backup";
import { buildTrainingLoad, type LoadSet, type PlanRow } from "@/lib/analytics/training-load";

const LB_PER_KG = 2.2046226;
const sb: any = supabase;

/** getClientResults rows (load in lb, ISO time) as training-load sets (kg, the athlete's own day). */
export function resultsToLoadSets(results: any[]): LoadSet[] {
  const out: LoadSet[] = [];
  for (const r of results ?? []) {
    if (!r?.date || !(Number(r.reps) > 0)) continue;
    const rpe = r.rpe != null && r.rpe !== "" ? parseFloat(String(r.rpe)) : null;
    const rir = r.rir != null && r.rir !== "" ? parseFloat(String(r.rir)) : null;
    out.push({
      day: format(new Date(r.date), "yyyy-MM-dd"),
      dayId: r.day_id ?? null,
      rowId: r.row_id ?? null,
      exerciseId: r.exercise_id ?? null,
      exercise: r.exercise_name ?? "",
      primary: Array.isArray(r.primary_muscles) ? r.primary_muscles : [],
      secondary: Array.isArray(r.secondary_muscles) ? r.secondary_muscles : [],
      fallbackMuscle: r.muscle_group ?? null,
      countsTowardVolume: r.counts_toward_volume !== false,
      category: r.category ?? null,
      rowFamily: r.movement_family ?? null,
      competitionLiftType: r.competition_lift_type ?? null,
      isCompetitionLift: r.is_competition_lift === true,
      exerciseFamily: r.exercise_movement_family ?? null,
      dbPattern: r.primary_movement_pattern ?? null,
      reps: Number(r.reps) || 0,
      loadKg: r.counts_load === false ? 0 : (Number(r.load) || 0) / LB_PER_KG,
      rpe: rpe != null && Number.isFinite(rpe) ? rpe : null,
      rir: rir != null && Number.isFinite(rir) ? rir : null,
    });
  }
  return out;
}

const ROW_SELECT =
  "id, day_id, sets, reps_text, rpe, rir, measurement_type, movement_family, exercise_id, exercise_name_override, exercises(name, primary_muscle_group, muscle_group, muscle_groups, secondary_muscle_groups, counts_toward_volume, category, competition_lift_type, is_competition_lift, movement_family, primary_movement_pattern)";

/**
 * The workouts written for these dates: the client's programs (never the
 * at-home backup), a hidden or archived program only for days they trained.
 */
export async function loadPlanRows(clientId: string, startISO: string, endISO: string, blockId?: string | null): Promise<PlanRow[]> {
  let blocksQ = sb.from("pl_blocks").select("id, archived, client_visible, source_template_block_key").eq("client_id", clientId);
  if (blockId) blocksQ = blocksQ.eq("id", blockId);
  const { data: blocks, error: be } = await blocksQ;
  if (be) throw be;
  const live = new Map<string, boolean>();
  for (const b of (blocks ?? []) as any[]) {
    if (!isPrimaryProgramBlock(b)) continue;
    live.set(b.id, b.archived !== true && b.client_visible !== false);
  }
  if (!live.size) return [];
  const weeks: any[] = [];
  for (const ids of chunk([...live.keys()])) {
    const { data, error } = await sb.from("pl_weeks").select("id, block_id, phase").in("block_id", ids);
    if (error) throw error;
    weeks.push(...(data ?? []));
  }
  if (!weeks.length) return [];
  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const days: any[] = [];
  for (const ids of chunk(weeks.map((w) => w.id))) {
    const rows = await fetchAllPages((from, to) =>
      sb.from("pl_days").select("id, week_id, scheduled_date")
        .in("week_id", ids)
        .gte("scheduled_date", startISO)
        .lte("scheduled_date", endISO)
        .order("id")
        .range(from, to),
    );
    days.push(...rows);
  }
  if (!days.length) return [];
  const trained = new Set<string>();
  for (const ids of chunk(days.map((d) => d.id))) {
    const { data, error } = await sb.from("pl_day_completions").select("day_id, completed_at").in("day_id", ids).not("completed_at", "is", null);
    if (error) throw error;
    for (const c of data ?? []) trained.add(c.day_id);
  }
  const keep = days.filter((d) => {
    const w = weekById.get(d.week_id);
    return w && (live.get(w.block_id) || trained.has(d.id));
  });
  const dayById = new Map(keep.map((d) => [d.id, d]));
  const out: PlanRow[] = [];
  for (const ids of chunk(keep.map((d) => d.id), 100)) {
    const rows = await fetchAllPages((from, to) =>
      sb.from("pl_exercise_rows").select(ROW_SELECT).in("day_id", ids).order("id").range(from, to),
    );
    for (const r of rows as any[]) {
      const d = dayById.get(r.day_id);
      if (!d) continue;
      const ex = r.exercises ?? {};
      out.push({
        rowId: r.id,
        dayId: r.day_id,
        day: d.scheduled_date ?? null,
        exerciseId: r.exercise_id ?? null,
        exercise: ex.name ?? r.exercise_name_override ?? "",
        primary: Array.isArray(ex.muscle_groups) ? ex.muscle_groups : [],
        secondary: Array.isArray(ex.secondary_muscle_groups) ? ex.secondary_muscle_groups : [],
        fallbackMuscle: ex.primary_muscle_group ?? ex.muscle_group ?? null,
        countsTowardVolume: ex.counts_toward_volume !== false,
        category: ex.category ?? null,
        rowFamily: r.movement_family ?? null,
        competitionLiftType: ex.competition_lift_type ?? null,
        isCompetitionLift: ex.is_competition_lift === true,
        exerciseFamily: ex.movement_family ?? null,
        dbPattern: ex.primary_movement_pattern ?? null,
        sets: r.sets != null ? Number(r.sets) : null,
        repsText: r.reps_text ?? null,
        rpeText: r.rpe ?? null,
        isTime: r.measurement_type === "time",
        weekPhase: weekById.get(d.week_id)?.phase ?? null,
      });
    }
  }
  return out;
}

/** The read for the analytics page's range. */
export function useTrainingLoad(opts: { clientId: string; results: any[]; start: Date; end: Date; blockId?: string | null; enabled?: boolean }) {
  const { clientId, results, start, end, blockId } = opts;
  const startISO = format(start, "yyyy-MM-dd");
  const endISO = format(end, "yyyy-MM-dd");
  const plan = useQuery({
    queryKey: ["training-load-plan", clientId, startISO, endISO, blockId ?? null],
    enabled: !!clientId && opts.enabled !== false,
    staleTime: 60_000,
    queryFn: () => loadPlanRows(clientId, startISO, endISO, blockId ?? null),
  });
  const today = format(new Date(), "yyyy-MM-dd");
  // keyed on the instants, never the Date objects (a default filter makes new ones every render)
  const sMs = start.getTime();
  const eMs = end.getTime();
  const load = useMemo(() => {
    const inRange = (results ?? []).filter((r: any) => {
      const t = r?.date ? new Date(r.date).getTime() : NaN;
      return t >= sMs && t <= eMs;
    });
    // never a plan for days after today: those are ahead, not missed
    return buildTrainingLoad({ sets: resultsToLoadSets(inRange), plan: plan.data ?? [], today });
  }, [results, sMs, eMs, plan.data, today]);
  return { load, planLoading: plan.isLoading, planError: plan.isError };
}
