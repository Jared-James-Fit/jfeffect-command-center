import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import {
  normalizePlan,
  planFromDays,
  planIssue,
  planPayload,
  type ProgramPlan,
} from "@/lib/program-plan";

/**
 * Programs people build themselves (athlete_programs, 20270128090000_free_platform.sql):
 * blocks of weeks of training days (`plan`, program-plan.ts; one written out
 * per week since 20270418090000_member_programs_blocks_weeks.sql), library
 * exercises only.
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
  /** how many blocks (1 for a program from before blocks) */
  blocks?: number;
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
  /** week 1, with names (what older apps read) */
  days: ProgramDay[];
  /** the whole program; null for one saved before plans (its week repeated) */
  plan?: unknown | null;
  /** names for every exercise the plan uses */
  exercise_info?: Record<string, { name?: string | null; muscle_group?: string | null; equipment?: string | null }>;
};

/** A program's plan as the builder and the program page read it. */
export function detailPlan(p: Pick<ProgramDetail, "plan" | "exercise_info" | "days" | "weeks">): ProgramPlan {
  return normalizePlan(p.plan, p.exercise_info ?? undefined) ?? planFromDays(p.days ?? [], p.weeks || 1);
}

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

/** What the builder edits. */
export type ProgramDraft = {
  id?: string | null;
  title: string;
  description: string;
  goal: ProgramGoal | null;
  level: ProgramLevel | null;
  plan: ProgramPlan;
};

/** First thing to fix before saving (the database checks the same), or null. */
export function draftIssue(d: ProgramDraft) {
  return planIssue(d.title, d.plan);
}
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
      const { data, error } = await rpc("athlete_program_save_plan", {
        _id: d.id ?? null,
        _title: d.title.trim(),
        _description: d.description.trim() || null,
        _goal: d.goal,
        _level: d.level,
        _plan: planPayload(d.plan),
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
      // its first version says it was copied (best effort; the copy is made either way)
      void rpc("athlete_program_version_tag", { _program_id: data, _source: "copy", _restored_from: null }).then(
        () => undefined,
        () => undefined,
      );
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
  // Undo a delete (within 30 days): it comes back exactly as it was, sharing included
  const restore = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpc("athlete_program_restore", { _id: id });
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
  return { save, share, copy, remove, restore, moderate };
}

/** "12 weeks · 3 blocks · 4 days a week · 18 exercises" */
export function programMeta(
  p: Pick<ProgramCard, "weeks" | "days_per_week" | "exercise_count"> & { blocks?: number },
): string {
  const parts = [
    `${p.weeks} ${p.weeks === 1 ? "week" : "weeks"}`,
    ...(p.blocks && p.blocks > 1 ? [`${p.blocks} blocks`] : []),
    `${p.days_per_week} ${p.days_per_week === 1 ? "day" : "days"} a week`,
  ];
  if (p.exercise_count) parts.push(`${p.exercise_count} exercises`);
  return parts.join(" · ");
}

export function authorHandle(a: Author): string {
  if (!a) return "someone";
  return a.username ? `@${a.username}` : a.name || "someone";
}
