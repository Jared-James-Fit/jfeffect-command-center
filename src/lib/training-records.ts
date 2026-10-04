/**
 * Training records — ATPR / PROGRAM PR / BLOCK PR, rep PRs and tonnage.
 *
 * Computed server-side from logged sets (see supabase migration
 * 20261003210000_training_records_atpr.sql); nothing is cached in the DB, so a
 * corrected, deleted or reopened workout can never keep a stale badge.
 *
 * Terminology (never a bare "PR"):
 *   ATPR        all-time personal record
 *   PROGRAM PR  best during that program
 *   BLOCK PR    best during that block
 *   N-REP …     best for that exact completed rep count in that scope
 *   WEIGHT …    heaviest load on the lift in that scope, any reps
 *   TONNAGE     Σ qualifying completed load × reps
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const KG_TO_LB = 2.2046226218;

export type RecordScope = "atpr" | "program_pr" | "block_pr";

export type RepRecord = {
  set_id: string;
  exercise_id: string | null;
  exercise_key: string;
  exercise_name: string;
  reps: number;
  load_kg: number;
  atpr: boolean;
  program_pr: boolean;
  block_pr: boolean;
  prev_all_kg?: number | null;
  prev_program_kg?: number | null;
  prev_block_kg?: number | null;
};

export type TonnageRecord = {
  atpr: boolean;
  program_pr: boolean;
  block_pr: boolean;
  prev_all_kg?: number | null;
};

export type WorkoutRecords = {
  workout_key: string;
  tonnage_kg: number;
  tonnage: TonnageRecord;
  records: RepRecord[];
  /** Weight records: the workout's heaviest set on a lift vs every earlier heaviest (any reps). */
  load_records?: RepRecord[];
  exercise_tonnage: { exercise_key: string; exercise_name: string; tonnage_kg: number }[];
};

export const SCOPE_LABEL: Record<RecordScope, string> = {
  atpr: "ATPR",
  program_pr: "PROGRAM PR",
  block_pr: "BLOCK PR",
};

/** Highest-priority scope a record earned: ATPR > PROGRAM PR > BLOCK PR. */
export function topScope(r: { atpr: boolean; program_pr: boolean; block_pr: boolean }): RecordScope | null {
  if (r.atpr) return "atpr";
  if (r.program_pr) return "program_pr";
  if (r.block_pr) return "block_pr";
  return null;
}

/** Every scope earned, in priority order (one performance can earn several). */
export function earnedScopes(r: { atpr: boolean; program_pr: boolean; block_pr: boolean }): RecordScope[] {
  return (["atpr", "program_pr", "block_pr"] as const).filter((s) => r[s]);
}

/** "5-REP ATPR", "6-REP BLOCK PR" … */
export function repRecordLabel(r: Pick<RepRecord, "reps" | "atpr" | "program_pr" | "block_pr">): string | null {
  const s = topScope(r);
  return s ? `${r.reps}-REP ${SCOPE_LABEL[s]}` : null;
}

/** Secondary scopes worth mentioning without spamming ("also a PROGRAM PR"). */
export function alsoLabel(r: { atpr: boolean; program_pr: boolean; block_pr: boolean }): string | null {
  const [, ...rest] = earnedScopes(r);
  // An ATPR is by definition also the program/block best — say it once, quietly.
  if (rest.length === 0) return null;
  return rest.map((s) => SCOPE_LABEL[s]).join(" · ");
}

/** "WEIGHT ATPR" — heaviest load ever on the lift (any reps), per scope. */
export function weightRecordLabel(r: { atpr: boolean; program_pr: boolean; block_pr: boolean } | null | undefined): string | null {
  const s = r ? topScope(r) : null;
  return s ? `WEIGHT ${SCOPE_LABEL[s]}` : null;
}

export function tonnageRecordLabel(t: TonnageRecord | null | undefined): string | null {
  if (!t) return null;
  const s = topScope(t);
  return s === "atpr" ? "WORKOUT TONNAGE ATPR" : s === "program_pr" ? "PROGRAM TONNAGE PR" : s === "block_pr" ? "BLOCK TONNAGE PR" : null;
}

export function kgTo(unit: "kg" | "lb", kg: number): number {
  return unit === "lb" ? kg * KG_TO_LB : kg;
}

/** Loads display like the logger: whole/half units. */
export function formatLoad(kg: number, unit: "kg" | "lb"): string {
  const v = kgTo(unit, kg);
  const rounded = unit === "lb" ? Math.round(v * 2) / 2 : Math.round(v * 4) / 4;
  return `${Number(rounded.toFixed(2))} ${unit}`;
}

export function formatTonnage(kg: number, unit: "kg" | "lb"): string {
  return `${Math.round(kgTo(unit, kg)).toLocaleString()} ${unit}`;
}

export function workoutRecordsKey(clientId: string | null | undefined, scheduledWorkoutId: string | null | undefined, dayId: string | null | undefined) {
  return ["workout-records", clientId ?? null, scheduledWorkoutId ?? null, scheduledWorkoutId ? null : dayId ?? null] as const;
}

export async function fetchWorkoutRecords(clientId: string, scheduledWorkoutId: string | null, dayId: string | null): Promise<WorkoutRecords | null> {
  const { data, error } = await (supabase as any).rpc("workout_records", {
    _client_id: clientId,
    _scheduled_workout_id: scheduledWorkoutId,
    _day_id: scheduledWorkoutId ? null : dayId,
  });
  if (error) throw error;
  return (data ?? null) as WorkoutRecords | null;
}

/**
 * Records for one workout. `version` should change whenever a set is saved,
 * edited or deleted so the badges follow the data (live during logging).
 */
export function useWorkoutRecords(
  clientId: string | null | undefined,
  scheduledWorkoutId: string | null | undefined,
  dayId: string | null | undefined,
  version: string | number = 0,
  enabled = true,
) {
  return useQuery({
    queryKey: [...workoutRecordsKey(clientId, scheduledWorkoutId, dayId), version],
    enabled: enabled && !!clientId && (!!scheduledWorkoutId || !!dayId),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: () => fetchWorkoutRecords(clientId!, scheduledWorkoutId ?? null, dayId ?? null),
  });
}

export type ExerciseRecords = {
  rep_bests: {
    reps: number;
    atpr: { load_kg: number; at: string } | null;
    program: { load_kg: number; at: string } | null;
    block: { load_kg: number; at: string } | null;
  }[];
  current_block: string | null;
  current_program: string | null;
};

export function useExerciseRecords(clientId: string | null | undefined, exerciseId: string | null | undefined, exerciseName?: string | null) {
  return useQuery({
    queryKey: ["exercise-records", clientId ?? null, exerciseId ?? null, exerciseId ? null : exerciseName ?? null],
    enabled: !!clientId && (!!exerciseId || !!exerciseName),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("exercise_records", {
        _client_id: clientId, _exercise_id: exerciseId ?? null, _exercise_name: exerciseId ? null : exerciseName ?? null,
      });
      if (error) throw error;
      return (data ?? null) as ExerciseRecords | null;
    },
  });
}

export type RecentRecords = {
  records: (Omit<RepRecord, "set_id" | "exercise_key"> & { workout_key: string; at: string })[];
  load_records?: (Omit<RepRecord, "set_id" | "exercise_key"> & { workout_key: string; at: string })[];
  tonnage: (TonnageRecord & { workout_key: string; at: string; tonnage_kg: number })[];
};

export function useRecentRecords(clientId: string | null | undefined, days = 60) {
  return useQuery({
    queryKey: ["recent-records", clientId ?? null, days],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await (supabase as any).rpc("client_recent_records", { _client_id: clientId, _since: since });
      if (error) throw error;
      return (data ?? { records: [], tonnage: [] }) as RecentRecords;
    },
  });
}
