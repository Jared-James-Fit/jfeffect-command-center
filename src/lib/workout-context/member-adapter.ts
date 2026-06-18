/**
 * Membership adapter. Phase 1 skeleton — methods throw NotImplemented
 * until Phase 2 wires them onto member_plan_enrollments / member_set_logs /
 * member_workout_completions. Capabilities deliberately deny coach-only
 * write paths (template edits, coach notes) so members cannot escalate
 * even if a shared component forgets to check.
 */
import {
  type WorkoutContextAdapter,
  type WorkoutContextRef,
  type WorkoutScheduleDay,
  type WorkoutCompletion,
  type RescheduleInput,
  type LogSetInput,
  type WorkoutDay,
  type ExerciseRowDTO,
  type RowResultDTO,
  type ExerciseNoteDTO,
  type HistoryEntryDTO,
  type MaxEntryDTO,
  type DayCompletionDTO,
  type DayCompletionPatch,
  type RowBlockSummaryDTO,
  type CoachPainFlagDTO,
  type UpsertRowResultInput,
  type UpsertExerciseNoteInput,
  type EnrollmentSummaryDTO,
  type ReviewDTO,
  type PlDayRaw,
  type PlRowRaw,
  type PlRowResultRaw,
} from "./types";
import {
  getEnrollmentSchedule,
  rescheduleDay,
  logSet as logSetFn,
  completeWorkout,
  uncompleteWorkout,
} from "@/lib/member-plans.functions";
import { supabase } from "@/integrations/supabase/client";

/**
 * Members address workouts by (week_index, day_index) tuples — there is
 * no per-day UUID like the coaching pl_days table. The adapter encodes
 * those tuples into a synthetic `dayId` string `"w:d"` so the shared
 * UI can keep using a flat string id. Decoded on every write below.
 */
function encodeDayId(week: number, day: number) {
  return `${week}:${day}`;
}
function decodeDayId(id: string): { week: number; day: number } {
  const [w, d] = id.split(":").map((n) => Number(n));
  if (!Number.isFinite(w) || !Number.isFinite(d)) {
    throw new Error(`member adapter: invalid dayId ${id}`);
  }
  return { week: w, day: d };
}

function decodeRowId(rowId: string): number {
  // Shared UI generates rowId as "ex:<index>" for member context.
  const m = /^ex:(\d+)$/.exec(rowId);
  if (!m) throw new Error(`member adapter: rowId must be "ex:<index>", got ${rowId}`);
  return Number(m[1]);
}

/**
 * The member set log id is synthetic (a single row uniquely identified by
 * enrollment/week/day/exercise/set). We use a composite string so the
 * shared UI can pass it back to `deleteRowResult`.
 */
function encodeRowResultId(weekIndex: number, dayIndex: number, exerciseIndex: number, setIndex: number) {
  return `mlog:${weekIndex}:${dayIndex}:${exerciseIndex}:${setIndex}`;
}
function decodeRowResultId(id: string) {
  const m = /^mlog:(\d+):(\d+):(\d+):(\d+)$/.exec(id);
  if (!m) throw new Error(`member adapter: invalid row result id ${id}`);
  return {
    weekIndex: Number(m[1]),
    dayIndex: Number(m[2]),
    exerciseIndex: Number(m[3]),
    setIndex: Number(m[4]),
  };
}

/** yyyy-MM-dd date arithmetic kept local — UTC parsing avoids tz drift. */
function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}
function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function daysBetween(fromYmd: string, toYmd: string): number {
  const ms = parseYmd(toYmd).getTime() - parseYmd(fromYmd).getTime();
  return Math.round(ms / 86_400_000);
}
function addDays(ymd: string, delta: number): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + delta);
  return formatYmd(d);
}

/** Locate the day object inside `member_plans.published_payload`. */
async function loadPublishedDay(enrollmentId: string, weekIndex: number, dayIndex: number) {
  const { data, error } = await supabase
    .from("member_plan_enrollments")
    .select("member_plans(published_payload)")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const payload = (data as any)?.member_plans?.published_payload ?? null;
  const weeks = (payload?.weeks_data ?? []) as any[];
  const week = weeks[weekIndex - 1] ?? null;
  const day = week?.days?.[dayIndex - 1] ?? null;
  return { payload, week, day };
}

export function createMemberAdapter(ref: WorkoutContextRef): WorkoutContextAdapter {
  if (ref.kind !== "member") throw new Error("createMemberAdapter requires kind=member");
  if (!ref.enrollmentId) throw new Error("member adapter requires enrollmentId");
  const enrollmentId = ref.enrollmentId;
  return {
    kind: "member",
    ref,
    capabilities: {
      canEditTemplate: false,
      canEditOwnLogs: true,
      canReschedule: true,
      canSubstituteExercise: false, // membership programs are static library entries
      canSeeCoachNotes: false,
      canSeeCoachIntel: false,
      canLeaveCoachFeedback: false,
      canSeeAdminNotes: false,
      canAssignPrograms: false,
    },
    async listSchedule(opts): Promise<WorkoutScheduleDay[]> {
      const { schedule } = await getEnrollmentSchedule({ data: { enrollmentId } });
      // Pull plan payload for titles + completions in parallel.
      const [planRes, completionsRes] = await Promise.all([
        supabase
          .from("member_plan_enrollments")
          .select("member_plans(published_payload)")
          .eq("id", enrollmentId)
          .maybeSingle(),
        supabase
          .from("member_workout_completions")
          .select("week_index, day_index, completed_at")
          .eq("enrollment_id", enrollmentId),
      ]);
      const weeksData =
        ((planRes.data as any)?.member_plans?.published_payload?.weeks_data ?? []) as any[];
      const titleByKey = new Map<string, string | null>();
      for (const w of weeksData) {
        for (const d of w.days ?? []) {
          titleByKey.set(`${w.week_index}:${d.day_index}`, d.title ?? d.focus ?? null);
        }
      }
      const compByKey = new Map<string, string>();
      for (const c of (completionsRes.data ?? []) as any[]) {
        if (c.completed_at) compByKey.set(`${c.week_index}:${c.day_index}`, c.completed_at);
      }
      const from = opts?.fromDate ?? null;
      const to = opts?.toDate ?? null;
      const out: WorkoutScheduleDay[] = [];
      for (const s of schedule ?? []) {
        if (from && s.date < from) continue;
        if (to && s.date > to) continue;
        const key = `${s.week}:${s.day}`;
        const completedAt = compByKey.get(key) ?? null;
        out.push({
          id: encodeDayId(s.week, s.day),
          date: s.date,
          week: s.week,
          day: s.day,
          title: titleByKey.get(key) ?? null,
          blockId: null,
          blockName: null,
          completed: !!completedAt,
          completedAt,
        });
      }
      out.sort((a, b) => a.date.localeCompare(b.date));
      return out;
    },
    async listCompletions(opts): Promise<WorkoutCompletion[]> {
      const { data, error } = await supabase
        .from("member_workout_completions")
        .select("id, week_index, day_index, completed_at")
        .eq("enrollment_id", enrollmentId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(opts?.limit ?? 200);
      if (error) throw new Error(error.message);
      return (data ?? []).map((c: any) => ({
        id: c.id,
        dayId: encodeDayId(c.week_index, c.day_index),
        week: c.week_index,
        day: c.day_index,
        completedAt: c.completed_at,
      }));
    },
    async reschedule(input: RescheduleInput): Promise<void> {
      const { week, day } = decodeDayId(input.dayId);
      if (input.scope === "this_workout_only") {
        await rescheduleDay({
          data: {
            enrollmentId,
            weekIndex: week,
            dayIndex: day,
            scheduledDate: input.newDate,
          },
        });
        return;
      }
      // Fan-out scopes: compute the day delta from the day being moved,
      // then shift every affected (week, day) pair by the same number of
      // calendar days. Uses the current resolved schedule (defaults +
      // existing overrides) as the source of truth.
      const { schedule } = await getEnrollmentSchedule({ data: { enrollmentId } });
      const target = (schedule ?? []).find(
        (s: any) => s.week === week && s.day === day,
      );
      if (!target) throw new Error(`member adapter: day ${week}:${day} not in schedule`);
      const deltaDays = daysBetween(target.date, input.newDate);
      if (deltaDays === 0) return;
      const affected = (schedule ?? []).filter((s: any) => {
        if (input.scope === "this_week_only") return s.week === week;
        if (input.scope === "all_future_weeks") {
          // Same day-of-program slot, this week and every future week.
          return s.day === day && s.week >= week;
        }
        // entire_schedule
        return true;
      });
      // Sequential to avoid racing the same row through upsert ordering.
      for (const s of affected) {
        await rescheduleDay({
          data: {
            enrollmentId,
            weekIndex: s.week,
            dayIndex: s.day,
            scheduledDate: addDays(s.date, deltaDays),
          },
        });
      }
    },
    async logSet(input: LogSetInput): Promise<void> {
      const { week, day } = decodeDayId(input.dayId);
      // rowId on the member side encodes the exercise index — shared UI
      // generates rowId as `"ex:<index>"` so the adapter can decode.
      const exerciseIndex = (() => {
        const m = /^ex:(\d+)$/.exec(input.rowId);
        if (!m) throw new Error(`member adapter: rowId must be "ex:<index>", got ${input.rowId}`);
        return Number(m[1]);
      })();
      await logSetFn({
        data: {
          enrollmentId,
          weekIndex: week,
          dayIndex: day,
          exerciseIndex,
          setIndex: input.setIndex,
          reps: input.reps ?? null,
          load_lb: input.loadLb ?? null,
          rpe: input.rpe ?? null,
          rir: input.rir ?? null,
          notes: input.notes ?? null,
        },
      });
    },
    async completeDay(dayId: string): Promise<void> {
      const { week, day } = decodeDayId(dayId);
      await completeWorkout({
        data: { enrollmentId, weekIndex: week, dayIndex: day },
      });
    },

    /* ---- Phase C day-view surface ---- */
    async getDay(dayId: string): Promise<WorkoutDay> {
      const { week, day } = decodeDayId(dayId);
      const { day: dayObj } = await loadPublishedDay(enrollmentId, week, day);
      // Scheduled date comes from the schedule fn so day-level overrides apply.
      const { schedule } = await getEnrollmentSchedule({ data: { enrollmentId } });
      const scheduled = (schedule ?? []).find((s: any) => s.week === week && s.day === day);
      return {
        id: dayId,
        week,
        day,
        title: dayObj?.title ?? dayObj?.focus ?? null,
        focus: dayObj?.focus ?? null,
        targetMinutes: dayObj?.target_minutes ?? dayObj?.est_minutes ?? null,
        blockId: null,
        blockName: null,
        scheduledDate: scheduled?.date ?? null,
      };
    },

    async listRows(dayId: string): Promise<ExerciseRowDTO[]> {
      const { week, day } = decodeDayId(dayId);
      const { day: dayObj } = await loadPublishedDay(enrollmentId, week, day);
      const rows = (dayObj?.rows ?? []) as any[];
      return rows.map((r: any, ei: number) => ({
        id: `ex:${ei}`,
        exerciseId: r.exercise_id ?? null,
        exerciseName: r.exercise ?? r.name ?? `Exercise ${ei + 1}`,
        videoUrl: r.video_url ?? null,
        vimeoEmbedUrl: r.vimeo_embed_url ?? null,
        thumbnailUrl: r.thumbnail_url ?? null,
        muscleGroup: r.muscle_group ?? null,
        category: r.category ?? null,
        cues: r.cues ?? null,
        commonMistakes: r.common_mistakes ?? null,
        sortOrder: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : ei,
        targetSets: Number.isFinite(Number(r.sets)) ? Number(r.sets) : null,
        targetReps: r.reps != null ? String(r.reps) : null,
        targetEffort:
          r.rpe != null && String(r.rpe).trim() !== ""
            ? `RPE ${r.rpe}`
            : r.rir != null && String(r.rir).trim() !== ""
              ? `RIR ${r.rir}`
              : null,
        targetLoadText: r.load != null ? String(r.load) : null,
        restSeconds: Number.isFinite(Number(r.rest_seconds)) ? Number(r.rest_seconds) : null,
        notes: r.notes ?? null,
        warmupProtocolId: r.warmup_protocol_id ?? null,
        defaultLoadUnit: r.default_load_unit ?? null,
        blockGroupId: r.block_group ?? null,
        raw: r,
      }));
    },

    async listRowResults(dayId: string): Promise<RowResultDTO[]> {
      const { week, day } = decodeDayId(dayId);
      const { data, error } = await supabase
        .from("member_set_logs")
        .select("*")
        .eq("enrollment_id", enrollmentId)
        .eq("week_index", week)
        .eq("day_index", day);
      if (error) throw new Error(error.message);
      return (data ?? []).map((l: any) => ({
        id: encodeRowResultId(week, day, l.exercise_index, l.set_index),
        rowId: `ex:${l.exercise_index}`,
        setIndex: l.set_index,
        reps: l.reps ?? null,
        loadLb: l.load_lb ?? null,
        actualLoadUnit: l.entered_unit ?? "lb",
        rpe: l.rpe ?? null,
        rir: l.rir ?? null,
        isWorkingSet: l.is_working_set ?? null,
        notes: l.notes ?? null,
        completedDurationSeconds: l.completed_duration_seconds ?? null,
        loggedAt: l.logged_at ?? l.created_at ?? null,
      }));
    },

    async listExerciseNotes(_dayId: string): Promise<ExerciseNoteDTO[]> {
      // Member plans don't persist per-day exercise notes today. UI surfaces
      // in-memory notes via upsertExerciseNote → log notes field.
      return [];
    },

    async listExerciseHistory(exerciseId: string, opts): Promise<HistoryEntryDTO[]> {
      // We don't have a fast cross-day index by exercise_id for members; the
      // published payload may not store stable exercise ids. Fall back to an
      // empty list when the lookup isn't possible.
      if (!exerciseId) return [];
      const limit = opts?.limit ?? 50;
      const { data, error } = await supabase
        .from("member_set_logs")
        .select("logged_at, set_index, reps, load_lb, rpe")
        .eq("enrollment_id", enrollmentId)
        .order("logged_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((l: any) => ({
        date: (l.logged_at ?? "").slice(0, 10),
        setIndex: l.set_index,
        reps: l.reps ?? null,
        loadLb: l.load_lb ?? null,
        rpe: l.rpe ?? null,
      }));
    },

    async listClientMaxes(): Promise<MaxEntryDTO[]> {
      // Members don't track 1RMs in this app.
      return [];
    },

    async getDayCompletion(dayId: string): Promise<DayCompletionDTO | null> {
      const { week, day } = decodeDayId(dayId);
      const { data, error } = await supabase
        .from("member_workout_completions")
        .select("id, completed_at, notes")
        .eq("enrollment_id", enrollmentId)
        .eq("week_index", week)
        .eq("day_index", day)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id,
        startedAt: null,           // member schema doesn't track started_at
        inProgressAt: null,
        completedAt: data.completed_at ?? null,
        notes: data.notes ?? null,
        actualMinutes: null,
      };
    },

    async getRowBlockSummaries(_rowIds: string[]): Promise<RowBlockSummaryDTO[]> {
      return [];
    },

    async listCoachPainFlags(_dayId: string): Promise<CoachPainFlagDTO[]> {
      return [];
    },

    async getEnrollmentSummary(): Promise<EnrollmentSummaryDTO> {
      const { data, error } = await supabase
        .from("member_plan_enrollments")
        .select("member_plan_id, member_plans(id, name, logging_enabled)")
        .eq("id", enrollmentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const plan = (data as any)?.member_plans ?? null;
      return {
        planId: plan?.id ?? (data as any)?.member_plan_id ?? null,
        planName: plan?.name ?? null,
        loggingEnabled: plan?.logging_enabled !== false,
      };
    },

    async getReview(dayId: string): Promise<ReviewDTO | null> {
      const { week, day } = decodeDayId(dayId);
      const { data, error } = await (supabase as any)
        .from("member_workout_reviews")
        .select("*")
        .eq("enrollment_id", enrollmentId)
        .eq("week_index", week)
        .eq("day_index", day)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        overallRating: data.overall_rating ?? null,
        sessionRpe: data.session_rpe ?? null,
        pain: data.pain ?? null,
        painLevel: data.pain_level ?? null,
        painArea: data.pain_area ?? null,
        painNote: data.pain_note ?? null,
        clientNote: data.client_note ?? null,
        editCount: data.review_edit_count ?? null,
        submittedAt: data.review_submitted_at ?? null,
      };
    },

    async upsertRowResult(input: UpsertRowResultInput): Promise<string> {
      const { week, day } = decodeDayId(ref.kind === "member" && input.id
        // Honour the encoded id when we have one — covers updates that span
        // a different (week/day) than the current view (rare but defensive).
        ? `${decodeRowResultId(input.id).weekIndex}:${decodeRowResultId(input.id).dayIndex}`
        : "1:1");
      void week; void day; // satisfy linter if unused (we use the input rowId)
      const exerciseIndex = decodeRowId(input.rowId);
      // If an id was provided, prefer its encoded (week,day). Otherwise we
      // need the caller to use the adapter on the active day, so the rowId
      // index combined with current view will be saved through logSet.
      if (input.id) {
        const { weekIndex, dayIndex } = decodeRowResultId(input.id);
        await logSetFn({
          data: {
            enrollmentId,
            weekIndex,
            dayIndex,
            exerciseIndex,
            setIndex: input.setIndex,
            reps: input.reps ?? null,
            load_lb: input.loadLb ?? null,
            rpe: input.rpe ?? null,
            rir: input.rir ?? null,
            notes: input.notes ?? null,
          },
        });
        return encodeRowResultId(weekIndex, dayIndex, exerciseIndex, input.setIndex);
      }
      throw new Error(
        "member adapter: upsertRowResult requires either an existing id or the caller to use logSet({dayId, rowId, ...}); the shared UI passes id when editing an existing log",
      );
    },

    async deleteRowResult(id: string): Promise<void> {
      const { weekIndex, dayIndex, exerciseIndex, setIndex } = decodeRowResultId(id);
      const { error } = await supabase
        .from("member_set_logs")
        .delete()
        .eq("enrollment_id", enrollmentId)
        .eq("week_index", weekIndex)
        .eq("day_index", dayIndex)
        .eq("exercise_index", exerciseIndex)
        .eq("set_index", setIndex);
      if (error) throw new Error(error.message);
    },

    async upsertExerciseNote(_input: UpsertExerciseNoteInput): Promise<void> {
      // Member plans have no per-exercise notes table; notes ride along on
      // the set log itself via the standard logSet path.
    },

    async updateDayCompletion(dayId: string, patch: DayCompletionPatch): Promise<void> {
      const { week, day } = decodeDayId(dayId);
      // The member schema only persists completed_at + notes. Treat
      // completedAt=null as "uncomplete".
      if (patch.completedAt === null) {
        await uncompleteWorkout({ data: { enrollmentId, weekIndex: week, dayIndex: day } });
        return;
      }
      if (patch.completedAt) {
        await completeWorkout({
          data: {
            enrollmentId,
            weekIndex: week,
            dayIndex: day,
            notes: patch.notes ?? undefined,
            ...(patch.startedAt ? { startedAt: patch.startedAt } : {}),
            ...(patch.activeDurationSeconds != null
              ? { activeDurationSeconds: patch.activeDurationSeconds }
              : {}),
          },
        });
      }
      // started_at / in_progress_at / actualMinutes are ignored (no columns).
    },

    async saveExerciseUnitPref(_input: { exerciseId: string; unit: "lb" | "kg" }): Promise<void> {
      // Members default to lb; per-exercise unit prefs aren't persisted.
    },

    async listUnitPrefs(_exerciseIds: string[]): Promise<{ exerciseId: string; unit: "lb" | "kg" }[]> {
      // Memberships don't persist per-exercise unit prefs; callers fall back
      // to the exercise's default_load_unit.
      return [];
    },

    async notifyCoachOfFailure(_input: { dayId: string; reason: string }): Promise<void> {
      // Members don't have a dedicated coach to alert. The shared UI already
      // surfaces sync errors via toast + offline queue retries; intentionally
      // a no-op until membership support has a documented escalation path.
    },

    /* ---- Phase B turn 4b — raw passthrough writes (member stubs) ----
     * Stubs until 4c reshapes these into member_set_logs /
     * member_exercise_notes / member_workout_completions writes.
     */
    async upsertPlRowResultRaw(_payload, _id) {
      throw new NotImplemented("upsertPlRowResultRaw", "member");
    },
    async upsertPlExerciseNoteRaw(_payload, _id) {
      throw new NotImplemented("upsertPlExerciseNoteRaw", "member");
    },
    async upsertPlDayCompletionRaw(_payload, _id) {
      throw new NotImplemented("upsertPlDayCompletionRaw", "member");
    },

    /* ---- Phase B turn 3 — raw passthrough surface ----
     * Reshape member_plans.published_payload + member_set_logs into the
     * exact pl_days / pl_exercise_rows / pl_row_results column layout that
     * WorkoutDayView consumes. Helpers below are pure so they can be
     * unit-tested without hitting the network. */
    async getDayRaw(dayId: string): Promise<PlDayRaw | null> {
      const { week, day } = decodeDayId(dayId);
      const { day: dayObj } = await loadPublishedDay(enrollmentId, week, day);
      if (!dayObj) return null;
      const { schedule } = await getEnrollmentSchedule({ data: { enrollmentId } });
      const scheduled = (schedule ?? []).find((s: any) => s.week === week && s.day === day);
      return memberDayToPlDay({ dayId, weekIndex: week, dayIndex: day, dayObj, scheduledDate: scheduled?.date ?? null });
    },
    async listRowsRaw(dayId: string): Promise<PlRowRaw[]> {
      const { week, day } = decodeDayId(dayId);
      const { day: dayObj } = await loadPublishedDay(enrollmentId, week, day);
      const rows = (dayObj?.rows ?? []) as any[];
      return rows.map((r, ei) => memberRowToPlRow({ row: r, exerciseIndex: ei, dayId }));
    },
    async listRowResultsRaw(dayId: string): Promise<PlRowResultRaw[]> {
      const { week, day } = decodeDayId(dayId);
      const { data, error } = await supabase
        .from("member_set_logs")
        .select("*")
        .eq("enrollment_id", enrollmentId)
        .eq("week_index", week)
        .eq("day_index", day);
      if (error) throw new Error(error.message);
      return (data ?? []).map((l: any) =>
        memberLogToPlRowResult({ log: l, clientId: ref.ownerId }),
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Pure reshape helpers (member_* → pl_*-shaped). Exported for unit tests.    */
/* -------------------------------------------------------------------------- */

/**
 * Build a pl_days-shaped object from a member_plans.published_payload day.
 * week_id is left null — WorkoutDayView's pl_weeks/pl_blocks follow-up
 * queries silently degrade to null (members have no block concept).
 */
export function memberDayToPlDay(args: {
  dayId: string;
  weekIndex: number;
  dayIndex: number;
  dayObj: any;
  scheduledDate: string | null;
}): PlDayRaw {
  const { dayId, weekIndex, dayIndex, dayObj, scheduledDate } = args;
  return {
    id: dayId,
    week_id: null,
    day_index: dayIndex,
    week_index: weekIndex,
    title: dayObj?.title ?? dayObj?.focus ?? null,
    focus: dayObj?.focus ?? null,
    target_minutes: dayObj?.target_minutes ?? dayObj?.est_minutes ?? null,
    scheduled_date: scheduledDate,
    notes: dayObj?.notes ?? null,
  } as PlDayRaw;
}

/**
 * Map a single member-published row into the pl_exercise_rows shape, including
 * the nested `exercises(...)` join WorkoutDayView reads (name, video, cues,
 * default_load_unit, warmup_protocol_id, etc). Member rows never carry
 * percentage-based loading or coach overrides — `manual_override=true` keeps
 * the load resolver on the manual path so the prescribed load shows through.
 */
export function memberRowToPlRow(args: {
  row: any;
  exerciseIndex: number;
  dayId: string;
}): PlRowRaw {
  const { row: r, exerciseIndex: ei, dayId } = args;
  const rawLoad = r.load;
  const loadNum =
    rawLoad != null && rawLoad !== "" && Number.isFinite(Number(rawLoad))
      ? Number(rawLoad)
      : null;
  const unit: "kg" | "lb" =
    r.default_load_unit === "kg" ? "kg" : "lb";
  return {
    id: `ex:${ei}`,
    day_id: dayId,
    sort_order: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : ei,
    exercise_id: r.exercise_id ?? null,
    exercise_name_override: r.exercise_id ? null : (r.exercise ?? r.name ?? null),
    sets: Number.isFinite(Number(r.sets)) ? Number(r.sets) : 1,
    reps_text: r.reps != null ? String(r.reps) : null,
    rest_seconds: Number.isFinite(Number(r.rest_seconds)) ? Number(r.rest_seconds) : null,
    rest_seconds_override: null,
    notes: r.notes ?? null,
    load_lb: unit === "lb" ? loadNum : null,
    load_kg: unit === "kg" ? loadNum : null,
    load_unit: unit,
    // Member programs prescribe absolute loads only; bypass percentage path.
    percentage: null,
    percentage_basis: "none",
    manual_override: true,
    warmup_protocol_id: r.warmup_protocol_id ?? null,
    exercises: {
      id: r.exercise_id ?? null,
      name: r.exercise ?? r.name ?? `Exercise ${ei + 1}`,
      video_url: r.video_url ?? null,
      vimeo_embed_url: r.vimeo_embed_url ?? null,
      thumbnail_url: r.thumbnail_url ?? null,
      cues: r.cues ?? null,
      common_mistakes: r.common_mistakes ?? null,
      muscle_group: r.muscle_group ?? null,
      category: r.category ?? null,
      pl_lift_group: r.pl_lift_group ?? null,
      warmup_protocol_id: r.warmup_protocol_id ?? null,
      is_powerlifting: r.is_powerlifting ?? false,
      warmup_notes: r.warmup_notes ?? null,
      default_load_unit: unit,
      exercise_category: r.exercise_category ?? null,
      is_competition_lift: r.is_competition_lift ?? false,
      competition_lift_type: r.competition_lift_type ?? null,
    },
  } as PlRowRaw;
}

/**
 * Map a member_set_logs row into the pl_row_results column layout. `client_id`
 * is filled with the trainee's auth user id so any downstream filters that
 * reference it still match. `row_id` re-encodes the exercise index so the
 * shared UI can correlate back to the synthesized rows above.
 */
export function memberLogToPlRowResult(args: {
  log: any;
  clientId: string;
}): PlRowResultRaw {
  const { log: l, clientId } = args;
  return {
    id: l.id,
    row_id: `ex:${l.exercise_index}`,
    client_id: clientId,
    set_index: l.set_index,
    reps: l.reps ?? null,
    load_lb: l.load_lb ?? l.normalized_lb ?? null,
    load_kg: l.load_kg ?? l.normalized_kg ?? null,
    entered_value: l.entered_value ?? null,
    entered_unit: l.entered_unit ?? null,
    normalized_lb: l.normalized_lb ?? null,
    normalized_kg: l.normalized_kg ?? null,
    actual_load_unit: l.entered_unit ?? "lb",
    rpe: l.rpe ?? null,
    rir: l.rir ?? null,
    is_working_set: l.is_working_set ?? null,
    notes: l.notes ?? null,
    completed_duration_seconds: l.completed_duration_seconds ?? null,
    logged_at: l.logged_at ?? l.created_at ?? null,
  } as PlRowResultRaw;
}