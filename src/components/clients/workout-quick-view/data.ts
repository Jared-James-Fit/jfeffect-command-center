/**
 * What the workout quick view reads, with the coach's own login (RLS decides:
 * an admin any client, a coach only their own).
 *
 * - The workouts: the coach's Schedule feed (getClientSchedule), under the
 *   Training tab's own key, so either screen fills the other's cache and a
 *   move made there shows here.
 * - One workout: its day, rows (with the exercise's details), the logged sets
 *   on those rows, its completions, the athlete's notes and the review. Two
 *   round trips; the ones either side of it are read ahead.
 * - The client: what the header and the Profile tab say.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PeekDaySource, PeekFeedback, PeekNote, PeekResult, PeekRow, PeekSchedule } from "@/lib/workout-peek";
import type { SrcCompletion } from "@/lib/workouts/training-report-data";

const sb = supabase as any;

type ScheduleFn = (args: { data: { clientId: string } }) => Promise<unknown>;

/** The Training tab's Schedule key (ScheduleManagerShell), shared on purpose. */
export const scheduleKey = (clientId: string) => ["client-schedule", clientId] as const;

export function peekScheduleQuery(fetchFn: ScheduleFn, clientId: string) {
  return queryOptions({
    queryKey: scheduleKey(clientId),
    queryFn: async () => (await fetchFn({ data: { clientId } })) as PeekSchedule,
    staleTime: 60_000,
    gcTime: 15 * 60_000,
  });
}

const ROW_COLS =
  "id, day_id, sort_order, exercise_name_override, sets, reps_text, rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit, rest_seconds, rest_seconds_override, tempo, notes, measurement_type, tracking_type, duration_seconds, purpose_label, movement_family, cardio_target_id, exercises(name, primary_muscle_group, muscle_group, equipment, cues, video_url, vimeo_url, youtube_url)";
const RESULT_COLS =
  "id, row_id, scheduled_workout_id, set_index, actual_reps, actual_load, actual_load_lb, actual_load_kg, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, actual_rpe, actual_rpe_num, actual_rir, completed_duration_seconds, actual_calories, actual_distance_m, actual_distance_unit, notes, completed_at, is_working_set";
const DAY_COLS = "id, title, subtitle, focus, notes, notes_client_visible, is_optional, day_index";
const COMPLETION_COLS = "id, day_id, scheduled_workout_id, started_at, in_progress_at, completed_at, client_notes";
const FEEDBACK_COLS = "overall_rating, session_rpe, client_note, pain, pain_area, pain_level, hit_target, fatigue_feel, strength_feel";

export const peekDayKey = (clientId: string, dayId: string) => ["client-peek-day", clientId, dayId] as const;

function must<T>(res: { data: T | null; error: { message?: string } | null }, what: string): T {
  if (res.error) throw new Error(`Couldn't read ${what}: ${res.error.message ?? "unknown error"}`);
  return (res.data ?? ([] as unknown)) as T;
}

/**
 * Everything one workout day holds for this client. Its completions are all
 * of them (the per-day row and any calendar instance's); buildPeekDay picks
 * the session the entry stands for.
 */
async function readPeekDay(clientId: string, dayId: string): Promise<PeekDaySource> {
  const [dayRes, rowsRes, complRes, notesRes] = await Promise.all([
    sb.from("pl_days").select(DAY_COLS).eq("id", dayId).maybeSingle(),
    sb.from("pl_exercise_rows").select(ROW_COLS).eq("day_id", dayId).order("sort_order", { ascending: true }),
    sb.from("pl_day_completions").select(COMPLETION_COLS).eq("client_id", clientId).eq("day_id", dayId),
    sb.from("pl_exercise_notes").select("id, row_id, exercise_name, content, updated_at").eq("client_id", clientId).eq("day_id", dayId),
  ]);
  const rows = must<PeekRow[]>(rowsRes, "the exercises");
  const completions = must<SrcCompletion[]>(complRes, "the workout's status");
  // the athlete's notes are a nice-to-have: a failed read never hides the workout
  const notes = (notesRes.error ? [] : notesRes.data ?? []) as PeekNote[];
  if (dayRes.error) throw new Error(`Couldn't read the workout: ${dayRes.error.message}`);

  const rowIds = rows.map((r) => r.id);
  const finished = completions.filter((c) => c.id).map((c) => c.id as string);
  const [resultsRes, feedbackRes] = await Promise.all([
    rowIds.length
      ? sb.from("pl_row_results").select(RESULT_COLS).eq("client_id", clientId).in("row_id", rowIds).order("set_index", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    finished.length
      ? sb.from("pl_workout_feedback").select(`completion_id, ${FEEDBACK_COLS}, updated_at`).in("completion_id", finished).order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const results = must<PeekResult[]>(resultsRes, "the logged sets");
  const reviews = (feedbackRes.error ? [] : feedbackRes.data ?? []) as Array<PeekFeedback & { completion_id: string }>;
  // the review of the finished session first, else the newest
  const doneIds = new Set(completions.filter((c) => c.completed_at).map((c) => c.id));
  const feedback = reviews.find((r) => doneIds.has(r.completion_id)) ?? reviews[0] ?? null;
  return { day: dayRes.data ?? null, rows, results, completions, notes, feedback };
}

export function peekDayQuery(clientId: string, dayId: string) {
  return queryOptions({
    queryKey: peekDayKey(clientId, dayId),
    queryFn: () => readPeekDay(clientId, dayId),
    staleTime: 30_000,
    gcTime: 15 * 60_000,
  });
}

/* ───────────────────────────── The client ───────────────────────────── */

export type PeekClientRecord = {
  id: string;
  full_name: string | null;
  profile_picture_url: string | null;
  email: string | null;
  phone: string | null;
  coaching_type: string | null;
  status: string | null;
  archived: boolean | null;
  service_tier: string | null;
  last_signed_in_at: string | null;
  last_active_at: string | null;
  created_at: string | null;
  committed_training_days: string[] | null;
  preferred_weight_unit: string | null;
  date_of_birth: string | null;
  assigned_coach_id: string | null;
  bodyweight_goal_type: string | null;
  bodyweight_goal_value: number | null;
  bodyweight_goal_unit: string | null;
  bodyweight_goal_date: string | null;
};

const CLIENT_COLS =
  "id, full_name, profile_picture_url, email, phone, coaching_type, status, archived, service_tier, last_signed_in_at, last_active_at, created_at, committed_training_days, preferred_weight_unit, date_of_birth, assigned_coach_id, bodyweight_goal_type, bodyweight_goal_value, bodyweight_goal_unit, bodyweight_goal_date";

export function peekClientQuery(clientId: string) {
  return queryOptions({
    queryKey: ["client-peek-record", clientId] as const,
    queryFn: async () => must<PeekClientRecord>(await sb.from("clients").select(CLIENT_COLS).eq("id", clientId).maybeSingle(), "the client"),
    staleTime: 60_000,
    gcTime: 15 * 60_000,
  });
}

export type PeekGoals = {
  main_goal: string | null;
  main_goal_other: string | null;
  goal_target: string | null;
  training_experience: string | null;
  training_days_per_week: number | null;
  workout_length_minutes: number | null;
  training_location: string | null;
  injuries_has: boolean | null;
  injuries_details: string | null;
  updated_at: string | null;
};

export type PeekCheckin = {
  id: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  answers: Record<string, unknown> | null;
  ai_status: string | null;
  ai_analysis: { summary?: string; fallback?: boolean; red_flags?: string[]; urgency?: string } | null;
};

export type PeekProfile = { goals: PeekGoals | null; checkin: PeekCheckin | null; coachName: string | null };

/** Goals & Setup, the last weekly check-in and the coach's name: the Profile tab's reads, each allowed to come back empty. */
export function peekProfileQuery(clientId: string, coachId: string | null) {
  return queryOptions({
    queryKey: ["client-peek-profile", clientId, coachId ?? null] as const,
    queryFn: async (): Promise<PeekProfile> => {
      const [goals, checkin, coach] = await Promise.all([
        sb
          .from("client_goals_setup")
          .select("main_goal, main_goal_other, goal_target, training_experience, training_days_per_week, workout_length_minutes, training_location, injuries_has, injuries_details, updated_at")
          .eq("client_id", clientId)
          .maybeSingle(),
        sb
          .from("messenger_checkins")
          .select("id, submitted_at, reviewed_at, answers, ai_status, ai_analysis")
          .eq("client_id", clientId)
          .eq("task_type", "weekly_checkin")
          .eq("status", "completed")
          .not("submitted_at", "is", null)
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        coachId ? sb.from("coaches").select("full_name").eq("id", coachId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      return {
        goals: goals.error ? null : (goals.data as PeekGoals | null),
        checkin: checkin.error ? null : (checkin.data as PeekCheckin | null),
        coachName: coach.error ? null : ((coach.data as { full_name?: string | null } | null)?.full_name ?? null),
      };
    },
    staleTime: 60_000,
    gcTime: 15 * 60_000,
  });
}
