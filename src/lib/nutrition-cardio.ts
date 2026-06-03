export const NUTRITION_PHASES = [
  "Fat Loss",
  "Muscle Gain",
  "Maintenance",
  "Performance",
  "Lifestyle Reset",
  "Reverse Diet",
  "Recomp",
  "Custom",
] as const;

export const NUTRITION_GOALS = [
  "Lose body fat",
  "Build muscle",
  "Maintain bodyweight",
  "Improve performance",
  "Improve consistency",
  "Improve health habits",
  "Custom",
] as const;

export const NUTRITION_STRUCTURES = [
  "Same Every Day",
  "Training / Rest",
  "High / Low",
  "Training / Rest / High",
  "Custom",
] as const;

export function dayLabelsForStructure(s: string): string[] {
  switch (s) {
    case "Same Every Day":
      return ["Daily"];
    case "Training / Rest":
      return ["Training Day", "Rest Day"];
    case "High / Low":
      return ["High Day", "Low Day"];
    case "Training / Rest / High":
      return ["Training Day", "Rest Day", "High Day"];
    default:
      return ["Day 1"];
  }
}

export const CARDIO_TYPES = [
  "Treadmill",
  "Incline Walking",
  "Bike",
  "Stairmaster",
  "Elliptical",
  "Outdoor Walking",
  "Running",
  "Rowing",
  "Sled",
  "Custom",
] as const;

export const CARDIO_INTENSITIES = [
  "Zone 2",
  "Low Intensity",
  "Moderate Intensity",
  "High Intensity",
  "Steps Only",
  "Custom",
] as const;

export const TARGET_STATUSES = [
  "Active",
  "Ending Soon",
  "Due Today",
  "Past Due",
  "Archived",
] as const;

export type TargetRow = {
  id: string;
  client_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  ending_soon_days: number;
};

export type DerivedTargetState = {
  state: "active" | "ending-soon" | "due-today" | "past-due" | "archived" | "upcoming";
  label: string;
  tone: string;
  daysRemaining: number;
};

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function deriveTarget(t: TargetRow): DerivedTargetState {
  if (t.status === "Archived") {
    return { state: "archived", label: "Archived", tone: "border-border bg-secondary/40 text-muted-foreground", daysRemaining: 0 };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (t.end_date) {
    const end = new Date(t.end_date + "T00:00:00");
    const days = daysBetween(today, end);
    if (days < 0) return { state: "past-due", label: "Past Due", tone: "border-destructive/40 bg-destructive/10 text-destructive", daysRemaining: days };
    if (days === 0) return { state: "due-today", label: "Due Today", tone: "border-destructive/40 bg-destructive/10 text-destructive", daysRemaining: 0 };
    if (days <= (t.ending_soon_days ?? 7)) return { state: "ending-soon", label: "Ending Soon", tone: "border-warning/40 bg-warning/10 text-warning", daysRemaining: days };
  }
  const start = new Date(t.start_date + "T00:00:00");
  if (start.getTime() > today.getTime()) {
    return { state: "upcoming", label: "Upcoming", tone: "border-primary/40 bg-primary/10 text-primary", daysRemaining: daysBetween(today, start) };
  }
  return { state: "active", label: "Active", tone: "border-success/40 bg-success/10 text-success", daysRemaining: t.end_date ? daysBetween(today, new Date(t.end_date + "T00:00:00")) : 0 };
}