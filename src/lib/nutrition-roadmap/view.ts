/**
 * What the screens get: the roadmap read against today, the revision waiting
 * (if any), history, the check-in and the chart's weigh-ins. Pure shapes and
 * the few words both the athlete's and the coach's screens use.
 */
import type { CheckinAsk, Decision, Macros, ProgressStatus, RoadmapPlan, RoadmapRead } from "@/lib/nutrition-roadmap/types";
import { round } from "@/lib/weight-management/units";

export type RevisionSummary = {
  id: string;
  createdAt: string;
  trigger: string;
  status: "proposed" | "active" | "superseded" | "rejected";
  summary: string | null;
  changes: string[];
  autoApplied: boolean;
  decidedAt: string | null;
  note: string | null;
};

export type PendingRevision = RevisionSummary & {
  decider: "coach" | "athlete";
  plan: RoadmapPlan;
  proposal: Decision | null;
};

export type RoadmapGoalForm = {
  type: "lose" | "gain" | "maintain" | "performance_cut" | "custom" | null;
  value: number | null;
  unit: "kg" | "lb";
  date: string | null;
  meet: { name: string | null; date: string | null; weightClass: string | null; federation: string | null; sport: "powerlifting" | "bodybuilding" | "other" } | null;
};

export type RoadmapView = {
  /** ready: a roadmap in effect; waiting_coach: a coached athlete's roadmap the coach hasn't approved; no_goal: nothing to plan yet. */
  state: "ready" | "waiting_coach" | "no_goal";
  clientId: string;
  selfCoached: boolean;
  firstName: string;
  unit: "kg" | "lb";
  sex: "M" | "F" | null;
  read: RoadmapRead | null;
  explanation: { summary: string; focus: string } | null;
  activeRevisionId: string | null;
  pending: PendingRevision | null;
  history: RevisionSummary[];
  checkin: { due: boolean; dueOn: string | null; asks: CheckinAsk[]; reason: string | null };
  series: Array<{ date: string; kg: number }>;
  consent: boolean;
  goal: RoadmapGoalForm;
  /** The person looking can change things (never a coach viewing as the athlete). */
  canEdit: boolean;
  /** What the targets are now (average day). */
  current: Macros | null;
  missing: string[];
};

export type CoachRoadmapView = RoadmapView & {
  prefs: { everyDays: number | null; lockCompetition: boolean; reminders: boolean };
  /** A fresh plan from today, when it differs from the one in effect (the coach can propose it). */
  draft: { plan: RoadmapPlan; changes: string[] } | null;
};

export type BoardRow = {
  clientId: string;
  name: string;
  status: ProgressStatus | null;
  headline: string | null;
  needsCoach: boolean;
  decision: string | null;
  nextCheckinOn: string | null;
  waiting: "first" | "change" | null;
};

/**
 * What an athlete may see of their own revisions, the same rule as the "Athletes read own nutrition
 * roadmap revisions" policy: their own decisions, and their coach's only once in effect (active, or
 * superseded after being approved: `decided_at` is stamped on activation). A draft the coach never
 * approved stays the coach's, even once a newer draft replaces it. A coach in View as client reads
 * with his own login, so the client view applies this in code too.
 */
export function athleteSees(r: { decider: string; status: string; decided_at: string | null }): boolean {
  return r.decider === "athlete" || r.status === "active" || (r.status === "superseded" && !!r.decided_at);
}

export const STATUS_TONE: Record<ProgressStatus, "done" | "attention" | "error" | "neutral"> = {
  on_track: "done",
  ahead: "done",
  behind: "attention",
  insufficient_data: "neutral",
  needs_attention: "error",
};

const ORDER: Record<string, number> = { needs_attention: 0, behind: 1, insufficient_data: 2, ahead: 3, on_track: 4 };

/** The board in order: what needs the coach first, then the risks, then the rest. */
export function sortBoard(rows: BoardRow[]): BoardRow[] {
  return rows.slice().sort((a, b) => Number(b.needsCoach) - Number(a.needsCoach) || (ORDER[a.status ?? "on_track"] ?? 5) - (ORDER[b.status ?? "on_track"] ?? 5) || a.name.localeCompare(b.name));
}

/** "−150 kcal a day" / "+100 kcal a day". */
export function kcalWords(delta: number): string {
  const r = round(delta);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)} kcal a day`;
}

/** What a coach types into Change it with AI to carry an approved roadmap change into the plan. */
export function planChangeInstruction(d: Decision, blockTitle: string | null): string {
  if (!d.next || d.kcalChange == null) return d.headline;
  const why = blockTitle ? ` for the roadmap's ${blockTitle.toLowerCase()}` : "";
  if (d.kcalChange === 0) return `Set the plan to about ${d.next.kcal} kcal a day (protein ${d.next.proteinG} g, carbs ${d.next.carbsG} g, fat ${d.next.fatG} g)${why}. Keep the meals as meal-prep containers.`;
  const dir = d.kcalChange > 0 ? "Add" : "Take";
  return `${dir} about ${Math.abs(d.kcalChange)} kcal a day${d.kcalChange > 0 ? "" : " off"} every day type${why}: new average about ${d.next.kcal} kcal (protein ${d.next.proteinG} g, carbs ${d.next.carbsG} g, fat ${d.next.fatG} g). Keep protein the same and keep every meal a meal-prep container.`;
}

/**
 * The engine writes about the athlete ("their maintenance", "keeps them"); an athlete reading their own
 * roadmap gets it addressed to them. Words only, never a number.
 */
export function toYou(text: string): string {
  return text
    .replace(/\bThey're\b/g, "You're")
    .replace(/\bthey're\b/g, "you're")
    .replace(/\bThey've\b/g, "You've")
    .replace(/\bthey've\b/g, "you've")
    .replace(/\bTheir\b/g, "Your")
    .replace(/\btheir\b/g, "your")
    .replace(/\bthemselves\b/g, "yourself")
    .replace(/\bthem\b/g, "you")
    .replace(/\bThey\b/g, "You")
    .replace(/\bthey\b/g, "you");
}
