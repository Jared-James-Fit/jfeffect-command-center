/**
 * Competition Intelligence: the shapes every part of the system shares (pure).
 *
 * Every load is kilograms (meets are kg; the screens show lb beside it). Every
 * number the system shows comes from a deterministic engine in this folder;
 * Cleo's words around them are checked against them (grounding.ts).
 */

export type Lift = "squat" | "bench" | "deadlift";
export const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
export const LIFT_LABEL: Record<Lift, string> = {
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
};

/** The scheduled strategic deliverables, in preparation order. */
export type MilestoneKind =
  | "recon"
  | "foundation"
  | "intel"
  | "forecast"
  | "game_plan"
  | "confirm"
  | "update"
  | "debrief";

export type Objective =
  | "win"
  | "podium"
  | "qualify"
  | "record"
  | "pb_total"
  | "first_meet"
  | "return"
  | "experience";

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  win: "Win",
  podium: "Podium",
  qualify: "Qualify",
  record: "Set a record",
  pb_total: "Best total",
  first_meet: "Successful first meet",
  return: "Return from injury",
  experience: "Competition experience",
};

export type MeetLevel = "international" | "national" | "regional" | "provincial" | "local";

/** Three scenarios, never a probability. */
export type Range = { conservative: number; expected: number; high: number };

export type Confidence = "high" | "medium" | "low";

/** One attempt as OpenPowerlifting stores it: a negative number is a miss. */
export type AttemptTriple = [number | null, number | null, number | null];

/** One meet, theirs or a competitor's (OpenPowerlifting's fields, kg). */
export type MeetRecord = {
  date: string;
  name: string | null;
  federation: string | null;
  equipment: string | null;
  event: string | null;
  division: string | null;
  weightClass: string | null;
  bodyweight: number | null;
  squat: number | null;
  bench: number | null;
  deadlift: number | null;
  total: number | null;
  place: string | null;
  attempts: { s: AttemptTriple; b: AttemptTriple; d: AttemptTriple } | null;
  tested?: boolean | null;
  country?: string | null;
};

/** A training lift seen somewhere outside the app (a post, a video, a coach's note). */
export type Observation = {
  id?: string;
  date: string;
  lift: Lift | null;
  exercise: string;
  loadKg: number;
  reps: number;
  rpe: number | null;
  /** competition standard (paused bench, no straps, raw) or a variation that doesn't compare */
  standard: "competition" | "variation" | "unclear";
  equipment: string | null;
  source: "instagram" | "video" | "screenshot" | "link" | "manual" | "caption";
  url: string | null;
  confidence: Confidence;
  note: string | null;
  /** mean concentric velocity (m/s) when the source gives one */
  velocity?: number | null;
  /** how the rep looked to the coach on video: to standard, or questionable (depth, lockout, a hitch) */
  technique?: "clean" | "questionable" | null;
};
