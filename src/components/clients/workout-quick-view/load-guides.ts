/**
 * The load guidance on each exercise of the workout quick view: the same
 * reads, keys and engine as the athlete's logger (card-suggestion.ts and
 * card-suggestion-reads.ts), with the coach's own login, so the coach sees the
 * number the athlete's Suggested shows (their history, today's sets across
 * cards, warm-ups, readiness, bodyweight, the unit each card opens in) and the
 * weight a coach's % comes to today. Only for a workout still to do (today's,
 * one in progress, one ahead); a finished or missed one is its record.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAthleteEquipment } from "@/lib/equipment/equipment-queries";
import { getClientBodyweightKgSeries, smoothedBodyweightKgAt } from "@/lib/bodyweight";
import { listClientMaxes } from "@/lib/pl-maxes";
import { resolveWorkoutRowUnits, type WUnit } from "@/lib/workout-unit-resolution";
import { cardioLast } from "@/lib/workouts/workout-cardio";
import { referenceFamily, type LiftFamily } from "@/lib/workouts/load-reference";
import {
  dayGuides,
  historyByRow,
  liftIdentityOf,
  loadEquipmentByRow,
  readinessFromReview,
  type CardGuide,
} from "@/lib/workouts/card-suggestion";
import {
  fetchClientLiftHistory,
  fetchExerciseUnitHistory,
  fetchExerciseUnitPrefs,
  fetchFamilyUnitHistory,
  fetchLastOtherReview,
  fetchLoggedE1rmByFamily,
  fetchSessionWarmups,
  liftHistoryKey,
} from "@/lib/workouts/card-suggestion-reads";
import type { PeekDay, PeekEntry } from "@/lib/workout-peek";

/** A workout the athlete can still train: guidance says what to lift. One that's over is what they lifted. */
export function guidesShow(
  entry: Pick<PeekEntry, "status" | "date"> | null | undefined,
  today: string,
): boolean {
  if (!entry) return false;
  if (entry.status === "today" || entry.status === "in_progress") return true;
  return entry.status === "upcoming" && entry.date >= today;
}

export function usePeekLoadGuides({
  clientId,
  entry,
  day,
  record,
  today,
  live,
}: {
  clientId: string;
  entry: PeekEntry | null;
  day: PeekDay | null;
  record: {
    preferred_weight_unit?: string | null;
    weight_unit_confirmed_at?: string | null;
  } | null;
  today: string;
  /** The workout is being trained now: warm-ups refresh with the sets. */
  live: boolean;
}): { guides: Map<string, CardGuide>; loading: boolean } {
  const on = !!day && guidesShow(entry, today);
  const rows = useMemo(() => (on && day ? cardioLast(day.rows as any[]) : []), [on, day]);
  const results = (on && day ? day.sessionResults : []) as any[];
  const dayId = entry?.dayId ?? "";
  const instanceId = entry?.instanceId ?? null;
  const sessionKey = instanceId ? `instance:${instanceId}` : `day:${dayId}`;
  const rowIds = useMemo(() => rows.map((r) => r.id as string), [rows]);
  const exerciseIds = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.exercises?.id ?? r.exercise_id).filter(Boolean) as string[]),
      ),
    [rows],
  );

  // The machine each card is on decides which history counts (the logger's rule).
  const equipment = useAthleteEquipment(on ? clientId : null);
  const identities = useMemo(() => {
    const eq = loadEquipmentByRow(rows, results, equipment.data);
    return rows.map((r) => liftIdentityOf(r, eq.get(r.id) ?? null));
  }, [rows, results, equipment.data]);

  // Same keys as the logger's reads, so a coach who opens client view next reads them from cache.
  const history = useQuery({
    queryKey: liftHistoryKey(clientId, identities),
    enabled: on && identities.length > 0,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: () => fetchClientLiftHistory(clientId, identities),
  });
  const bodyweight = useQuery({
    queryKey: ["load-bodyweight", clientId],
    enabled: on,
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: () => getClientBodyweightKgSeries(clientId, 120),
  });
  const review = useQuery({
    queryKey: ["load-readiness", clientId, dayId],
    enabled: on,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => fetchLastOtherReview(clientId, dayId),
  });
  const needsMaxes = rows.some(
    (r) => !!r.percentage && r.percentage_basis && r.percentage_basis !== "manual",
  );
  const maxes = useQuery({
    queryKey: ["pl-client-maxes", clientId, entry?.blockId ?? null],
    enabled: on && needsMaxes,
    queryFn: () => listClientMaxes(clientId, entry?.blockId ?? null),
  });
  const e1rmFamilies = useMemo(() => {
    const out = new Set<LiftFamily>();
    for (const r of rows) {
      if (r.percentage_basis !== "est_1rm" || !r.percentage || r.manual_override) continue;
      const fam = referenceFamily({
        rowFamily: r.movement_family,
        competitionLiftType: r.exercises?.competition_lift_type,
        movementFamily: r.exercises?.movement_family,
      });
      if (fam) out.add(fam);
    }
    return [...out].sort();
  }, [rows]);
  const e1rm = useQuery({
    queryKey: ["logged-e1rm", "v2", clientId, e1rmFamilies.join(",")],
    enabled: on && e1rmFamilies.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => fetchLoggedE1rmByFamily(clientId, e1rmFamilies),
  });
  const warmups = useQuery({
    queryKey: ["client-peek-warmups", clientId, instanceId, rowIds.join(",")],
    enabled: on && rowIds.length > 0,
    staleTime: 30_000,
    refetchInterval: live ? 30_000 : false,
    queryFn: () => fetchSessionWarmups(clientId, rowIds, instanceId),
  });
  const ids = exerciseIds.join(",");
  const prefs = useQuery({
    queryKey: ["client-exercise-unit-prefs", "client", clientId, ids],
    enabled: on && exerciseIds.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchExerciseUnitPrefs(clientId, exerciseIds),
  });
  const unitHistory = useQuery({
    queryKey: ["client-exercise-unit-history", clientId, ids],
    enabled: on && exerciseIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => fetchExerciseUnitHistory(clientId, exerciseIds),
  });
  const familyHistory = useQuery({
    queryKey: ["client-lift-family-unit-history", clientId],
    enabled: on,
    staleTime: 5 * 60_000,
    queryFn: () => fetchFamilyUnitHistory(clientId),
  });

  const ready =
    on &&
    (identities.length === 0 || history.isSuccess || history.isError) &&
    !bodyweight.isLoading &&
    !review.isLoading &&
    (!needsMaxes || !maxes.isLoading) &&
    (e1rmFamilies.length === 0 || !e1rm.isLoading) &&
    !warmups.isLoading &&
    !prefs.isLoading &&
    !unitHistory.isLoading &&
    !familyHistory.isLoading &&
    !equipment.loading;

  const guides = useMemo(() => {
    if (!ready || !history.data) return new Map<string, CardGuide>();
    const chosen = record?.weight_unit_confirmed_at ? record.preferred_weight_unit : null;
    const units = resolveWorkoutRowUnits({
      rows,
      prefRows: (prefs.data ?? []) as any[],
      historyRows: (unitHistory.data ?? []) as any[],
      familyHistoryRows: (familyHistory.data ?? []) as any[],
      athleteChosenUnit: chosen === "kg" || chosen === "lb" ? chosen : null,
      overrides: {},
    });
    const series = bodyweight.data ?? [];
    return dayGuides({
      rows,
      results,
      units,
      fallbackUnit: (record?.preferred_weight_unit === "kg" ? "kg" : "lb") as WUnit,
      history: historyByRow(identities, history.data, sessionKey, series),
      bodyweightKg: smoothedBodyweightKgAt(series, Date.now()),
      readiness: readinessFromReview(review.data),
      warmups: warmups.data ?? new Map(),
      maxes: maxes.data ?? [],
      maxesPending: needsMaxes && maxes.isLoading,
      loggedE1rmByFamily: e1rm.data ?? null,
      e1rmPending: e1rm.isLoading,
    });
  }, [
    ready,
    history.data,
    rows,
    results,
    prefs.data,
    unitHistory.data,
    familyHistory.data,
    record?.weight_unit_confirmed_at,
    record?.preferred_weight_unit,
    bodyweight.data,
    identities,
    sessionKey,
    review.data,
    warmups.data,
    maxes.data,
    maxes.isLoading,
    needsMaxes,
    e1rm.data,
    e1rm.isLoading,
  ]);

  return { guides, loading: on && !ready };
}
