/**
 * The week as a split (Nov 25 2026): Monday to Sunday, one row a day, what
 * the day is and where it stands in a few words. Pure and deterministic,
 * tested in week-split.test.ts; the Workouts page's Split view draws it.
 *
 *   ✓ Deadlift & Squat · Completed · 1h 42m
 *   Rest Day
 *   Squat & Bench · Suggested 12:30 PM · Est. 1h 35m
 *
 * Status is the workout's own (`getWorkoutStatus`): "missed" only once its
 * day has passed, never because a suggested time went by; a moved workout
 * says so but keeps its prescription and order (moving never touches them).
 * A length that was reconstructed from set times reads "~1h 40m"; one that is
 * only the plan's estimate is never shown as how long it took.
 */
import { addDays } from "date-fns";
import { toLocalISO } from "@/lib/today";
import type { WorkoutItem } from "@/lib/workout-today";
import { getWorkoutStatus } from "@/lib/workout-status";
import { itemDisplayTitle } from "@/lib/workouts/workout-title";
import { formatHm, type DurationKind, type DurationPrediction } from "@/lib/workouts/session-duration";
import { clockLabel } from "@/lib/workouts/workout-time-suggest";

export type SplitStatus =
  | "completed"
  | "partial"
  | "review"
  | "in_progress"
  | "today"
  | "upcoming"
  | "rescheduled"
  | "missed"
  | "skipped";

export type SplitTime =
  | { kind: "confirmed"; startMin: number; clash?: boolean }
  | { kind: "suggested"; startMin: number }
  | { kind: "none" };

export type SplitEntry = {
  key: string;
  item: WorkoutItem;
  title: string;
  status: SplitStatus;
  done: boolean;
  /** the words after the title */
  line: string;
  time: SplitTime | null;
};

export type SplitRow = {
  iso: string;
  date: Date;
  isToday: boolean;
  /** none = a rest day */
  entries: SplitEntry[];
};

export type SplitWeek = { rows: SplitRow[]; planned: number; done: number };

/** Logged under this share of the plan, a finished workout reads Partial. */
export const PARTIAL_BELOW_PCT = 80;

export function splitStatus(item: WorkoutItem, now: Date): SplitStatus {
  const s = getWorkoutStatus(item, now).status;
  switch (s) {
    case "completed_today":
    case "completed_on_scheduled":
    case "completed_different_day": {
      const c = item.completion ?? {};
      const pct = Number(c.logging_percentage);
      return c.completed_with_missing_logs || (Number.isFinite(pct) && pct > 0 && pct < PARTIAL_BELOW_PCT) ? "partial" : "completed";
    }
    case "review_pending":
      return "review";
    case "in_progress":
      return "in_progress";
    case "missed":
      return "missed";
    case "optional_skipped":
      return "skipped";
    case "today":
      return "today";
    default: {
      const src = (item as any).scheduleSource;
      return src === "moved" || src === "manual" ? "rescheduled" : "upcoming";
    }
  }
}

const DONE: ReadonlySet<SplitStatus> = new Set(["completed", "partial", "review"]);

export function splitLine(input: {
  status: SplitStatus;
  duration?: { minutes: number | null; kind: DurationKind } | null;
  prediction?: DurationPrediction | null;
  time?: SplitTime | null;
  progress?: { done: number; total: number } | null;
}): string {
  const { status } = input;
  const took = input.duration && input.duration.minutes && input.duration.kind !== "estimated"
    ? `${input.duration.kind === "reconstructed" ? "~" : ""}${formatHm(input.duration.minutes)}`
    : null;
  const est = input.prediction ? `Est. ${formatHm(input.prediction.minutes)}` : null;
  const parts: string[] = [];
  switch (status) {
    case "completed":
      parts.push("Completed", ...(took ? [took] : []));
      break;
    case "partial":
      parts.push("Partial", ...(took ? [took] : []));
      break;
    case "review":
      parts.push("Review to finish");
      break;
    case "in_progress": {
      const p = input.progress;
      parts.push(p && p.total > 0 ? `In progress · ${p.done} of ${p.total} sets` : "In progress");
      break;
    }
    case "missed":
      parts.push("Missed");
      break;
    case "skipped":
      parts.push("Optional · skipped");
      break;
    default: {
      if (status === "rescheduled") parts.push("Rescheduled");
      const t = input.time;
      if (t?.kind === "confirmed") parts.push(`${clockLabel(t.startMin)}${t.clash ? " · Clashes" : ""}`);
      else if (t?.kind === "suggested") parts.push(`Suggested ${clockLabel(t.startMin)}`);
      else if (t?.kind === "none") parts.push("No open time");
      if (est) parts.push(est);
    }
  }
  return parts.join(" · ");
}

export function buildWeekSplit(input: {
  weekStart: Date;
  byDate: ReadonlyMap<string, WorkoutItem[]>;
  today: Date;
  now?: Date;
  /** leave a workout out (at-home backups) */
  include?: (item: WorkoutItem) => boolean;
  durationOf?: (item: WorkoutItem) => { minutes: number | null; kind: DurationKind } | null;
  predictionOf?: (item: WorkoutItem) => DurationPrediction | null;
  timeOf?: (item: WorkoutItem, iso: string) => SplitTime | null;
}): SplitWeek {
  const now = input.now ?? new Date();
  const todayIso = toLocalISO(input.today);
  let planned = 0;
  let done = 0;
  const rows: SplitRow[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(input.weekStart, i);
    const iso = toLocalISO(date);
    const items = (input.byDate.get(iso) ?? []).filter((it) => it?.day && (input.include ? input.include(it) : true));
    const entries = items.map((item, idx): SplitEntry => {
      const status = splitStatus(item, now);
      const isDone = DONE.has(status);
      if (!item.day?.is_optional) {
        planned++;
        if (isDone) done++;
      }
      const upcoming = status === "today" || status === "upcoming" || status === "rescheduled";
      const time = upcoming ? input.timeOf?.(item, iso) ?? null : null;
      const prog = item.progress;
      return {
        key: `${iso}:${item.scheduledWorkoutId ?? item.day?.id ?? idx}`,
        item,
        title: itemDisplayTitle(item),
        status,
        done: isDone,
        time,
        line: splitLine({
          status,
          duration: isDone ? input.durationOf?.(item) ?? null : null,
          prediction: upcoming ? input.predictionOf?.(item) ?? null : null,
          time,
          progress: prog && prog.prescribedSets > 0 ? { done: prog.completedSets, total: prog.prescribedSets } : null,
        }),
      };
    });
    rows.push({ iso, date, isToday: iso === todayIso, entries });
  }
  return { rows, planned, done };
}
