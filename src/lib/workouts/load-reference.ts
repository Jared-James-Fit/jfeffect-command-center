/**
 * How a prescribed percentage becomes the weight on the bar. The logger, the
 * program builder and the AI generator's loading guard all read this file.
 *
 * A row plans its load one of these ways (pl_exercise_rows.percentage_basis):
 *   training_max · 1rm · est_1rm  a % of a max
 *   top_set · prev_set            a % of a set logged earlier today (filled in once it's logged)
 *   manual                        a fixed load the coach typed
 *   none / null                   RPE or RIR only
 *
 * A % of a max reads the exercise's own max when one carries its name, else the
 * competition lift of its family: a High Bar Squat at 65% TM is 65% of the
 * Competition Squat TM. The family is the row's own (the builder's More) first,
 * then the exercise's. A % of e1RM reads a stored e1RM, else one worked out from
 * their logged competition sets (loggedE1rm), never a guess.
 *
 * When a % and an RPE are both prescribed, the % is the planned load and the RPE
 * is a cap (said under the prescription by percentLoadLine): a set logged over it
 * brings the next set down (capAdjustedLoad), and nothing ever pushes the load
 * above the plan.
 */
import { percentOf1RM } from "@/lib/load-suggestion";
import { rpeCap } from "@/lib/percent-load-line";

export type LiftFamily = "squat" | "bench" | "deadlift";
const FAMILIES: readonly LiftFamily[] = ["squat", "bench", "deadlift"];
export const isLiftFamily = (v: unknown): v is LiftFamily =>
  (FAMILIES as readonly string[]).includes(String(v ?? "").trim().toLowerCase());

/** Bases that read a max (the rest read a set logged today, a fixed load, or nothing). */
export const MAX_BASES = ["training_max", "1rm", "est_1rm"] as const;
export type MaxBasis = (typeof MAX_BASES)[number];
export const isMaxBasis = (b: unknown): b is MaxBasis => (MAX_BASES as readonly string[]).includes(String(b ?? ""));
/** Bases whose load comes from a set logged earlier in the same session. */
export const isSessionBasis = (b: unknown): boolean => b === "top_set" || b === "prev_set";

/** Which competition lift a % of a max refers to: the row's own family first, else the exercise's. */
export function referenceFamily(x: {
  rowFamily?: string | null;
  competitionLiftType?: string | null;
  movementFamily?: string | null;
}): LiftFamily | null {
  for (const v of [x.rowFamily, x.competitionLiftType, x.movementFamily]) {
    const s = String(v ?? "").trim().toLowerCase();
    if (isLiftFamily(s)) return s;
  }
  return null;
}

const LIFT_WORD: Record<LiftFamily, RegExp> = { squat: /\bsquat/, bench: /\bbench/, deadlift: /\bdead\s*lift/ };
const PLAIN_NAMES: Record<LiftFamily, string[]> = {
  squat: ["squat", "back squat", "low bar squat"],
  bench: ["bench", "bench press"],
  deadlift: ["deadlift", "conventional deadlift", "sumo deadlift"],
};

/** A max that stands for the competition lift: "Competition Squat", "Comp Bench", "Bench Press", "Deadlift". */
export function isCompetitionMaxName(lift: string, fam: LiftFamily): boolean {
  const n = lift.trim().toLowerCase().replace(/\s+/g, " ");
  if (!LIFT_WORD[fam].test(n)) return false;
  if (/^comp(etition)?\b/.test(n)) return true;
  return PLAIN_NAMES[fam].includes(n);
}

/** The athlete's max for a competition lift (a "Competition …" name first). */
export function competitionMax<T extends { lift: string; active?: boolean | null }>(maxes: T[], fam: LiftFamily): T | null {
  const live = maxes.filter((m) => m.active !== false && isCompetitionMaxName(m.lift, fam));
  return live.find((m) => /^comp/i.test(m.lift.trim())) ?? live[0] ?? null;
}

export type LoggedSet = { kg: number; reps: number; rpe: number | null; at: string | number };
const DAY_MS = 86_400_000;
/** How far back a logged e1RM reaches, and how many sessions it needs before it's worth programming from. */
export const E1RM_WINDOW_DAYS = 42;
export const E1RM_MIN_SESSIONS = 2;
/** Sets past 8 reps or under RPE 6.5 say too little about a max (their RIR is a guess). */
export const E1RM_MAX_REPS = 8;
export const E1RM_MIN_RPE = 6.5;

/**
 * A recent e1RM worth programming from: RPE-rated sets of 1–8 reps at RPE 6.5+
 * in the last 6 weeks, each session's best (RPE chart), the median of the last
 * three sessions. Null with fewer than two sessions: then the RPE leads.
 */
export function loggedE1rm(sets: LoggedSet[], now: number = Date.now()): { kg: number; sessions: number } | null {
  const best = new Map<string, number>();
  for (const s of sets) {
    const t = typeof s.at === "number" ? s.at : Date.parse(s.at);
    if (!Number.isFinite(t) || t > now + DAY_MS || now - t > E1RM_WINDOW_DAYS * DAY_MS) continue;
    if (!(s.kg > 0) || !(s.reps >= 1) || s.reps > E1RM_MAX_REPS) continue;
    if (s.rpe == null || !(s.rpe >= E1RM_MIN_RPE) || s.rpe > 10) continue;
    const pct = percentOf1RM(s.reps, 10 - s.rpe);
    if (!pct) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    best.set(day, Math.max(best.get(day) ?? 0, s.kg / pct));
  }
  if (best.size < E1RM_MIN_SESSIONS) return null;
  const recent = [...best.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)
    .map(([, v]) => v)
    .sort((a, b) => a - b);
  const mid = recent.length % 2 ? recent[(recent.length - 1) / 2] : (recent[recent.length / 2 - 1] + recent[recent.length / 2]) / 2;
  return { kg: Math.round(mid * 2) / 2, sessions: best.size };
}

const BASIS_SHORT: Record<MaxBasis, string> = { training_max: "TM", "1rm": "1RM", est_1rm: "e1RM" };

/** "Competition Squat" → "Comp Squat", "Competition Bench Press" → "Comp Bench". */
export function shortLiftName(lift: string): string {
  return lift
    .trim()
    .replace(/^competition\b/i, "Comp")
    .replace(/\bbench press\b/i, "Bench")
    .replace(/\s+/g, " ");
}

const fmtPct = (p: number) => String(Math.round(p * 100) / 100);

/**
 * The small label under the weight: "70% TM", "65% Comp Squat TM",
 * "92.5% of top set". The athlete reads the weight; this says where it came from.
 */
export function plannedLoadLabel(p: {
  percentage: number | string | null | undefined;
  basis: string | null | undefined;
  refLift?: string | null;
  viaFamily?: boolean;
}): string | null {
  const pct = Number(p.percentage);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  if (p.basis === "top_set") return `${fmtPct(pct)}% of top set`;
  if (p.basis === "prev_set") return `${fmtPct(pct)}% of last set`;
  if (!isMaxBasis(p.basis)) return null;
  const of = p.viaFamily && p.refLift ? `${shortLiftName(p.refLift)} ` : "";
  return `${fmtPct(pct)}% ${of}${BASIS_SHORT[p.basis]}`;
}

/** The cap in an RPE prescription as a number: "6" → 6, "6-7" → 7 (the top of a range, `rpeCap`). */
export function rpeCapValue(rpe: string | number | null | undefined): number | null {
  const n = Number(rpeCap(rpe));
  return rpeCap(rpe) != null && n >= 1 && n <= 10 ? n : null;
}

/** A planned load (a % of something) with an RPE: the RPE caps it. */
export function hasRpeCap(row: { percentage?: unknown; percentage_basis?: string | null; rpe?: unknown; manual_override?: boolean | null }): boolean {
  const pct = Number(row.percentage);
  const planned = Number.isFinite(pct) && pct > 0 && (isMaxBasis(row.percentage_basis) || isSessionBasis(row.percentage_basis));
  return planned && !row.manual_override && rpeCapValue(row.rpe as any) != null;
}

/**
 * After a set logged over the RPE cap: the load that would have sat at the cap
 * for the planned reps (the same RPE chart the suggestions use), rounded down to
 * a plate step, lighter than the set that was too hard and never above the plan.
 * Null when the set was within the cap.
 */
export function capAdjustedLoad(p: {
  planned: number | null;
  last: { load: number; reps: number; rpe: number | null } | null;
  cap: number;
  targetReps: number;
  step: number;
}): number | null {
  const last = p.last;
  if (!last || !(last.load > 0) || !(last.reps >= 1) || last.rpe == null || !(last.rpe > p.cap)) return null;
  const now = percentOf1RM(last.reps, 10 - last.rpe);
  const atCap = percentOf1RM(Math.max(1, p.targetReps), 10 - p.cap);
  if (!now || !atCap || !(p.step > 0)) return null;
  let next = Math.floor(((last.load / now) * atCap) / p.step) * p.step;
  next = Math.min(next, last.load - p.step, p.planned ?? Number.POSITIVE_INFINITY);
  return next > 0 ? Math.round(next * 100) / 100 : null;
}
