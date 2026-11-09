import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Programs people build themselves (athlete_programs, 20270128090000_free_platform.sql).
 * One week of training days repeated for `weeks` weeks; library exercises only.
 * Private until shared with the crew; anyone who can see a shared one can save
 * their own copy (the original never changes); a self-serve member starts their
 * own copy as a program on their calendar (startMyProgram).
 */

export type ProgramGoal =
  | "strength"
  | "muscle"
  | "fat_loss"
  | "powerlifting"
  | "general"
  | "athletic";
export type ProgramLevel = "beginner" | "intermediate" | "advanced";

export const GOALS: { id: ProgramGoal; label: string }[] = [
  { id: "muscle", label: "Build muscle" },
  { id: "strength", label: "Get stronger" },
  { id: "powerlifting", label: "Powerlifting" },
  { id: "fat_loss", label: "Lose fat" },
  { id: "general", label: "General fitness" },
  { id: "athletic", label: "Athletic" },
];
export const LEVELS: { id: ProgramLevel; label: string }[] = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];
export const goalLabel = (g: string | null | undefined) =>
  GOALS.find((x) => x.id === g)?.label ?? null;
export const levelLabel = (l: string | null | undefined) =>
  LEVELS.find((x) => x.id === l)?.label ?? null;

export type ProgramExercise = {
  exercise_id: string;
  sets: number;
  reps: string;
  rpe?: string | null;
  rest_seconds?: number | null;
  notes?: string | null;
  /** read back from the library (detail only) */
  name?: string | null;
  muscle_group?: string | null;
  equipment?: string | null;
};
export type ProgramDay = { title: string; focus?: string | null; exercises: ProgramExercise[] };

export type Author = {
  user_id?: string;
  name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
} | null;

export type ProgramCard = {
  id: string;
  title: string;
  description: string | null;
  goal: ProgramGoal | null;
  level: ProgramLevel | null;
  weeks: number;
  days_per_week: number;
  exercise_count: number;
  visibility: "private" | "community";
  published_at: string | null;
  updated_at: string;
  save_count: number;
  start_count: number;
  hidden: boolean;
  is_mine: boolean;
  author: Author;
  day_titles: string[];
  forked_from: { id: string | null; author: Author } | null;
};

export type ProgramDetail = ProgramCard & {
  hidden_reason: string | null;
  can_moderate: boolean;
  copied: boolean;
  days: ProgramDay[];
};

export type BrowseScope = "community" | "mine";
export type BrowseFilters = {
  q?: string;
  goal?: ProgramGoal | null;
  level?: ProgramLevel | null;
  days?: number | null;
  sort?: "popular" | "new";
};

const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args);

export const programKeys = {
  all: ["athlete-programs"] as const,
  list: (scope: BrowseScope, f: BrowseFilters) => ["athlete-programs", "list", scope, f] as const,
  detail: (id: string) => ["athlete-programs", "detail", id] as const,
};

export function usePrograms(scope: BrowseScope, f: BrowseFilters, enabled = true) {
  return useQuery({
    queryKey: programKeys.list(scope, f),
    enabled,
    staleTime: 60_000,
    // a new search or filter keeps the last list up until its answer lands
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ProgramCard[]> => {
      const { data, error } = await rpc("athlete_programs_browse", {
        _scope: scope,
        _q: f.q?.trim() || null,
        _goal: f.goal ?? null,
        _level: f.level ?? null,
        _days: f.days ?? null,
        _sort: f.sort ?? "popular",
        _limit: 60,
        _offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as ProgramCard[];
    },
  });
}

export function useProgram(id: string | null | undefined) {
  return useQuery({
    queryKey: programKeys.detail(id ?? ""),
    enabled: !!id,
    queryFn: async (): Promise<ProgramDetail | null> => {
      const { data, error } = await rpc("athlete_program_detail", { _id: id });
      if (error) throw error;
      return (data ?? null) as ProgramDetail | null;
    },
  });
}

/** What the builder edits: the days as the database stores them. */
export type ProgramDraft = {
  id?: string | null;
  title: string;
  description: string;
  goal: ProgramGoal | null;
  level: ProgramLevel | null;
  weeks: number;
  days: ProgramDay[];
};

/** The plain form the save RPC takes (names and library details stripped). */
export function draftDaysPayload(days: ProgramDay[]) {
  return days.map((d) => ({
    title: d.title.trim(),
    focus: d.focus?.trim() || null,
    exercises: d.exercises.map((e) => ({
      exercise_id: e.exercise_id,
      sets: Number(e.sets),
      reps: String(e.reps ?? "").trim(),
      rpe: e.rpe ? String(e.rpe).trim() : null,
      rest_seconds: e.rest_seconds ?? null,
      notes: e.notes?.trim() || null,
    })),
  }));
}

/**
 * First thing to fix before saving (the database checks the same things), and
 * where it is: the name, the week as a whole, or a day (its index), so the
 * builder can take the person straight to it. Null when it can be saved.
 */
export function draftIssue(
  d: ProgramDraft,
): { message: string; at: "title" | "days" | number } | null {
  if (d.title.trim().length < 2) return { message: "Give your program a name.", at: "title" };
  if (!d.days.length) return { message: "Add a training day.", at: "days" };
  if (d.days.length > 7) return { message: "A week has at most 7 training days.", at: "days" };
  for (const [i, day] of d.days.entries()) {
    const name = day.title.trim() || `Day ${i + 1}`;
    const at = (message: string) => ({ message, at: i });
    if (!day.exercises.length) return at(`Add an exercise to ${name}.`);
    if (day.exercises.length > 20) return at(`${name} has more than 20 exercises.`);
    for (const e of day.exercises) {
      const sets = Number(e.sets);
      if (!Number.isInteger(sets) || sets < 1 || sets > 20)
        return at(`Sets must be 1 to 20 (${name}).`);
      if (!String(e.reps ?? "").trim()) return at(`Every exercise needs reps (${name}).`);
      if (e.rpe && !/^(10|[1-9](\.5)?)(-(10|[1-9](\.5)?))?$/.test(String(e.rpe).trim()))
        return at(`RPE is 1 to 10, like 8 or 7-8 (${name}).`);
    }
  }
  return null;
}

/** First thing to fix before saving, or null. */
export function draftProblem(d: ProgramDraft): string | null {
  return draftIssue(d)?.message ?? null;
}

/** Postgres raises plain sentences for the person; anything else gets a generic line. */
export function programError(e: any, fallback: string): string {
  const m = String(e?.message ?? "");
  return m && m.length < 140 && !/violates|syntax|function|relation|column/i.test(m) ? m : fallback;
}

export function useProgramActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: programKeys.all });

  const save = useMutation({
    mutationFn: async (d: ProgramDraft): Promise<string> => {
      const { data, error } = await rpc("athlete_program_save", {
        _id: d.id ?? null,
        _title: d.title.trim(),
        _description: d.description.trim() || null,
        _goal: d.goal,
        _level: d.level,
        _weeks: d.weeks,
        _days: draftDaysPayload(d.days),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: refresh,
  });
  const share = useMutation({
    mutationFn: async ({ id, shared }: { id: string; shared: boolean }) => {
      const { error } = await rpc("athlete_program_set_shared", { _id: id, _shared: shared });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const copy = useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const { data, error } = await rpc("athlete_program_copy", { _id: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpc("athlete_program_delete", { _id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const moderate = useMutation({
    mutationFn: async ({ id, hide, reason }: { id: string; hide: boolean; reason?: string }) => {
      const { error } = await rpc("athlete_program_moderate", {
        _id: id,
        _hide: hide,
        _reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  return { save, share, copy, remove, moderate };
}

/** "4 weeks · 3 days a week · 18 exercises" */
export function programMeta(
  p: Pick<ProgramCard, "weeks" | "days_per_week" | "exercise_count">,
): string {
  const parts = [
    `${p.weeks} ${p.weeks === 1 ? "week" : "weeks"}`,
    `${p.days_per_week} ${p.days_per_week === 1 ? "day" : "days"} a week`,
  ];
  if (p.exercise_count) parts.push(`${p.exercise_count} exercises`);
  return parts.join(" · ");
}

export function authorHandle(a: Author): string {
  if (!a) return "someone";
  return a.username ? `@${a.username}` : a.name || "someone";
}
