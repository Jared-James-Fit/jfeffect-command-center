import { differenceInCalendarDays, parseISO } from "date-fns";

export const PHASE_TYPES = [
  "Rebound",
  "Reintroduction",
  "Load Build",
  "Capacity Build",
  "Volume / Accumulation",
  "Strength / Intensification",
  "Peaking",
  "Custom Phase",
] as const;

export type PhaseType = (typeof PHASE_TYPES)[number];

export const CUSTOM_PHASE_SUGGESTIONS = [
  "Post-Meet Rebuild",
  "Hypertrophy Phase",
  "Fat Loss Phase",
  "Lifestyle Reset",
  "Rehab / Modified Training",
  "Maintenance Phase",
  "Technique Rebuild",
  "Competition Prep",
  "Deload Phase",
  "Testing Phase",
];

export interface TrainingPhase {
  id: string;
  client_id: string;
  title: string;
  phase_type: string;
  custom_phase_name: string | null;
  start_date: string;
  end_date: string;
  current_week: number | null;
  training_goal: string | null;
  program_link: string | null;
  notes: string | null;
  status: string;
  ending_soon_days: number;
  sort_order: number;
  visible_to_client?: boolean;
  created_at: string;
  updated_at: string;
}

export type PhaseState =
  | "completed"
  | "archived"
  | "past-due"
  | "due-today"
  | "ending-soon"
  | "active"
  | "upcoming";

export interface PhaseDerived {
  state: PhaseState;
  label: string;
  daysRemaining: number;
  weeksRemaining: number;
  totalDays: number;
  percentComplete: number;
  currentWeek: number;
  totalWeeks: number;
  tone: "green" | "yellow" | "red" | "grey" | "blue";
}

export function derivePhase(p: TrainingPhase, today = new Date()): PhaseDerived {
  const start = parseISO(p.start_date);
  const end = parseISO(p.end_date);
  const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const elapsed = differenceInCalendarDays(today, start) + 1;
  const daysRemaining = differenceInCalendarDays(end, today);
  const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
  const currentWeek = Math.min(totalWeeks, Math.max(1, Math.ceil(elapsed / 7)));
  const weeksRemaining = Math.max(0, Math.ceil(Math.max(0, daysRemaining) / 7));
  const percentComplete = Math.min(100, Math.max(0, Math.round((elapsed / totalDays) * 100)));

  const status = (p.status || "").toLowerCase();
  if (status === "completed") return base("completed", "Completed", "grey");
  if (status === "archived") return base("archived", "Archived", "grey");

  if (differenceInCalendarDays(start, today) > 0)
    return base("upcoming", "Upcoming", "blue");
  if (daysRemaining < 0) return base("past-due", "Past Due", "red");
  if (daysRemaining === 0) return base("due-today", "Due Today", "red");
  if (daysRemaining <= (p.ending_soon_days ?? 7))
    return base("ending-soon", "Ending Soon", "yellow");
  return base("active", "Active", "green");

  function base(state: PhaseState, label: string, tone: PhaseDerived["tone"]): PhaseDerived {
    return { state, label, daysRemaining, weeksRemaining, totalDays, percentComplete, currentWeek, totalWeeks, tone };
  }
}

export function toneClasses(tone: PhaseDerived["tone"]) {
  switch (tone) {
    case "green": return "bg-green-500/15 text-green-400 border-green-500/30";
    case "yellow": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "red": return "bg-red-500/15 text-red-400 border-red-500/30";
    case "blue": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "grey":
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export function displayTitle(p: TrainingPhase) {
  if (p.phase_type === "Custom Phase" && p.custom_phase_name) return p.custom_phase_name;
  return p.title || p.phase_type;
}