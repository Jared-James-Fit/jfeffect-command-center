import { format, startOfDay } from "date-fns";
import { dayScheduledDate, type WorkoutItem } from "@/lib/workout-today";

export type WorkoutStatus =
  | "today"
  | "upcoming"
  | "available"
  | "completed_today"
  | "completed_on_scheduled"
  | "completed_different_day"
  | "missed";

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function getWorkoutStatus(item: WorkoutItem, now: Date = new Date()): {
  status: WorkoutStatus;
  label: string;
  tone: string;
  scheduled: Date | null;
  completedAt: Date | null;
} {
  const today = startOfDay(now);
  const scheduled = dayScheduledDate(item);
  const completedAtRaw: string | null = item.completion?.completed_at ?? null;
  const completedAt = completedAtRaw ? new Date(completedAtRaw) : null;

  if (completedAt) {
    if (isSameDay(completedAt, today)) {
      return { status: "completed_today", label: "Completed today", tone: completedTone, scheduled, completedAt };
    }
    if (scheduled && isSameDay(completedAt, scheduled)) {
      return {
        status: "completed_on_scheduled",
        label: `Completed ${format(completedAt, "EEE")}`,
        tone: completedTone,
        scheduled,
        completedAt,
      };
    }
    return {
      status: "completed_different_day",
      label: scheduled
        ? `Completed ${format(completedAt, "EEE")} instead of ${format(scheduled, "EEE")}`
        : `Completed ${format(completedAt, "MMM d")}`,
      tone: completedTone,
      scheduled,
      completedAt,
    };
  }

  if (!scheduled) {
    return { status: "available", label: "Available", tone: neutralTone, scheduled, completedAt };
  }
  if (isSameDay(scheduled, today)) {
    return { status: "today", label: "Today", tone: todayTone, scheduled, completedAt };
  }
  if (scheduled < today) {
    return { status: "missed", label: `Missed ${format(scheduled, "EEE")}`, tone: missedTone, scheduled, completedAt };
  }
  return {
    status: "upcoming",
    label: `Scheduled ${format(scheduled, "EEE")}`,
    tone: upcomingTone,
    scheduled,
    completedAt,
  };
}

const completedTone = "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
const todayTone = "border-primary/40 bg-primary/10 text-primary";
const upcomingTone = "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
const missedTone = "border-amber-500/40 bg-amber-500/10 text-amber-500";
const neutralTone = "border-muted-foreground/20 bg-muted/20 text-muted-foreground";