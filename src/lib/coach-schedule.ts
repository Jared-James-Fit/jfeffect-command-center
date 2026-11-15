/**
 * How the coach's Schedule (the client's Training tab: Week · Month ·
 * Program) reads a workout: one status, one word and one mark, the same
 * rules as the athlete's own Workouts (getWorkoutStatus / workoutMark), so
 * the coach and the client never see a workout two ways. Pure, tested.
 *
 *   done          completed_at (a finished workout, whatever was logged)
 *   in_progress   started, not finished (started_at / in_progress_at)
 *   today         dated today, not started
 *   missed        dated before today, nothing finished (never "skipped")
 *   optional      an optional session (pl_days.is_optional) whose day passed
 *                 untouched: a choice, never a miss
 *   upcoming      dated after today
 *   no_date       no date yet (Pick a date)
 */
import { addDays, format, isSameMonth, parseISO } from "date-fns";
import type { WorkoutMark } from "@/components/workouts/workout-status-mark";

export type CoachStatus = "done" | "in_progress" | "today" | "missed" | "optional" | "upcoming" | "no_date";

type CompletionLike = { completed_at?: string | null; in_progress_at?: string | null; started_at?: string | null } | null | undefined;

export function coachStatus(opts: { date: string | null | undefined; completion: CompletionLike; optional?: boolean | null; todayISO: string }): CoachStatus {
  const { completion, todayISO } = opts;
  const date = opts.date ? String(opts.date).slice(0, 10) : null;
  if (completion?.completed_at) return "done";
  if (completion?.in_progress_at || completion?.started_at) return "in_progress";
  if (!date) return "no_date";
  if (date === todayISO) return "today";
  if (date < todayISO) return opts.optional ? "optional" : "missed";
  return "upcoming";
}

/** The one word a status shows, or "" when it isn't news (a workout still ahead). */
export const STATUS_WORD: Record<CoachStatus, string> = {
  done: "Done",
  in_progress: "In progress",
  today: "Today",
  missed: "Missed",
  optional: "Skipped (optional)",
  upcoming: "",
  no_date: "No date",
};

/** The word's colour: green done, rose missed, amber needs a date, neutral otherwise. */
export const STATUS_TONE: Record<CoachStatus, string> = {
  done: "text-success",
  in_progress: "text-foreground",
  today: "text-foreground",
  missed: "text-rose-600 dark:text-rose-400",
  optional: "text-muted-foreground",
  upcoming: "text-muted-foreground",
  no_date: "text-warning",
};

/**
 * The athlete app's mark for it (WorkoutStatusMark): a green check, a hollow
 * rose ring for a miss, a ring for one in progress, a grey dot for one ahead.
 * Started workouts have no logged-set count here, so their ring reads half.
 */
export function coachMark(status: CoachStatus): WorkoutMark | null {
  switch (status) {
    case "done": return { kind: "done" };
    case "in_progress": return { kind: "progress", pct: 50 };
    case "missed": return { kind: "missed" };
    case "optional": return { kind: "skipped" };
    case "no_date": return null;
    default: return { kind: "scheduled" };
  }
}

const WEEKDAY = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|rsday|urday|sday)?$/i;

/**
 * What a workout is called on the schedule: the name the athlete reads
 * (`subtitle`, else `title`) without a leading "Day 2 — " that the date
 * already says; a name that's only a weekday ("Day 1 — Monday") keeps its
 * "Day 1", since that's the only thing that tells one workout from another.
 */
export function workoutName(day: { title?: string | null; subtitle?: string | null; day_index?: number | null }): string {
  const fallback = `Day ${day.day_index ?? "?"}`;
  const raw = (day.subtitle ?? "").trim() || (day.title ?? "").trim();
  if (!raw) return fallback;
  const m = raw.match(/^day\s*(\d+)\s*[—–:-]\s*(.+)$/i);
  if (!m) return raw;
  const rest = m[2].trim();
  if (!rest || WEEKDAY.test(rest.replace(/[^a-z]/gi, ""))) return `Day ${m[1]}`;
  return rest;
}

export type ScheduleEntryLike = { date: string | null; status: CoachStatus; blockId?: string | null; weekIndex?: number | null };

/** Done / missed / in progress / still to come in a set of entries (a week, a month, a block). */
export function tally(entries: ScheduleEntryLike[]) {
  const t = { total: 0, done: 0, missed: 0, inProgress: 0, ahead: 0, optional: 0 };
  for (const e of entries) {
    if (!e.date) continue;
    t.total += 1;
    if (e.status === "done") t.done += 1;
    else if (e.status === "missed") t.missed += 1;
    else if (e.status === "in_progress") t.inProgress += 1;
    else if (e.status === "optional") t.optional += 1;
    else t.ahead += 1;
  }
  return t;
}

/** "2 of 4 done · 1 missed": the counts that matter, in that order, never a zero. */
export function tallyLine(entries: ScheduleEntryLike[]): string {
  const t = tally(entries);
  if (!t.total) return "";
  const parts = [`${t.done} of ${t.total} done`];
  if (t.missed) parts.push(`${t.missed} missed`);
  if (t.inProgress) parts.push(`${t.inProgress} in progress`);
  return parts.join(" · ");
}

/** "Nov 16 – 22", or "Nov 30 – Dec 6" across a month (the athlete's week strip's own label). */
export function weekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  return `${format(weekStart, "MMM d")} – ${format(end, isSameMonth(weekStart, end) ? "d" : "MMM d")}`;
}

/** "This week", "Next week", "Last week", else the dates. */
export function weekTitle(weekStart: Date, thisWeekStart: Date): string {
  const days = Math.round((weekStart.getTime() - thisWeekStart.getTime()) / 86_400_000);
  if (days === 0) return "This week";
  if (days === 7) return "Next week";
  if (days === -7) return "Last week";
  return weekRange(weekStart);
}

/**
 * Where a week sits in the program: the block and week of the workouts dated
 * in it ("Block 3 — Peak · Week 1"), both when it spans two ("… Week 4 →
 * Block 3 · Week 1"), nothing when it has none.
 */
export function weekPlace(
  entries: Array<{ blockId?: string | null; weekIndex?: number | null; date: string | null }>,
  blockName: (id: string) => string | null,
): string {
  const seen: string[] = [];
  const labels: string[] = [];
  for (const e of [...entries].filter((x) => x.date).sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const key = `${e.blockId ?? ""}:${e.weekIndex ?? ""}`;
    if (seen.includes(key)) continue;
    seen.push(key);
    const name = e.blockId ? blockName(e.blockId) : null;
    labels.push([name, e.weekIndex ? `Week ${e.weekIndex}` : null].filter(Boolean).join(" · "));
  }
  return labels.filter(Boolean).slice(0, 2).join(" → ");
}

/** The date a yyyy-mm-dd string is, at local noon (never the day before in Manitoba). */
export function isoDate(iso: string): Date {
  return parseISO(`${iso.slice(0, 10)}T12:00:00`);
}

/**
 * Two dates as one short range: "Nov 2 – 6", "Nov 30 – Dec 4", one date when
 * they're the same day, both years only when the range crosses one.
 */
export function dateRange(fromIso: string, toIso: string): string {
  const a = isoDate(fromIso);
  const b = isoDate(toIso);
  if (fromIso.slice(0, 10) === toIso.slice(0, 10)) return format(a, "MMM d");
  if (a.getFullYear() !== b.getFullYear()) return `${format(a, "MMM d, yyyy")} – ${format(b, "MMM d, yyyy")}`;
  return `${format(a, "MMM d")} – ${format(b, isSameMonth(a, b) ? "d" : "MMM d")}`;
}

/**
 * The Program list's rows (buildScheduleManagerRows: completed / in_progress /
 * missing / past_due / scheduled) read the same way as the calendar.
 */
export function statusOfRow(
  row: { status: "completed" | "in_progress" | "missing" | "past_due" | "scheduled"; date: string | null; day?: { is_optional?: boolean | null } | null },
  todayISO: string,
): CoachStatus {
  switch (row.status) {
    case "completed": return "done";
    case "in_progress": return "in_progress";
    case "missing": return "no_date";
    case "past_due": return row.day?.is_optional ? "optional" : "missed";
    default: return row.date && row.date.slice(0, 10) === todayISO ? "today" : "upcoming";
  }
}
