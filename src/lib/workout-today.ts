import { addDays, format, parseISO, startOfDay } from "date-fns";
import { weekDisplayRange } from "@/lib/block-dates";

export type WorkoutItem = { day: any; week: any; block: any; completion: any };

export type TodayState =
  | { kind: "workout_today"; item: WorkoutItem }
  | { kind: "in_progress"; item: WorkoutItem }
  | { kind: "rest_day"; next?: WorkoutItem }
  | { kind: "upcoming"; item: WorkoutItem; whenLabel: string }
  | { kind: "missed"; item: WorkoutItem; whenLabel: string }
  | { kind: "block_complete"; block: any }
  | { kind: "no_program" };

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayScheduledDate(item: WorkoutItem): Date | null {
  // 1) explicit scheduled_date on the day
  if (item.day?.scheduled_date) {
    const d = parseISO(item.day.scheduled_date);
    if (!isNaN(d.getTime())) return startOfDay(d);
  }
  // 2) derive from week range + day_index, restricted to week.training_days if present
  const range = item.block && item.week ? weekDisplayRange(item.block, item.week) : null;
  if (!range) return null;
  const trainingDays: string[] = item.week?.training_days ?? [];
  if (trainingDays.length > 0) {
    // Find the Nth training-day within the week range that matches day_index ordering.
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(range.start, i);
      if (d > range.end) break;
      if (trainingDays.includes(DAY_NAMES[d.getDay()])) days.push(d);
    }
    const idx = Math.max(1, item.day?.day_index ?? 1) - 1;
    if (days[idx]) return startOfDay(days[idx]);
  }
  // 3) fallback: linear distribution across the week
  const idx = Math.max(1, item.day?.day_index ?? 1) - 1;
  return startOfDay(addDays(range.start, Math.min(6, idx)));
}

function isRestDayToday(restDays: string[] | null | undefined): boolean {
  if (!restDays || restDays.length === 0) return false;
  const today = new Date();
  return restDays.includes(DAY_NAMES[today.getDay()]);
}

function isTrainingDayToday(trainingDays: string[] | null | undefined): boolean {
  if (!trainingDays || trainingDays.length === 0) return false;
  const today = new Date();
  return trainingDays.includes(DAY_NAMES[today.getDay()]);
}

export function computeTodayState(
  items: WorkoutItem[],
  client: { preferred_rest_days?: string[] | null; preferred_training_days?: string[] | null } | null | undefined,
): TodayState {
  if (!items || items.length === 0) return { kind: "no_program" };
  const today = startOfDay(new Date());

  const undone = items.filter((it) => !it.completion?.completed_at);
  if (undone.length === 0) {
    const block = items[items.length - 1]?.block;
    return { kind: "block_complete", block };
  }

  // In-progress: has a completion row started but not finished
  const inProgress = undone.find((it) => it.completion && !it.completion?.completed_at);
  if (inProgress) {
    const sd = dayScheduledDate(inProgress);
    if (!sd || sd <= addDays(today, 1)) return { kind: "in_progress", item: inProgress };
  }

  // Today match
  const todayItem = undone.find((it) => {
    const sd = dayScheduledDate(it);
    return sd && isSameDay(sd, today);
  });
  if (todayItem) {
    if (todayItem.completion) return { kind: "in_progress", item: todayItem };
    return { kind: "workout_today", item: todayItem };
  }

  // Missed: a scheduled day in the past, uncompleted
  const missed = undone.find((it) => {
    const sd = dayScheduledDate(it);
    return sd && sd < today;
  });
  if (missed) {
    const sd = dayScheduledDate(missed)!;
    const diff = Math.round((today.getTime() - sd.getTime()) / 86400000);
    const whenLabel = diff === 1 ? "yesterday" : `${diff} days ago`;
    return { kind: "missed", item: missed, whenLabel };
  }

  // Rest day if today is a rest day or not a training day at all
  if (isRestDayToday(client?.preferred_rest_days) ||
     (client?.preferred_training_days?.length && !isTrainingDayToday(client?.preferred_training_days))) {
    const next = undone[0];
    return { kind: "rest_day", next };
  }

  // Otherwise, upcoming next workout
  const next = undone[0];
  const sd = dayScheduledDate(next);
  let whenLabel = "Soon";
  if (sd) {
    const diff = Math.round((sd.getTime() - today.getTime()) / 86400000);
    if (diff <= 0) whenLabel = "Today";
    else if (diff === 1) whenLabel = "Tomorrow";
    else if (diff < 7) whenLabel = format(sd, "EEEE");
    else whenLabel = format(sd, "MMM d");
  }
  return { kind: "upcoming", item: next, whenLabel };
}

export function dayDisplayTitle(item: WorkoutItem | undefined | null): string {
  if (!item) return "Workout";
  const d = item.day;
  return d?.title ? d.title : `Day ${d?.day_index ?? ""}`.trim();
}

export function dayDurationLabel(item: WorkoutItem | undefined | null): string | null {
  if (!item?.day) return null;
  const min = item.day.duration_override_min ?? item.day.duration_estimate_min ?? null;
  if (!min) return null;
  const low = Math.max(5, Math.round((min * 0.9) / 5) * 5);
  const high = Math.round((min * 1.1) / 5) * 5;
  return low === high ? `${min} min` : `${low}–${high} min`;
}

/** Display-only week status (collapse "Manually Completed" → "Completed", add "Locked" support). */
export function displayWeekStatus(status: string | null | undefined): "Not Started" | "In Progress" | "Completed" | "Locked" {
  if (status === "Completed" || status === "Manually Completed") return "Completed";
  if (status === "In Progress") return "In Progress";
  if (status === "Locked") return "Locked";
  return "Not Started";
}

export function weekStatusTone(s: "Not Started" | "In Progress" | "Completed" | "Locked"): string {
  switch (s) {
    case "Completed": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
    case "In Progress": return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    case "Locked": return "border-muted-foreground/20 bg-muted/20 text-muted-foreground/70";
    default: return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
  }
}

/** A week is "locked" (from the client's POV) when its date range is fully in the future. */
export function isWeekLocked(block: any, week: any): boolean {
  // Locking disabled — clients can view and open any week/day.
  void block; void week;
  return false;
}