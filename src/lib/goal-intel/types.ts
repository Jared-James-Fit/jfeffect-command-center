/**
 * Goal & Performance Intelligence: the shapes every part shares (Nov 26 2026,
 * docs/GOAL_INTELLIGENCE.md). One goal keeps three numbers apart and never
 * merges them:
 *
 *  - the client's target: what they said, in the unit they said it (or one
 *    read from their training numbers, marked inferred), with the words;
 *  - Cleo's projection: worked out on every read from their records, never
 *    stored as a target and never presented as one;
 *  - the approved target: the coach's, the only one anything else in the app
 *    plans around (programming, nutrition, Competition Intelligence).
 *
 * Everything is kg inside; the unit is only how it's shown.
 */

export const LB_PER_KG = 2.2046226218;

export type Unit = "kg" | "lb";
export type Lift = "squat" | "bench" | "deadlift";
export const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

export type GoalKind =
  /** a competition lift's result (a meet's third attempt, or a max by a date) */
  | "lift"
  /** squat + bench + deadlift */
  | "total"
  /** a bodyweight by a date (a class, a cut, a gain) */
  | "bodyweight"
  /** muscle, size, a body part, leaner: never scored */
  | "physique"
  /** get stronger, without a number: never scored */
  | "performance"
  /** qualify, podium, compete at a meet */
  | "event"
  /** how they want to go about it ("top end over 9 for 9") */
  | "preference";

export const KIND_WORD: Record<GoalKind, string> = {
  lift: "Lift",
  total: "Total",
  bodyweight: "Bodyweight",
  physique: "Physique",
  performance: "Strength",
  event: "Event",
  preference: "Preference",
};

export type GoalStatus = "proposed" | "active" | "dismissed" | "achieved" | "missed" | "archived";
export const OPEN_STATUSES: GoalStatus[] = ["proposed", "active"];

export type Confidence = "high" | "medium" | "low";

export type ApproachKey = "easy" | "conservative" | "moderate" | "high" | "very_aggressive" | "extreme";
export const APPROACHES: Array<{ key: ApproachKey; label: string }> = [
  { key: "easy", label: "Easy" },
  { key: "conservative", label: "Conservative" },
  { key: "moderate", label: "Moderate" },
  { key: "high", label: "High" },
  { key: "very_aggressive", label: "Very aggressive" },
  { key: "extreme", label: "Extremely aggressive" },
];
export const APPROACH_LABEL: Record<ApproachKey, string> = Object.fromEntries(APPROACHES.map((a) => [a.key, a.label])) as Record<ApproachKey, string>;

export type SourceKind = "meeting" | "checkin" | "message" | "coach" | "profile" | "competition" | "form";

/** A client_goals row as the app reads it. */
export type GoalRow = {
  id: string;
  client_id: string;
  kind: GoalKind;
  lift: Lift | null;
  title: string;
  direction: "up" | "down" | null;
  client_value: number | null;
  client_value_max: number | null;
  client_unit: Unit | null;
  client_unit_source: "stated" | "inferred" | "coach" | null;
  client_kg: number | null;
  client_kg_max: number | null;
  client_text: string | null;
  approved_value: number | null;
  approved_unit: Unit | null;
  approved_kg: number | null;
  approved_text: string | null;
  approved_approach: ApproachKey | null;
  approved_at: string | null;
  approved_by: string | null;
  /** the read when it was approved: what was projected and where they were (learning) */
  approved_read: { expectedKg: number | null; nowKg: number | null; score: number | null; confidence: Confidence | null; at: string } | null;
  deadline: string | null;
  competition_id: string | null;
  event_title: string | null;
  status: GoalStatus;
  client_facing: boolean;
  source_kind: SourceKind | null;
  source_id: string | null;
  source_quote: string | null;
  source_context: string | null;
  source_speaker: "athlete" | "coach" | "unclear" | null;
  source_at: string | null;
  tentative: boolean;
  feasibility: Feasibility | null;
  assessed_at: string | null;
  data_hash: string | null;
  recommendation: Recommendation | null;
  recommendation_status: "none" | "open" | "approved" | "edited" | "dismissed" | "maintained";
  recommendation_at: string | null;
  outcome: GoalOutcome | null;
  version: number;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
};

export type Range = { lowKg: number; expectedKg: number; highKg: number };

export type ApproachOption = {
  key: ApproachKey;
  label: string;
  targetKg: number;
  score: number;
  /** a few words: what it takes */
  line: string;
};

export type ActionKind =
  /** a goal nobody's reviewed yet: approve a target */
  | "approve"
  /** the current plan is working */
  | "maintain"
  /** the target needs more than the plan is giving: change the programming */
  | "adjust_program"
  /** the target is past what their records support: change the target */
  | "adjust_target"
  /** the target sits under what they're on track for */
  | "raise_target"
  /** too little recent data to judge */
  | "collect_data"
  /** pain or recovery comes first */
  | "protect"
  | "none";

export type Recommendation = {
  kind: ActionKind;
  /** one short line: what and why */
  line: string;
  /** a target the action suggests (kg), when it suggests one */
  suggestedKg: number | null;
  approach: ApproachKey | null;
  /** the expected benefit, in a few words */
  benefit: string | null;
  /** a stable key: the same advice twice is the same recommendation */
  key: string;
};

export type Feasibility = {
  version: 1;
  measurable: boolean;
  /** the unit numbers are shown in */
  unit: Unit;
  nowKg: number | null;
  /** where it started (the first read), for progress */
  baselineKg: number | null;
  projection: (Range & { source: "meet_forecast" | "training_trend" | "bodyweight_trend"; basis: string[] }) | null;
  /** the target being judged: the approved one, else the client's (its top end) */
  targetKg: number | null;
  judged: "approved" | "client" | null;
  score: number | null;
  /** the score of the client's own target when the approved one differs */
  clientScore: number | null;
  /** which approach the judged target falls in */
  band: ApproachKey | null;
  confidence: Confidence;
  approaches: ApproachOption[];
  recommended: ApproachKey | null;
  recommendedWhy: string | null;
  /** the one-line answer: "82/100 feasibility: Current training supports this target." */
  headline: string;
  action: Recommendation;
  progress: { pct: number | null; line: string | null };
  timeLeft: { days: number | null; line: string };
  /** % a week it takes against what they've shown and what's usual for their level */
  pace: { requiredPctPerWeek: number | null; demonstratedPctPerWeek: number | null; usualPctPerWeek: [number, number] | null };
  reasons: string[];
  missing: string[];
};

export type GoalOutcome = {
  result: "achieved" | "missed";
  actualKg: number | null;
  at: string;
  source: "meet_results" | "training_line" | "bodyweight_trend" | "coach";
  /** what was projected when the target was approved (learning) */
  projectedAtApprovalKg: number | null;
  nowAtApprovalKg: number | null;
};

/* ------------------------------------------------------------------ */

export const toKg = (v: number, unit: Unit) => (unit === "lb" ? v / LB_PER_KG : v);
export const fromKg = (kg: number, unit: Unit) => (unit === "lb" ? kg * LB_PER_KG : kg);

/** A weight as a person reads it: kg to the half, lb to the whole pound. */
export function fmtWeight(kg: number | null | undefined, unit: Unit): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  const v = fromKg(kg, unit);
  const shown = unit === "kg" ? Math.round(v * 2) / 2 : Math.round(v);
  return `${Number.isInteger(shown) ? shown : shown.toFixed(1)} ${unit}`;
}

/** The client's stated target as they said it ("220–225 lb"). */
export function fmtClientTarget(g: Pick<GoalRow, "client_value" | "client_value_max" | "client_unit" | "client_text">): string | null {
  if (g.client_value == null) return g.client_text ?? null;
  const u = g.client_unit ?? "(unit unconfirmed)";
  const a = Number(g.client_value);
  const b = g.client_value_max != null ? Number(g.client_value_max) : null;
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return b != null && b !== a ? `${n(a)}–${n(b)} ${u}` : `${n(a)} ${u}`;
}

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** How long until the deadline, in words a coach reads at a glance. */
export function timeLeftLine(today: string, deadline: string | null): { days: number | null; line: string } {
  if (!deadline) return { days: null, line: "No date" };
  const d = daysBetween(today, deadline);
  if (d < 0) return { days: d, line: d === -1 ? "Yesterday" : `${-d} days ago` };
  if (d === 0) return { days: 0, line: "Today" };
  if (d === 1) return { days: 1, line: "Tomorrow" };
  if (d < 21) return { days: d, line: `${d} days` };
  const w = Math.round(d / 7);
  if (d < 120) return { days: d, line: `${w} weeks` };
  const m = Math.round(d / 30.4);
  return { days: d, line: `${m} months` };
}
