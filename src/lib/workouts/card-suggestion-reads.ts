/**
 * The reads a card's load guidance is worked out from (card-suggestion.ts),
 * for a coaching client: the athlete's logger and the coach's workout quick
 * view call the same functions, with whoever is signed in (RLS decides), so
 * both read the same history, review, e1RMs, warm-ups and units.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/supabase-paginate";
import { normalizeWarmupRow, type WarmupSetRow } from "@/lib/final-warmup";
import { parseRpe } from "@/lib/load-suggestion";
import { resolveLoadType } from "@/lib/workout-load-type";
import type { PreviousLiftIdentity, PreviousLiftLog } from "@/lib/workout-previous-lift";
import { trainedOn } from "@/lib/workouts/exercise-history";
import { instanceDates } from "@/lib/workouts/history-reads";
import { loggedE1rm, type LiftFamily, type LoggedSet } from "@/lib/workouts/load-reference";

const sb = supabase as any;

/**
 * Every confirmed set of the lifts on a workout (drafts from "apply to remaining"
 * are not history), newest first, paged past the 1,000-row response cap so
 * long-term clients keep their full rep-max baselines.
 */
export async function fetchClientLiftHistory(
  ownerId: string,
  identities: PreviousLiftIdentity[],
): Promise<PreviousLiftLog[]> {
  const exerciseIds = Array.from(
    new Set(identities.map((identity) => identity.exerciseId).filter(Boolean) as string[]),
  );
  const fallbackNames = Array.from(
    new Set(
      identities
        .filter((identity) => !identity.exerciseId && identity.exerciseName)
        .map((identity) => identity.exerciseName),
    ),
  );
  if (!exerciseIds.length && !fallbackNames.length) return [];

  const columns = `id, row_id, scheduled_workout_id, completed_at, updated_at, created_at,
      actual_reps, actual_rpe, actual_rir, entered_value, entered_unit,
      normalized_kg, normalized_lb, actual_load, actual_load_unit, is_working_set,
      is_bodyweight, load_type, completed_duration_seconds, actual_calories, actual_distance_m, equipment_id,
      pl_exercise_rows!inner(exercise_id, exercise_name_override, day_id, purpose_label, sort_order, reps_text, exercises(name), pl_days(scheduled_date))`;
  const history = (filter: (q: any) => any) =>
    fetchAllPages(
      (from, to) =>
        filter(sb.from("pl_row_results").select(columns).eq("client_id", ownerId))
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      { maxRows: 10_000 },
    );
  const batches = await Promise.all([
    exerciseIds.length
      ? history((q) => q.in("pl_exercise_rows.exercise_id", exerciseIds))
      : Promise.resolve([]),
    fallbackNames.length
      ? history((q) => q.in("pl_exercise_rows.exercise_name_override", fallbackNames))
      : Promise.resolve([]),
  ]);
  const uniqueLogs = Array.from(new Map(batches.flat().map((log: any) => [log.id, log])).values());
  // The day each session was trained (trainedOn: its calendar day, a moved
  // workout's new one, never after it was logged), so "Last time · Sep 20"
  // says the same day as the History sheet.
  const instDates = await instanceDates(
    uniqueLogs.map((log: any) => log.scheduled_workout_id),
  ).catch(() => new Map<string, string>());
  return uniqueLogs.map((log: any) => {
    const historyRow = log.pl_exercise_rows;
    const enteredUnit =
      log.entered_unit === "kg" || log.entered_unit === "lb"
        ? log.entered_unit
        : log.actual_load_unit === "kg" || log.actual_load_unit === "lb"
          ? log.actual_load_unit
          : null;
    return {
      id: log.id,
      exerciseId: historyRow?.exercise_id ?? null,
      exerciseName: historyRow?.exercises?.name ?? historyRow?.exercise_name_override ?? null,
      sessionKey: log.scheduled_workout_id
        ? `instance:${log.scheduled_workout_id}`
        : `day:${historyRow?.day_id ?? "unknown"}`,
      occurredAt: log.completed_at ?? log.updated_at ?? log.created_at ?? null,
      trainedOn: trainedOn({
        instanceDate: log.scheduled_workout_id
          ? (instDates.get(log.scheduled_workout_id) ?? null)
          : null,
        dayDate: historyRow?.pl_days?.scheduled_date ?? null,
        loggedAt: log.completed_at ?? log.created_at ?? null,
      }),
      reps: log.actual_reps ?? null,
      rpe: log.actual_rpe ?? null,
      rir: log.actual_rir ?? null,
      enteredValue: log.entered_value ?? log.actual_load ?? null,
      enteredUnit,
      normalizedKg: log.normalized_kg ?? null,
      normalizedLb: log.normalized_lb ?? null,
      isWorkingSet: log.is_working_set ?? null,
      loadType: resolveLoadType(log.load_type, log.is_bodyweight),
      purposeLabel: historyRow?.purpose_label ?? null,
      repsText: historyRow?.reps_text ?? null,
      rowId: log.row_id ?? null,
      rowOrder: historyRow?.sort_order ?? null,
      durationSeconds: log.completed_duration_seconds ?? null,
      calories: log.actual_calories ?? null,
      distanceM: log.actual_distance_m != null ? Number(log.actual_distance_m) : null,
      equipmentId: log.equipment_id ?? null,
    } as PreviousLiftLog;
  });
}

/** The key a client's lift history is cached under: who and which lifts, so days that share lifts share one download. */
export function liftHistoryKey(ownerId: string | null, identities: PreviousLiftIdentity[]) {
  const ids = identities
    .map((identity) => `${identity.exerciseId ?? "name"}:${identity.exerciseName}`)
    .sort()
    .join("|");
  return ["workout-previous-lifts", "client", ownerId, null, ids] as const;
}

/** "% of e1RM" rows with no e1RM stored: one worked out from their logged competition sets in the last 6 weeks (loggedE1rm). */
export async function fetchLoggedE1rmByFamily(
  clientId: string,
  families: LiftFamily[],
): Promise<Partial<Record<LiftFamily, number>>> {
  const since = new Date(Date.now() - 42 * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("pl_row_results")
    .select(
      "normalized_kg, actual_load, actual_load_unit, actual_reps, actual_rpe_num, actual_rpe, completed_at, load_type, is_bodyweight, pl_exercise_rows!inner(exercises!inner(competition_lift_type))",
    )
    .eq("client_id", clientId)
    .not("completed_at", "is", null)
    .gte("completed_at", since)
    .in("pl_exercise_rows.exercises.competition_lift_type", families)
    .order("completed_at", { ascending: false })
    .limit(600);
  if (error) throw error;
  const byFamily = new Map<LiftFamily, LoggedSet[]>();
  for (const x of (data ?? []) as any[]) {
    if (resolveLoadType(x.load_type, x.is_bodyweight) !== "external") continue;
    const fam = String(x.pl_exercise_rows?.exercises?.competition_lift_type ?? "") as LiftFamily;
    const kg =
      x.normalized_kg != null
        ? Number(x.normalized_kg)
        : x.actual_load_unit === "lb"
          ? Number(x.actual_load) * 0.45359237
          : Number(x.actual_load);
    byFamily.set(fam, [
      ...(byFamily.get(fam) ?? []),
      {
        kg,
        reps: Number(x.actual_reps),
        rpe: parseRpe(x.actual_rpe_num ?? x.actual_rpe),
        at: x.completed_at,
      },
    ]);
  }
  const out: Partial<Record<LiftFamily, number>> = {};
  for (const [fam, sets] of byFamily) {
    const e = loggedE1rm(sets);
    if (e) out[fam] = e.kg;
  }
  return out;
}

/** The athlete's most recent workout review of another day (what readiness is predicted from). */
export async function fetchLastOtherReview(clientId: string, dayId: string) {
  const { data, error } = await sb
    .from("pl_workout_feedback")
    .select("review_submitted_at, session_rpe, pain, sleep_bucket, recovery_today, review_version")
    .eq("client_id", clientId)
    .neq("day_id", dayId)
    .order("review_submitted_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

/** One session's warm-ups for a workout's cards (pl_warmup_sets), by card, oldest first. */
export async function fetchSessionWarmups(
  clientId: string,
  rowIds: string[],
  scheduledWorkoutId: string | null,
): Promise<Map<string, WarmupSetRow[]>> {
  const out = new Map<string, WarmupSetRow[]>();
  if (!rowIds.length) return out;
  let q = sb
    .from("pl_warmup_sets")
    .select("id,row_id,load,unit,reps,rpe,created_at")
    .in("row_id", rowIds)
    .eq("client_id", clientId);
  q = scheduledWorkoutId
    ? q.eq("scheduled_workout_id", scheduledWorkoutId)
    : q.is("scheduled_workout_id", null);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw error;
  for (const r of (data ?? []) as any[]) {
    const row = normalizeWarmupRow(r);
    if (!row) continue;
    out.set(r.row_id, [...(out.get(r.row_id) ?? []), row]);
  }
  return out;
}

/* ── The unit each card opens in (resolveWorkoutRowUnits reads these three) ── */

/** The athlete's saved unit for each exercise (a tap on the card's kg | lb). */
export async function fetchExerciseUnitPrefs(clientId: string, exerciseIds: string[]) {
  if (!exerciseIds.length) return [];
  return (
    (
      await sb
        .from("client_exercise_unit_prefs")
        .select("exercise_id, unit")
        .eq("client_id", clientId)
        .in("exercise_id", exerciseIds)
    ).data ?? []
  );
}

/** The newest loaded sets of each exercise in the workout. */
export async function fetchExerciseUnitHistory(clientId: string, exerciseIds: string[]) {
  if (!exerciseIds.length) return [];
  return (
    (
      await sb
        .from("pl_row_results")
        .select("actual_load_unit, actual_load, pl_exercise_rows!inner(exercise_id)")
        .eq("client_id", clientId)
        .in("pl_exercise_rows.exercise_id", exerciseIds)
        .not("actual_load_unit", "is", null)
        .gt("actual_load", 0)
        .order("created_at", { ascending: false })
        .limit(400)
    ).data ?? []
  );
}

/** The athlete's latest loaded logs of anything: the unit of their squat / bench / deadlift, and their habit. */
export async function fetchFamilyUnitHistory(clientId: string) {
  return (
    (
      await sb
        .from("pl_row_results")
        .select("actual_load_unit, actual_load, pl_exercise_rows(exercises(movement_family))")
        .eq("client_id", clientId)
        .not("actual_load_unit", "is", null)
        .gt("actual_load", 0)
        .order("created_at", { ascending: false })
        .limit(150)
    ).data ?? []
  );
}
