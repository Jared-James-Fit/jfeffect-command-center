// Pure conflict-detection helpers for the Training Schedule Manager.
// No I/O — accept already-fetched rows and a target date and return a
// machine-readable conflict report. Used by both the move sheet (UI
// preview) and the server fn (final validation before save).

export type ScheduleConflictKind =
  | "sameDayWorkout"
  | "appointment"
  | "adjacentFatigue"
  | "pastDate"
  | "sequenceBreak"
  | "outsideBlockRange";

export interface ScheduleConflict {
  kind: ScheduleConflictKind;
  severity: "block" | "warn";
  message: string;
  payload?: Record<string, unknown>;
}

export interface ConflictInput {
  dayId: string;
  newDate: Date;
  /** All not-archived days in the client's current block(s), with their
   *  scheduled date, day_index, week_index and focus. */
  allBlockDays: Array<{
    id: string;
    day_index: number;
    week_index: number;
    block_id: string;
    focus?: string | null;
    scheduled_date: string | null;
    title?: string | null;
  }>;
  /** Optional same-day appointments. */
  appointments?: Array<{ id: string; starts_at: string; title?: string | null }>;
  /** Date bounds for the active block, if any. */
  blockRange?: { start: Date | null; end: Date | null };
}

const sameYMD = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const daysApart = (a: Date, b: Date) =>
  Math.round((a.getTime() - b.getTime()) / 86_400_000);

const FATIGUE_FOCI = ["legs", "lower", "squat", "deadlift"];
const looksLowerBody = (focus?: string | null) => {
  if (!focus) return false;
  const f = focus.toLowerCase();
  return FATIGUE_FOCI.some((k) => f.includes(k));
};

export function detectScheduleConflicts(input: ConflictInput): ScheduleConflict[] {
  const out: ScheduleConflict[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(input.newDate);
  target.setHours(0, 0, 0, 0);

  // Past date — warn only, never block.
  if (target.getTime() < today.getTime()) {
    out.push({
      kind: "pastDate",
      severity: "warn",
      message: "That date is in the past.",
    });
  }

  const movingDay = input.allBlockDays.find((d) => d.id === input.dayId);

  // Outside the assigned block window.
  if (input.blockRange) {
    const { start, end } = input.blockRange;
    if ((start && target < start) || (end && target > end)) {
      out.push({
        kind: "outsideBlockRange",
        severity: "warn",
        message: "That date is outside this block's planned window.",
      });
    }
  }

  // Same-day collision with another workout.
  for (const d of input.allBlockDays) {
    if (d.id === input.dayId) continue;
    if (!d.scheduled_date) continue;
    const dDate = new Date(d.scheduled_date + "T00:00:00");
    if (sameYMD(dDate, target)) {
      out.push({
        kind: "sameDayWorkout",
        severity: "warn",
        message: `You already have ${d.title?.trim() || `Day ${d.day_index}`} scheduled on that day.`,
        payload: { otherDayId: d.id, otherTitle: d.title, otherDayIndex: d.day_index },
      });
    }
  }

  // Adjacent (yesterday/tomorrow) high-fatigue session.
  if (movingDay && looksLowerBody(movingDay.focus)) {
    for (const d of input.allBlockDays) {
      if (d.id === input.dayId) continue;
      if (!d.scheduled_date) continue;
      if (!looksLowerBody(d.focus)) continue;
      const dDate = new Date(d.scheduled_date + "T00:00:00");
      const gap = Math.abs(daysApart(target, dDate));
      if (gap === 1) {
        out.push({
          kind: "adjacentFatigue",
          severity: "warn",
          message: `This puts two lower-body sessions on back-to-back days.`,
        });
        break;
      }
    }
  }

  // Sequence break — moved past a later-numbered Day in the same week, or
  // before an earlier-numbered Day.
  if (movingDay) {
    const sameWeek = input.allBlockDays.filter(
      (d) =>
        d.block_id === movingDay.block_id &&
        d.week_index === movingDay.week_index &&
        d.id !== movingDay.id &&
        d.scheduled_date,
    );
    for (const d of sameWeek) {
      const dDate = new Date(d.scheduled_date! + "T00:00:00");
      if (d.day_index < movingDay.day_index && target < dDate) {
        out.push({
          kind: "sequenceBreak",
          severity: "warn",
          message: `This puts Day ${movingDay.day_index} before Day ${d.day_index}.`,
          payload: { earlierDayId: d.id, earlierDayIndex: d.day_index },
        });
        break;
      }
      if (d.day_index > movingDay.day_index && target > dDate) {
        out.push({
          kind: "sequenceBreak",
          severity: "warn",
          message: `This puts Day ${movingDay.day_index} after Day ${d.day_index}.`,
          payload: { laterDayId: d.id, laterDayIndex: d.day_index },
        });
        break;
      }
    }
  }

  // Appointment on the target date.
  if (input.appointments?.length) {
    for (const a of input.appointments) {
      const aDate = new Date(a.starts_at);
      if (sameYMD(aDate, target)) {
        out.push({
          kind: "appointment",
          severity: "warn",
          message: `You have ${a.title?.trim() || "an appointment"} on that day.`,
          payload: { appointmentId: a.id },
        });
      }
    }
  }

  return out;
}

export const hasBlockingConflict = (xs: ScheduleConflict[]) =>
  xs.some((c) => c.severity === "block");