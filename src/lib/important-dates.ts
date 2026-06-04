import { differenceInCalendarDays, parseISO } from "date-fns";

export const DATE_TYPES = [
  "Competition",
  "Meet Day",
  "Nationals Prep",
  "Photoshoot",
  "Vacation",
  "Wedding",
  "Testing Day",
  "Strength Test",
  "Cut Deadline",
  "Weight Deadline",
  "Program Deadline",
  "Custom",
] as const;

export type DateType = (typeof DATE_TYPES)[number];

export interface ImportantDate {
  id: string;
  client_id: string;
  title: string;
  date_type: string;
  custom_type: string | null;
  target_date: string;
  start_date: string | null;
  countdown_label: string | null;
  notes: string | null;
  phase_id: string | null;
  program_link: string | null;
  status: string;
  visible_to_client: boolean;
  approaching_soon_days: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ImportantDateState =
  | "completed"
  | "archived"
  | "past-due"
  | "due-today"
  | "approaching"
  | "active"
  | "upcoming";

export interface ImportantDateDerived {
  state: ImportantDateState;
  label: string;
  tone: "blue" | "green" | "yellow" | "red" | "grey";
  daysRemaining: number;
  weeksRemaining: number;
  totalDays: number | null;
  totalWeeks: number | null;
  currentWeek: number | null;
  percentComplete: number | null;
}

export function deriveImportantDate(d: ImportantDate, today = new Date()): ImportantDateDerived {
  const target = parseISO(d.target_date);
  const daysRemaining = differenceInCalendarDays(target, today);
  const weeksRemaining = Math.max(0, Math.ceil(Math.max(0, daysRemaining) / 7));

  let totalDays: number | null = null;
  let totalWeeks: number | null = null;
  let currentWeek: number | null = null;
  let percentComplete: number | null = null;

  if (d.start_date) {
    const start = parseISO(d.start_date);
    totalDays = Math.max(1, differenceInCalendarDays(target, start) + 1);
    totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
    const elapsed = differenceInCalendarDays(today, start) + 1;
    currentWeek = Math.min(totalWeeks, Math.max(1, Math.ceil(elapsed / 7)));
    percentComplete = Math.min(100, Math.max(0, Math.round((elapsed / totalDays) * 100)));
  }

  const status = (d.status || "").toLowerCase();
  if (status === "completed") return base("completed", "Completed", "grey");
  if (status === "archived") return base("archived", "Archived", "grey");

  const threshold = d.approaching_soon_days ?? 14;
  if (daysRemaining < 0) return base("past-due", "Past Due", "red");
  if (daysRemaining === 0) return base("due-today", "Due Today", "red");
  if (daysRemaining <= threshold) return base("approaching", "Approaching", "yellow");
  if (d.start_date && differenceInCalendarDays(parseISO(d.start_date), today) > 0)
    return base("upcoming", "Upcoming", "blue");
  if (!d.start_date && daysRemaining > 60) return base("upcoming", "Upcoming", "blue");
  return base("active", "Active", "green");

  function base(state: ImportantDateState, label: string, tone: ImportantDateDerived["tone"]): ImportantDateDerived {
    return { state, label, tone, daysRemaining, weeksRemaining, totalDays, totalWeeks, currentWeek, percentComplete };
  }
}

export function dateTypeLabel(d: ImportantDate) {
  return d.date_type === "Custom" && d.custom_type ? d.custom_type : d.date_type;
}

export function importantToneClasses(tone: ImportantDateDerived["tone"]) {
  switch (tone) {
    case "green": return "bg-green-500/15 text-green-400 border-green-500/30";
    case "yellow": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "red": return "bg-red-500/15 text-red-400 border-red-500/30";
    case "blue": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "grey":
    default: return "bg-muted text-muted-foreground border-border";
  }
}