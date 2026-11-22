/**
 * The nutrition roadmap's shapes. A roadmap is a forecast, not a rigid
 * prescription: the whole journey from where they are to the goal is shown,
 * but only the current block is final, and everything after it is
 * recalculated as real weigh-ins, check-ins and intake come in. Everything
 * here is worked out in code (energy, rates, dates, checkpoints, status, the
 * decision); a model only ever words it. Pure types.
 */
import type { WeightUnit } from "@/lib/weight-management/units";

/**
 * Bump when the engine's decisions change: it's in every plan's hash, so a waiting draft made by an
 * older engine is superseded (kept as history) and made again. 2: Nov 22 2026, the first run on real
 * clients (an on-track plan never moved to an estimate, a meet with no class still planned around).
 */
export const ROADMAP_VERSION = 2;

/** What the whole roadmap is for. */
export type RoadmapGoalKind = "fat_loss" | "muscle_gain" | "recomp" | "maintain" | "weight_class" | "contest_prep" | "event";

export const GOAL_KIND_LABEL: Record<RoadmapGoalKind, string> = {
  fat_loss: "Fat loss",
  muscle_gain: "Muscle gain",
  recomp: "Recomposition",
  maintain: "Maintenance",
  weight_class: "Making a weight class",
  contest_prep: "Contest prep",
  event: "Event bodyweight",
};

export type BlockKind =
  | "baseline"
  | "surplus"
  | "fat_loss"
  | "recomp"
  | "maintenance"
  | "diet_break"
  | "pl_prep"
  | "contest_prep"
  | "performance"
  | "taper"
  | "post_comp"
  | "transition";

export const BLOCK_LABEL: Record<BlockKind, string> = {
  baseline: "Baseline and calibration",
  surplus: "Muscle-building surplus",
  fat_loss: "Controlled fat loss",
  recomp: "Recomposition",
  maintenance: "Maintenance",
  diet_break: "Diet break",
  pl_prep: "Meet prep: weight management",
  contest_prep: "Contest prep",
  performance: "Performance fueling",
  taper: "Competition week",
  post_comp: "Post-competition recovery",
  transition: "Transition",
};

/** Blocks a coach can lock so a reforecast never moves them (the meet's phases). */
export const COMPETITION_KINDS: BlockKind[] = ["performance", "taper", "post_comp"];

export type Macros = { kcal: number; proteinG: number; carbsG: number; fatG: number };

export type BlockEnergy = Macros & {
  /** Training days and rest days, when splitting the carbs is worth it; their weekly average is `kcal`. */
  training: Macros | null;
  rest: Macros | null;
  /** Where the numbers come from: the plan they're on now, or the engine's estimate. */
  from: "plan" | "estimate";
  /** Change from estimated maintenance, kcal a day (negative = a deficit). */
  vsMaintenance: number;
  /** Estimated maintenance at this block's bodyweight. */
  maintenance: number;
  /** The lowest this block's intake may go (resting energy at its bodyweight, or 25% under maintenance). */
  floorKcal: number;
  /** What the roadmap itself calls for in this block (the same as above unless the plan they're on differs). */
  engine: Macros;
  notes: string[];
};

export type Checkpoint = { date: string; kg: number; lowKg: number; highKg: number; label: string };

export type Block = {
  id: string;
  kind: BlockKind;
  title: string;
  /** Inclusive dates, YYYY-MM-DD. */
  start: string;
  end: string;
  weeks: number;
  status: "done" | "current" | "upcoming";
  /** Only the current block is final; the rest is a forecast. */
  final: boolean;
  locked: boolean;
  objective: string;
  weight: { startKg: number; targetKg: number; lowKg: number; highKg: number } | null;
  /** Expected bodyweight change, kg and % of bodyweight a week. */
  rate: { kgPerWeek: number; pctPerWeek: number };
  energy: BlockEnergy;
  priorities: string[];
  checkpoints: Checkpoint[];
  /** What has to be true to move on to the next block. */
  moveOnWhen: string[];
  rules: { keep: string; change: string; extend: string; end: string };
  why: string;
};

/** needs_weigh_ins: the last weigh-in is stale (10+ days), so nothing is judged, never "reached". */
export type FeasibilityVerdict = "realistic" | "aggressive" | "unlikely" | "unsafe" | "no_deadline" | "reached" | "no_goal" | "needs_weigh_ins";

export type Alternative = {
  kind: "extend" | "revise_target" | "weight_class" | "performance" | "slower";
  label: string;
  detail: string;
  date?: string;
  kg?: number;
};

export type Confidence = "low" | "moderate" | "high";

export type Feasibility = {
  verdict: FeasibilityVerdict;
  headline: string;
  weeksAvailable: number | null;
  /** target − current, kg (negative = to lose). */
  changeKg: number | null;
  required: { kgPerWeek: number; pctPerWeek: number } | null;
  sustainable: { comfortablePct: number; limitPct: number; kgPerWeek: number };
  /** Where they'd likely be on the date: from their own trend when there is one, else if the plan is followed. */
  expected: { lowKg: number; highKg: number; basis: "trend" | "plan" } | null;
  confidence: Confidence;
  confidenceWhy: string;
  tradeoffs: string[];
  reasons: string[];
  alternatives: Alternative[];
};

export type EnergyEstimate = {
  /** Estimated maintenance, kcal a day. */
  kcal: number;
  lowKcal: number;
  highKcal: number;
  source: "observed" | "formula" | "blend" | "plan" | "bodyweight";
  confidence: Confidence;
  /** Estimated resting energy (Mifflin–St Jeor), when height, age and sex are known. */
  rmr: number | null;
  /** The lowest a day's intake is planned to go. */
  floorKcal: number;
  why: string;
};

export type SafetyFlag = { key: string; severity: "refer" | "caution"; text: string };

export type Safety = {
  flags: SafetyFlag[];
  /** No plan may deepen a deficit while this is true. */
  noDeficit: boolean;
  /** Keep any loss at the comfortable rate, never the limit. */
  conservative: boolean;
  /** One line for the athlete: who to see and why. */
  referral: string | null;
};

export type ProgressStatus = "ahead" | "on_track" | "behind" | "insufficient_data" | "needs_attention";

export const STATUS_LABEL: Record<ProgressStatus, string> = {
  ahead: "Ahead of plan",
  on_track: "On track",
  behind: "Behind plan",
  insufficient_data: "Insufficient data",
  needs_attention: "Needs attention",
};

export type Progress = {
  status: ProgressStatus;
  headline: string;
  detail: string;
  /** Their level (noise taken out) against the planned path today, kg (positive = heavier than planned). */
  deviationKg: number | null;
  expectedKg: number | null;
  currentKg: number | null;
  /** The rate it takes from here to the block's target / the goal. */
  requiredKgPerWeek: number | null;
  currentKgPerWeek: number | null;
  projected: { date: string; kg: number; lowKg: number; highKg: number } | null;
  /** How much the logged data can be trusted. */
  reliability: { weighIns14: number; adherence: number | null; label: string };
  weeksToGoal: number | null;
};

export type CheckinAsk = "tracking" | "barriers" | "confounders" | "cycle" | "recovery" | "training";

export type CheckinSchedule = {
  on: string;
  kind: "quick" | "full" | "professional";
  reason: string;
  asks: CheckinAsk[];
  /** Days between this and the one after, if nothing changes. */
  cadenceDays: number;
};

export type DecisionAction = "hold" | "adjust" | "investigate" | "escalate" | "reconsider";

export type Decision = {
  action: DecisionAction;
  headline: string;
  reasons: string[];
  /** A nutrition change, kcal a day. */
  kcalChange: number | null;
  /** The targets after the change, average day. */
  next: Macros | null;
  /** Judge it again after this many days. */
  observeDays: number;
  /** Who has to say yes: a coach for a coached athlete, the athlete themselves when self-coached. */
  approval: "coach" | "athlete" | "none";
  /** A small, routine change a self-coached athlete let apply by itself. */
  autoEligible: boolean;
  /** Cardio, digestion, recovery or a question: not a target change. */
  other: string[];
};

export type RoadmapGoal = {
  kind: RoadmapGoalKind;
  label: string;
  kg: number | null;
  date: string | null;
  /** "at_most" for a class, "at_least" for a gain, "around" to hold. */
  direction: "at_most" | "at_least" | "around" | null;
  source: "meet" | "goal" | "phase";
  eventName: string | null;
  weightClass: string | null;
  limitKg: number | null;
  /** Weigh-in hours before lifting (2 for IPF affiliates, 24 for most others). */
  weighInHours: number | null;
  federation: string | null;
};

/** The planned journey, as stored on a revision. */
export type RoadmapPlan = {
  version: number;
  madeOn: string;
  unit: WeightUnit;
  goal: RoadmapGoal | null;
  startKg: number | null;
  feasibility: Feasibility;
  energy: EnergyEstimate;
  blocks: Block[];
  /** Weekly expected bodyweight, start to end, for the chart. */
  path: Array<{ date: string; kg: number; lowKg: number; highKg: number }>;
  /** What's missing that would change the plan (never what's already on file). */
  missing: string[];
  safety: Safety;
  hash: string;
};

/** A plan read against today's data. */
export type RoadmapRead = {
  plan: RoadmapPlan;
  progress: Progress;
  decision: Decision;
  checkin: CheckinSchedule;
  currentBlock: Block | null;
  nextMilestone: { date: string; label: string; kg: number | null; kind: "block" | "checkpoint" | "goal" } | null;
};
