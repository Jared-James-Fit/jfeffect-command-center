/**
 * Canonical per-day schedule status shared by the program editor, the
 * Training Program hub, and (implicitly) the Schedule Manager + calendar.
 *
 * Source-of-truth rules (mirrors mergeScheduledInstances):
 *  - `pl_scheduled_workouts` rows are the CANONICAL schedule. If a day has
 *    any instance, the calendar shows the instance date(s).
 *  - `pl_days.scheduled_date` is a legacy mirror, only used by the calendar
 *    when a day has NO instance at all.
 *
 * A "Calendar Issue" is therefore: the day has an instance AND the legacy
 * mirror disagrees with it (classic editor/calendar desync). "Fix" repairs
 * it by aligning the mirror to the canonical instance date — never the
 * other way around, and never by rewriting history.
 */

export type ProgramDayScheduleStatusKind =
  | "completed"
  | "in-progress"
  | "calendar-issue"
  | "missing-date"
  | "on-calendar";

export interface ProgramDayScheduleStatus {
  dayId: string;
  /** Canonical instance id (earliest instance for the day), if any. */
  scheduledWorkoutId: string | null;
  /** The date the calendar actually shows for this day (instance-first). */
  canonicalDate: string | null;
  /** The legacy pl_days.scheduled_date mirror value. */
  legacyDate: string | null;
  hasInstance: boolean;
  /** How many instances exist for this day (repeat sessions). */
  instanceCount: number;
  completed: boolean;
  inProgress: boolean;
  /** Instance exists but the legacy mirror disagrees with it. */
  calendarIssue: boolean;
  /** No canonical date at all — the workout will NOT appear on the calendar. */
  missingDate: boolean;
  status: ProgramDayScheduleStatusKind;
}

export interface ProgramScheduleDayInput {
  id: string;
  scheduled_date?: string | null;
}

export interface ProgramScheduleInstanceInput {
  id: string;
  source_day_id: string | null;
  scheduled_date: string;
}

export interface ProgramScheduleCompletionInput {
  day_id: string;
  completed_at: string | null;
}

export function buildProgramScheduleStatus(args: {
  days: ProgramScheduleDayInput[];
  instances: ProgramScheduleInstanceInput[];
  completions: ProgramScheduleCompletionInput[];
}): Map<string, ProgramDayScheduleStatus> {
  const { days, instances, completions } = args;

  const instancesByDay = new Map<string, ProgramScheduleInstanceInput[]>();
  for (const inst of instances) {
    if (!inst.source_day_id) continue;
    const arr = instancesByDay.get(inst.source_day_id) ?? [];
    arr.push(inst);
    instancesByDay.set(inst.source_day_id, arr);
  }
  // Earliest instance is the canonical "primary" date for editor display.
  for (const arr of instancesByDay.values()) {
    arr.sort((a, b) => (a.scheduled_date < b.scheduled_date ? -1 : a.scheduled_date > b.scheduled_date ? 1 : 0));
  }

  const hasCompleted = new Set<string>();
  const hasInProgress = new Set<string>();
  for (const c of completions) {
    if (c.completed_at) hasCompleted.add(c.day_id);
    else hasInProgress.add(c.day_id);
  }

  const out = new Map<string, ProgramDayScheduleStatus>();
  for (const day of days) {
    const dayInstances = instancesByDay.get(day.id) ?? [];
    const primary = dayInstances[0] ?? null;
    const legacyDate = day.scheduled_date ?? null;
    const canonicalDate = primary ? primary.scheduled_date : legacyDate;
    const completed = hasCompleted.has(day.id);
    const inProgress = !completed && hasInProgress.has(day.id);
    const calendarIssue =
      !!primary && !!legacyDate && legacyDate !== primary.scheduled_date;
    const missingDate = !completed && !canonicalDate;

    const status: ProgramDayScheduleStatusKind = completed
      ? "completed"
      : inProgress
        ? "in-progress"
        : calendarIssue
          ? "calendar-issue"
          : missingDate
            ? "missing-date"
            : "on-calendar";

    out.set(day.id, {
      dayId: day.id,
      scheduledWorkoutId: primary?.id ?? null,
      canonicalDate,
      legacyDate,
      hasInstance: !!primary,
      instanceCount: dayInstances.length,
      completed,
      inProgress,
      calendarIssue,
      missingDate,
      status,
    });
  }
  return out;
}

export interface ProgramScheduleSummary {
  totalDays: number;
  scheduledCount: number;
  missingCount: number;
  issueCount: number;
  completedCount: number;
  inProgressCount: number;
}

export function summarizeProgramSchedule(
  statuses: Iterable<ProgramDayScheduleStatus>,
): ProgramScheduleSummary {
  const s: ProgramScheduleSummary = {
    totalDays: 0,
    scheduledCount: 0,
    missingCount: 0,
    issueCount: 0,
    completedCount: 0,
    inProgressCount: 0,
  };
  for (const st of statuses) {
    s.totalDays += 1;
    if (st.canonicalDate) s.scheduledCount += 1;
    if (st.missingDate) s.missingCount += 1;
    if (st.calendarIssue) s.issueCount += 1;
    if (st.completed) s.completedCount += 1;
    if (st.inProgress) s.inProgressCount += 1;
  }
  return s;
}

export const PROGRAM_DAY_STATUS_META: Record<
  ProgramDayScheduleStatusKind,
  { label: string; tone: "emerald" | "amber" | "blue" | "neutral" }
> = {
  completed: { label: "Completed", tone: "emerald" },
  "in-progress": { label: "In Progress", tone: "blue" },
  "calendar-issue": { label: "Calendar Issue", tone: "amber" },
  "missing-date": { label: "Missing Date", tone: "amber" },
  "on-calendar": { label: "On Calendar", tone: "emerald" },
};