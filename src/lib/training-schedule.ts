export const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

export const SHORT_DAY: Record<WeekDay, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

export function formatDays(days: string[] | null | undefined): string {
  if (!days || days.length === 0) return "—";
  return days
    .filter((d): d is WeekDay => (WEEK_DAYS as readonly string[]).includes(d))
    .map((d) => SHORT_DAY[d])
    .join(", ");
}

export const CARDIO_DAY_TYPES = [
  "General",
  "Training Day",
  "Rest Day",
  "High Day",
  "Custom",
] as const;

export type CardioDayType = (typeof CARDIO_DAY_TYPES)[number];

export function dayTypeLabel(t: { day_type?: string | null; custom_day_type?: string | null }): string {
  if (t.day_type === "Custom" && t.custom_day_type) return t.custom_day_type;
  return t.day_type ?? "General";
}

export function dayTypeTone(day_type?: string | null): string {
  switch (day_type) {
    case "Training Day":
      return "border-primary/40 text-primary";
    case "Rest Day":
      return "border-muted-foreground/40 text-muted-foreground";
    case "High Day":
      return "border-amber-500/40 text-amber-500";
    case "Custom":
      return "border-accent-foreground/40 text-accent-foreground";
    default:
      return "border-border text-foreground";
  }
}