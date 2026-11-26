/**
 * How achievable a goal is, from the athlete's own records (pure, tested in
 * goal-intel.test.ts). Never a probability and never a model's guess: the
 * feasibility score is where the target sits in the athlete's own projected
 * range, said as a score out of 100, with how much that range can be trusted
 * (confidence) said separately.
 *
 * The projection reuses the engines that already exist, so the numbers agree
 * with the rest of the app:
 *  - a goal at a meet reads Competition Intelligence's forecast (forecast.ts:
 *    the analytics' strength line, their own training-to-platform conversion,
 *    concerns lowering the conservative day);
 *  - a lift by a date reads the same strength line and its trend
 *    (lift-strength.ts), the athlete's demonstrated rate checked against the
 *    rate usual for their training age (athlete-development's
 *    EXPECTED_MONTHLY_PCT), long horizons damped (gains slow down), and
 *    shrunk or stretched by how their past approved targets actually went
 *    (calibration, from resolved goals only);
 *  - a bodyweight by a date reads the weight-management trajectory's
 *    least-squares trend and judges the pace against target.ts's rates for
 *    the sport and goal.
 *
 * Six approaches turn the range into targets a coach can pick from (easy to
 * extremely aggressive), and one recommendation says what to do now: keep the
 * plan, change the programming, change the target, or collect data first.
 */
import { EXPECTED_MONTHLY_PCT, type TrainingLevel } from "@/lib/program-intel/athlete-development";
import { GAIN_RATES, LOSS_RATES, type GoalContext as WeightGoalContext } from "@/lib/weight-management/target";
import {
  APPROACHES,
  APPROACH_LABEL,
  daysBetween,
  fmtWeight,
  timeLeftLine,
  type ApproachKey,
  type ApproachOption,
  type Confidence,
  type Feasibility,
  type GoalRow,
  type Lift,
  type Range,
  type Recommendation,
  type Unit,
} from "./types";

/** The strength line for one lift (competition load.server.ts LiftEvidence). */
export type StrengthRead = {
  nowKg: number | null;
  state: "measured" | "raised" | "held" | "stale" | "floor" | null;
  basis: string | null;
  basisDay: string | null;
  hardSessions6w: number;
  /** the line's change per week, as a share (0.005 = +0.5%) */
  trendPerWeek: number | null;
  direction: "up" | "flat" | "down" | "unclear";
};

export type MeetForecast = {
  competitionId: string;
  meetDate: string;
  name: string;
  lifts: Partial<Record<Lift, { conservative: number; expected: number; high: number } | null>>;
  total: { conservative: number; expected: number; high: number } | null;
  /** Exact per-lift evidence from the shared competition forecast. */
  liftBasis?: Partial<Record<Lift, string[]>>;
  confidence: Confidence;
  incrementKg: number;
  /** pain or recovery concerns on a lift, in words */
  concerns: Array<{ lift: Lift | null; severity: "watch" | "concern" | "serious"; text: string }>;
};

export type BodyweightRead = {
  currentKg: number;
  /** the trend's kg a week (negative = losing), when there's a usable trend */
  trendKgPerWeek: number | null;
  trendClear: boolean;
  seKgPerWeek: number | null;
  noiseKg: number | null;
  weighInsLast14: number;
  stale: boolean;
};

export type GoalContext = {
  today: string;
  unit: Unit;
  level: TrainingLevel | null;
  lifts: Partial<Record<Lift, StrengthRead>>;
  /** forecasts for the client's upcoming competitions, by id */
  meets: Record<string, MeetForecast>;
  bodyweight: BodyweightRead | null;
  /** the weight-management goal context (powerlifting_class, fat_loss, gain …) */
  weightContext: WeightGoalContext | null;
  /** pain or recovery concerns from their records, by lift (null = general) */
  concerns: Array<{ lift: Lift | null; severity: "watch" | "concern" | "serious"; text: string }>;
  /** planned workouts done in the last 4 weeks, % (null when nothing was planned) */
  adherencePct: number | null;
  /** how their past approved targets went against their projection (resolved goals), 0.5–1.5 */
  calibration: number | null;
  /** what they've said about how they want to go about it, by competition id (preferences) */
  preferences: Record<string, string[]>;
};

export type GoalSpec = Pick<
  GoalRow,
  | "kind"
  | "lift"
  | "client_kg"
  | "client_kg_max"
  | "approved_kg"
  | "deadline"
  | "competition_id"
  | "status"
  | "approved_approach"
  | "client_text"
  | "approved_text"
> & { baselineKg?: number | null; direction?: "up" | "down" | null };

/* ------------------------------------------------------------------ */

const round = (x: number, step: number) => Math.round(x / step) * step;
const floorTo = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Scores at each approach's target: the target's place in their own range, not a chance. */
export const ANCHOR_SCORE: Record<ApproachKey, number> = {
  easy: 95,
  conservative: 88,
  moderate: 75,
  high: 55,
  very_aggressive: 35,
  extreme: 15,
};
/** Under this much recent evidence a projection is low confidence. */
export const MIN_HARD_SESSIONS = 3;
/** Training-trend projections slow down past this many weeks (gains come in steps). */
export const DAMP_AFTER_WEEKS = 12;

/**
 * Where a value sits among the anchors (ascending for a goal that goes up,
 * descending for one that comes down), as a score 0–100: 95 at the easy
 * approach, 75 at the moderate one, 15 at extremely aggressive, a little more
 * under easy and falling off past extreme.
 */
export function scoreAgainst(value: number, anchors: Record<ApproachKey, number>, direction: "up" | "down"): { score: number; band: ApproachKey } {
  const keys = APPROACHES.map((a) => a.key);
  const sign = direction === "up" ? 1 : -1;
  const v = value * sign;
  const pts = keys.map((k) => ({ k, x: anchors[k] * sign, s: ANCHOR_SCORE[k] }));
  if (v <= pts[0].x) {
    const span = Math.max(1e-6, pts[1].x - pts[0].x);
    return { score: Math.round(clamp(ANCHOR_SCORE.easy + ((pts[0].x - v) / span) * 3, 0, 98)), band: "easy" };
  }
  for (let i = 1; i < pts.length; i++) {
    if (v <= pts[i].x) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = b.x - a.x > 1e-9 ? (v - a.x) / (b.x - a.x) : 1;
      return { score: Math.round(a.s + (b.s - a.s) * t), band: t <= 0.5 ? a.k : b.k };
    }
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const span = Math.max(1e-6, last.x - prev.x);
  return { score: Math.round(clamp(ANCHOR_SCORE.extreme - ((v - last.x) / span) * 12, 2, 15)), band: "extreme" };
}

/** The one-line read of a score: short, plain, never a promise. */
export function scoreLine(score: number): string {
  if (score >= 85) return "Current training comfortably supports this target.";
  if (score >= 70) return "Current training supports this target.";
  if (score >= 50) return "Achievable if training keeps going as it is.";
  if (score >= 30) return "High risk: needs faster progress than historically demonstrated.";
  return "Very high risk: well past what their records support.";
}

/** The six approaches' targets from a projected range (kg), rounded to what can be loaded. */
export function approachAnchors(nowKg: number, range: Range, step: number, direction: "up" | "down" = "up"): Record<ApproachKey, number> {
  const s = direction === "up" ? 1 : -1;
  const low = range.lowKg * s;
  const exp = range.expectedKg * s;
  const high = range.highKg * s;
  const width = Math.max(step, high - exp, exp - low);
  const easy = Math.min(low - Math.max(step, 0.5 * (exp - low)), exp - 2 * step);
  const very = high + Math.max(step, high - exp);
  const extreme = high + 2.5 * Math.max(step, high - exp, width * 0.75);
  const fl = (x: number) => (direction === "up" ? floorTo(x, step) : -floorTo(-x, step));
  const nr = (x: number) => round(x, step);
  void nowKg;
  const raw: Record<ApproachKey, number> = {
    easy: fl(easy * s),
    conservative: fl(low * s),
    moderate: nr(exp * s),
    high: nr(high * s),
    very_aggressive: nr(very * s),
    extreme: nr(extreme * s),
  };
  // strictly in order, a step apart
  const keys = APPROACHES.map((a) => a.key);
  for (let i = 1; i < keys.length; i++) {
    const prev = raw[keys[i - 1]] * s;
    if (raw[keys[i]] * s <= prev) raw[keys[i]] = (prev + step) * s;
  }
  return raw;
}

const APPROACH_LINE: Record<ApproachKey, string> = {
  easy: "Very likely; leaves room on the table",
  conservative: "Likely on a normal day",
  moderate: "Needs training to keep going as it is",
  high: "Needs things to go well",
  very_aggressive: "Needs faster progress than shown",
  extreme: "High risk: past anything on record",
};

/** Usual strength gain for their level, % a week (from the monthly reference). */
export function usualWeeklyPct(level: TrainingLevel | null): [number, number] | null {
  const band = EXPECTED_MONTHLY_PCT[level ?? "intermediate"];
  return band ? [r2(band[0] / 4.345), r2(band[1] / 4.345)] : null;
}

/** A lift's projected range by a date from its training line (not a meet). */
export function trainingProjection(
  read: StrengthRead,
  today: string,
  deadline: string,
  level: TrainingLevel | null,
  calibration: number | null,
): { range: Range; confidence: Confidence; basis: string[]; demonstratedPct: number | null } | null {
  if (!read.nowKg || read.nowKg <= 0 || read.state === "floor") return null;
  const weeks = Math.max(0, daysBetween(today, deadline) / 7);
  const usual = usualWeeklyPct(level) ?? [0.1, 0.45];
  const demonstrated = read.direction !== "unclear" && read.trendPerWeek != null ? read.trendPerWeek * 100 : null;
  // their own rate where it's in a believable range, else the middle of what's usual for their level
  const usualMid = (usual[0] + usual[1]) / 2;
  let rate = demonstrated != null && demonstrated > 0 ? Math.min(demonstrated, usual[1] * 1.5) : usualMid;
  if (demonstrated != null && demonstrated <= 0) rate = usual[0];
  const basis: string[] = [];
  if (read.basis) basis.push(`Training: ${read.basis}`);
  basis.push(
    demonstrated != null
      ? `Their line has moved ${demonstrated >= 0 ? "+" : ""}${r2(demonstrated)}% a week lately (usual for ${level ?? "their level"}: ${usual[0]}–${usual[1]}%)`
      : `No clear trend yet: used the usual ${usual[0]}–${usual[1]}% a week for ${level ?? "an intermediate"}`,
  );
  const effWeeks = weeks <= DAMP_AFTER_WEEKS ? weeks : DAMP_AFTER_WEEKS + (weeks - DAMP_AFTER_WEEKS) * 0.5;
  let gain = read.nowKg * (rate / 100) * effWeeks;
  if (calibration != null && Math.abs(calibration - 1) > 0.05) {
    gain *= calibration;
    basis.push(`Scaled by how their past targets went (×${r2(calibration)})`);
  }
  const expected = read.nowKg + gain;
  let conf: Confidence =
    (read.state === "measured" || read.state === "raised") && read.hardSessions6w >= MIN_HARD_SESSIONS
      ? "high"
      : read.state !== "stale" && read.hardSessions6w >= 1
        ? "medium"
        : "low";
  if (weeks > 26 && conf === "high") conf = "medium";
  const spread = { high: 0.025, medium: 0.04, low: 0.065 }[conf] + Math.min(0.06, 0.004 * Math.sqrt(Math.max(0, weeks)));
  const low = Math.max(read.nowKg * (1 - spread / 2), expected - read.nowKg * spread);
  const high = expected + read.nowKg * spread + Math.max(0, gain) * 0.5;
  if (read.state === "held") basis.push("No hard set lately: the line is held, not lowered");
  if (read.state === "stale") basis.push("No hard set in 8 weeks: the line is stale");
  return { range: { lowKg: r1(low), expectedKg: r1(expected), highKg: r1(high) }, confidence: conf, basis, demonstratedPct: demonstrated != null ? r2(demonstrated) : null };
}

/** The approach that fits this athlete now, and why (short). */
export function recommendApproach(x: {
  confidence: Confidence;
  concerns: GoalContext["concerns"];
  lift: Lift | null;
  adherencePct: number | null;
  preferences: string[];
  meetSoon: boolean;
}): { key: ApproachKey; why: string; evidence?: string } {
  const mine = x.concerns.filter((c) => (c.lift === x.lift || c.lift == null) && c.severity !== "watch");
  if (mine.length) return { key: "conservative", why: mine[0].text.replace(/\.$/, "") + ": that comes first" };
  if (x.confidence === "low") return { key: "conservative", why: "Low confidence: more recent training data is needed" };
  if (x.adherencePct != null && x.adherencePct < 70) return { key: "conservative", why: `About ${Math.round(x.adherencePct)}% of planned training done lately` };
  const topPreference = x.preferences.find((p) => /\b(top end|top-end|go for|max(imi[sz]e)?|aggressive|pr|personal best|send it|9 ?\/ ?9.*(don|not)|don.?t care.*9)/i.test(p));
  if (topPreference && x.meetSoon) return { key: "high", why: "A recorded meet preference favors the top end. This selects the upper forecast, not a guaranteed lift.", evidence: topPreference };
  return { key: "moderate", why: "Their projection's middle: what training supports now" };
}

const ACTION_BENEFIT: Partial<Record<Recommendation["kind"], string>> = {
  maintain: "No change for change's sake",
  adjust_program: "Progression that matches the target",
  adjust_target: "A target their records support",
  raise_target: "A target that uses what they've built",
  collect_data: "A read worth acting on",
  protect: "Keeps them training",
};

/** Read one goal against the records. */
export function assessGoal(goal: GoalSpec, ctx: GoalContext): Feasibility {
  const unit = ctx.unit;
  const time = timeLeftLine(ctx.today, goal.deadline);
  const missing: string[] = [];
  const reasons: string[] = [];
  const base: Omit<Feasibility, "headline" | "action" | "confidence"> = {
    version: 1,
    measurable: false,
    unit,
    nowKg: null,
    baselineKg: goal.baselineKg ?? null,
    projection: null,
    targetKg: null,
    judged: null,
    score: null,
    clientScore: null,
    band: null,
    approaches: [],
    recommended: null,
    recommendedWhy: null,
    progress: { pct: null, line: null },
    timeLeft: time,
    pace: { requiredPctPerWeek: null, demonstratedPctPerWeek: null, usualPctPerWeek: null },
    reasons,
    missing,
  };
  const none = (headline: string, kind: Recommendation["kind"] = "none", confidence: Confidence = "low"): Feasibility => ({
    ...base,
    confidence,
    headline,
    action: {
      kind: goal.status === "proposed" && kind === "none" ? "approve" : kind,
      line: goal.status === "proposed" && kind === "none" ? "Review: keep it as a goal, or let it go." : headline,
      suggestedKg: null,
      approach: null,
      benefit: null,
      key: `${goal.status === "proposed" && kind === "none" ? "approve" : kind}:`,
    },
  });

  if (goal.kind === "physique" || goal.kind === "performance" || goal.kind === "preference" || goal.kind === "event") {
    return none(goal.kind === "preference" ? "How they want to approach it: kept with the event." : "Not scored: a goal in words, tracked by the coach.");
  }

  const target = goal.approved_kg ?? goal.client_kg_max ?? goal.client_kg ?? null;
  const judged: Feasibility["judged"] = goal.approved_kg != null ? "approved" : target != null ? "client" : null;

  /* -------------------- bodyweight -------------------- */
  if (goal.kind === "bodyweight") {
    const bw = ctx.bodyweight;
    if (!bw) {
      missing.push("No recent weigh-ins");
      return none("Low confidence: weigh-ins are needed to read this.", "collect_data");
    }
    base.measurable = true;
    base.nowKg = r1(bw.currentKg);
    base.targetKg = target;
    base.judged = judged;
    if (target == null) return none("No number yet.", "none");
    const direction: "up" | "down" = target >= bw.currentKg ? "up" : "down";
    const weeks = goal.deadline ? daysBetween(ctx.today, goal.deadline) / 7 : null;
    const ctxKind: WeightGoalContext = ctx.weightContext ?? (direction === "up" ? "gain" : "fat_loss");
    const rates =
      direction === "up"
        ? GAIN_RATES[ctx.level ?? "intermediate"]
        : LOSS_RATES[(ctxKind === "gain" || ctxKind === "maintain" ? "fat_loss" : ctxKind) as keyof typeof LOSS_RATES];
    const conf: Confidence = bw.stale || bw.weighInsLast14 < 3 ? "low" : bw.trendClear && bw.weighInsLast14 >= 6 ? "high" : "medium";
    if (bw.stale) missing.push("No weigh-in in the last 10 days");
    const progressOf = () => {
      const start = base.baselineKg;
      if (start == null || Math.abs(target - start) < 0.2) return;
      const pct = clamp(((bw.currentKg - start) / (target - start)) * 100, -100, 100);
      base.progress = { pct: Math.round(pct), line: `${fmtWeight(start, unit)} → ${fmtWeight(bw.currentKg, unit)} of ${fmtWeight(target, unit)}` };
    };
    progressOf();
    if (weeks == null || weeks <= 0) {
      const reached = direction === "up" ? bw.currentKg >= target : bw.currentKg <= target;
      return { ...base, confidence: conf, headline: reached ? "At the goal: hold it." : "No date: judged once a date is set.", action: rec(reached ? "maintain" : "none", reached ? "Hold the weight there." : "Add a date to judge the pace.", null, null) };
    }
    // the pace each approach takes, % of bodyweight a week
    const paces: Record<ApproachKey, number> = {
      easy: rates.comfortable * 0.25,
      conservative: rates.comfortable * 0.6,
      moderate: rates.comfortable,
      high: (rates.comfortable + rates.limit) / 2,
      very_aggressive: rates.limit,
      extreme: rates.limit * 1.4,
    };
    const s = direction === "up" ? 1 : -1;
    const anchors = Object.fromEntries(
      APPROACHES.map((a) => {
        return [a.key, r1(bw.currentKg * (1 + (s * paces[a.key] * weeks) / 100))];
      }),
    ) as Record<ApproachKey, number>;
    const requiredPct = ((target - bw.currentKg) / bw.currentKg / weeks) * 100;
    base.pace = { requiredPctPerWeek: r2(requiredPct), demonstratedPctPerWeek: bw.trendKgPerWeek != null && bw.trendClear ? r2((bw.trendKgPerWeek / bw.currentKg) * 100) : null, usualPctPerWeek: [r2(rates.comfortable), r2(rates.limit)] };
    if (bw.trendKgPerWeek != null && bw.trendClear) {
      const exp = bw.currentKg + bw.trendKgPerWeek * weeks;
      const w = (bw.seKgPerWeek ?? 0.1) * weeks * 2 + (bw.noiseKg ?? 0.5);
      base.projection = { lowKg: r1(exp - w), expectedKg: r1(exp), highKg: r1(exp + w), source: "bodyweight_trend", basis: [`Their trend: ${bw.trendKgPerWeek >= 0 ? "+" : ""}${r2(bw.trendKgPerWeek)} kg a week`] };
    } else {
      reasons.push("No clear trend yet: the pace is judged against the safe rates for the goal");
    }
    const { score, band } = scoreAgainst(target, anchors, direction);
    base.score = score;
    base.band = band;
    base.approaches = APPROACHES.map((a) => ({ key: a.key, label: a.label, targetKg: anchors[a.key], score: ANCHOR_SCORE[a.key], line: `${r2(paces[a.key])}% of bodyweight a week` }));
    if (goal.approved_kg != null && goal.client_kg != null) base.clientScore = scoreAgainst(goal.client_kg_max ?? goal.client_kg, anchors, direction).score;
    const recd = recommendApproach({ confidence: conf, concerns: ctx.concerns, lift: null, adherencePct: ctx.adherencePct, preferences: [], meetSoon: false });
    // bodyweight: a powerlifter's class cut never goes past the comfortable pace on its own
    base.recommended = recd.key === "moderate" && direction === "down" && ctxKind === "powerlifting_class" ? "conservative" : recd.key;
    base.recommendedWhy = recd.key === base.recommended ? recd.why : "A class cut keeps strength best at a steady pace";
    reasons.push(`Needs ${Math.abs(r2(requiredPct))}% of bodyweight a week (comfortable up to ${rates.comfortable}%, limit ${rates.limit}%)`);
    const action = decideAction({ goal, score, band, conf, anchors, recommended: base.recommended, weeks, direction, unit, projection: base.projection });
    return { ...base, confidence: conf, headline: `${score}/100 feasibility: ${bwLine(score, requiredPct, rates)}`, action };
  }

  /* -------------------- lift / total -------------------- */
  const lifts: Lift[] = goal.kind === "total" ? ["squat", "bench", "deadlift"] : goal.lift ? [goal.lift] : [];
  if (!lifts.length) return none("Not scored: no lift named.");
  const meet = goal.competition_id ? ctx.meets[goal.competition_id] : undefined;
  const step = meet?.incrementKg ?? 2.5;
  let range: Range | null = null;
  let conf: Confidence = "low";
  const basis: string[] = [];
  let demonstrated: number | null = null;
  if (meet) {
    const r = goal.kind === "total" ? meet.total : meet.lifts[goal.lift as Lift] ?? null;
    if (r) {
      range = { lowKg: r.conservative, expectedKg: r.expected, highKg: r.high };
      conf = meet.confidence;
      basis.push(`Competition forecast for ${meet.name}`);
      for (const lift of lifts) for (const line of meet.liftBasis?.[lift] ?? []) basis.push(goal.kind === "total" ? `${lift}: ${line}` : line);
    }
  }
  if (!range) {
    const deadline = goal.deadline ?? meet?.meetDate ?? null;
    if (!deadline) {
      missing.push("No date");
    } else {
      const parts = lifts.map((l) => {
        const read = ctx.lifts[l];
        return read ? trainingProjection(read, ctx.today, deadline, ctx.level, ctx.calibration) : null;
      });
      if (parts.every(Boolean)) {
        const ps = parts as NonNullable<(typeof parts)[number]>[];
        range = { lowKg: r1(ps.reduce((s, p) => s + p.range.lowKg, 0)), expectedKg: r1(ps.reduce((s, p) => s + p.range.expectedKg, 0)), highKg: r1(ps.reduce((s, p) => s + p.range.highKg, 0)) };
        conf = ps.reduce<Confidence>((c, p) => (rank(p.confidence) < rank(c) ? p.confidence : c), "high");
        for (const p of ps) basis.push(...p.basis);
        demonstrated = ps.length === 1 ? ps[0].demonstratedPct : null;
      } else {
        lifts.forEach((l, i) => {
          if (!parts[i]) missing.push(`No usable ${l} estimate: log a few hard sets (RPE 7+, 10 reps or fewer)`);
        });
      }
    }
  }
  const nowKg = lifts.every((l) => ctx.lifts[l]?.nowKg) ? r1(lifts.reduce((s, l) => s + (ctx.lifts[l]?.nowKg ?? 0), 0)) : null;
  base.nowKg = nowKg;
  base.targetKg = target;
  base.judged = judged;
  if (!range) {
    return { ...none("Low confidence: more recent training data is needed.", "collect_data"), nowKg, targetKg: target, judged, missing };
  }
  base.measurable = true;
  base.projection = { ...range, source: meet && basis[0]?.startsWith("Competition") ? "meet_forecast" : "training_trend", basis };
  const anchors = approachAnchors(nowKg ?? range.lowKg, range, step, "up");
  base.approaches = APPROACHES.map<ApproachOption>((a) => ({ key: a.key, label: a.label, targetKg: anchors[a.key], score: ANCHOR_SCORE[a.key], line: APPROACH_LINE[a.key] }));
  const weeks = goal.deadline || meet ? Math.max(0, daysBetween(ctx.today, (goal.deadline ?? meet?.meetDate) as string) / 7) : null;
  base.pace.usualPctPerWeek = usualWeeklyPct(ctx.level);
  base.pace.demonstratedPctPerWeek = demonstrated;
  const concerns = [...ctx.concerns, ...(meet?.concerns ?? [])];
  const recd = recommendApproach({
    confidence: conf,
    concerns,
    lift: goal.kind === "lift" ? goal.lift : null,
    adherencePct: ctx.adherencePct,
    preferences: goal.competition_id ? ctx.preferences[goal.competition_id] ?? [] : [],
    meetSoon: !!meet && weeks != null && weeks <= 3,
  });
  base.recommended = recd.key;
  base.recommendedWhy = recd.why;
  if (recd.evidence) base.recommendationEvidence = recd.evidence;
  if (base.baselineKg != null && target != null && nowKg != null && Math.abs(target - base.baselineKg) >= step) {
    const pct = clamp(((nowKg - base.baselineKg) / (target - base.baselineKg)) * 100, -100, 100);
    base.progress = { pct: Math.round(pct), line: `${fmtWeight(base.baselineKg, unit)} → ${fmtWeight(nowKg, unit)} of ${fmtWeight(target, unit)}` };
  }
  if (target == null) {
    const action = rec(goal.status === "proposed" ? "approve" : "none", `Review: ${APPROACH_LABEL[recd.key]} is ${fmtWeight(anchors[recd.key], unit)}.`, anchors[recd.key], recd.key);
    return { ...base, confidence: conf, headline: `Projected ${fmtWeight(range.expectedKg, unit)} (${fmtWeight(range.lowKg, unit)}–${fmtWeight(range.highKg, unit)})`, action };
  }
  const { score, band } = scoreAgainst(target, anchors, "up");
  base.score = score;
  base.band = band;
  if (goal.approved_kg != null && (goal.client_kg_max ?? goal.client_kg) != null) base.clientScore = scoreAgainst((goal.client_kg_max ?? goal.client_kg) as number, anchors, "up").score;
  if (nowKg != null && weeks != null && weeks > 0) base.pace.requiredPctPerWeek = r2(((target - nowKg) / nowKg / weeks) * 100);
  if (base.pace.requiredPctPerWeek != null && base.pace.usualPctPerWeek && !meet)
    reasons.push(`Needs about ${base.pace.requiredPctPerWeek}% a week${demonstrated != null ? `; they've shown ${demonstrated}%` : ""} (usual for their level ${base.pace.usualPctPerWeek[0]}–${base.pace.usualPctPerWeek[1]}%)`);
  if (concerns.some((c) => c.severity !== "watch" && (c.lift == null || lifts.includes(c.lift as Lift)))) reasons.push(concerns.filter((c) => c.severity !== "watch").map((c) => c.text).join("; "));
  const action = decideAction({ goal, score, band, conf, anchors, recommended: recd.key, weeks, direction: "up", unit, projection: base.projection, concerned: recd.key === "conservative" && !/Low confidence/.test(recd.why) && !/planned training/.test(recd.why), meet: !!meet });
  const headline = conf === "low" && score >= 50 ? `${score}/100 feasibility (low confidence): more recent training data is needed.` : `${score}/100 feasibility: ${scoreLine(score)}`;
  return { ...base, confidence: conf, headline, action };
}

const rank = (c: Confidence) => ({ low: 0, medium: 1, high: 2 })[c];

function rec(kind: Recommendation["kind"], line: string, suggestedKg: number | null, approach: ApproachKey | null): Recommendation {
  return { kind, line, suggestedKg, approach, benefit: ACTION_BENEFIT[kind] ?? null, key: `${kind}:${approach ?? ""}:${suggestedKg ?? ""}` };
}

function bwLine(score: number, requiredPct: number, rates: { comfortable: number; limit: number }): string {
  const a = Math.abs(requiredPct);
  if (a <= rates.comfortable) return "A pace that keeps strength and muscle.";
  if (a <= rates.limit) return "Doable, but no room to fall behind.";
  return score < 30 ? "Very high risk: past the safe pace for this goal." : "High risk: faster than the safe pace.";
}

/** What to do now, from the score, the band and the evidence. */
export function decideAction(x: {
  goal: GoalSpec;
  score: number;
  band: ApproachKey;
  conf: Confidence;
  anchors: Record<ApproachKey, number>;
  recommended: ApproachKey;
  weeks: number | null;
  direction: "up" | "down";
  unit: Unit;
  projection: Range | null;
  concerned?: boolean;
  meet?: boolean;
}): Recommendation {
  const w = (kg: number) => fmtWeight(kg, x.unit);
  const sugg = x.anchors[x.recommended];
  if (x.goal.status === "proposed") {
    // their own number when it's sensible, else the recommended approach
    if (x.score >= 50) return rec("approve", `Review: their target fits (${x.score}/100).${x.recommended !== x.band && x.score >= 75 && x.recommended !== "conservative" ? ` ${APPROACH_LABEL[x.recommended]} would be ${w(sugg)}.` : ""}`, null, null);
    return rec("approve", `Review: their target is a stretch (${x.score}/100). ${APPROACH_LABEL[x.recommended]} is ${w(sugg)}.`, sugg, x.recommended);
  }
  if (x.concerned) return rec("protect", `Protect: ${APPROACH_LABEL.conservative} (${w(x.anchors.conservative)}) until pain or recovery settles.`, x.anchors.conservative, "conservative");
  if (x.conf === "low") return rec("collect_data", "Low confidence: more recent training data is needed before changing anything.", null, null);
  if (x.score >= 70) {
    // comfortably under what they're on track for, with a real read: room to aim higher
    if (x.score >= 93 && x.conf === "high" && !x.meet && x.recommended !== "conservative")
      return rec("raise_target", `Room to aim higher: ${APPROACH_LABEL.moderate} is ${w(x.anchors.moderate)}.`, x.anchors.moderate, "moderate");
    return rec("maintain", "Maintain plan: current programming is working.", null, null);
  }
  if (x.score >= 50) return rec("maintain", "Maintain plan: on track if training keeps going as it is.", null, null);
  // past what their records support
  if (x.meet || (x.weeks != null && x.weeks < 6)) return rec("adjust_target", `Adjust target: ${APPROACH_LABEL[x.recommended]} (${w(sugg)}) fits what they've shown.`, sugg, x.recommended);
  if (x.score >= 25) return rec("adjust_program", "Adjust programming: the target needs faster progress than the current plan is giving.", null, null);
  return rec("adjust_target", `Adjust target: ${APPROACH_LABEL[x.recommended]} (${w(sugg)}) fits what they've shown.`, sugg, x.recommended);
}

/**
 * How the athlete's past approved targets went against what was projected when
 * they were approved (resolved goals only): the median of achieved gain over
 * projected gain, 0.5–1.5, from two outcomes or more. Null otherwise.
 */
export function calibrationFrom(outcomes: Array<{ actualKg: number | null; projectedAtApprovalKg: number | null; nowAtApprovalKg: number | null }>): number | null {
  const ratios = outcomes
    .filter((o) => o.actualKg != null && o.projectedAtApprovalKg != null && o.nowAtApprovalKg != null && (o.projectedAtApprovalKg as number) - (o.nowAtApprovalKg as number) >= 2.5)
    .map((o) => ((o.actualKg as number) - (o.nowAtApprovalKg as number)) / ((o.projectedAtApprovalKg as number) - (o.nowAtApprovalKg as number)));
  if (ratios.length < 2) return null;
  const v = [...ratios].sort((a, b) => a - b);
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return r2(clamp(m, 0.5, 1.5));
}

/**
 * Has anything a coach would act on changed between two reads? A recommendation
 * of a different kind, a score that moved 10 points, or a projection that moved
 * 2.5% (or more) of the target. Small wobbles don't re-ask.
 */
export function meaningfulChange(prev: Feasibility | null, next: Feasibility): boolean {
  if (!prev) return true;
  if (prev.action.kind !== next.action.kind) return true;
  if (prev.score != null && next.score != null && Math.abs(prev.score - next.score) >= 10) return true;
  const a = prev.projection?.expectedKg;
  const b = next.projection?.expectedKg;
  if (a != null && b != null && Math.abs(a - b) / Math.max(1, a) >= 0.025) return true;
  return false;
}

/** The outcome of a goal whose date has passed, from what was lifted or weighed. */
export function resolveOutcome(x: {
  kind: GoalRow["kind"];
  targetKg: number | null;
  actualKg: number | null;
  direction: "up" | "down";
  toleranceKg?: number;
}): "achieved" | "missed" | null {
  if (x.targetKg == null || x.actualKg == null) return null;
  const tol = x.toleranceKg ?? (x.kind === "bodyweight" ? Math.max(0.3, x.targetKg * 0.005) : 0);
  return x.direction === "up" ? (x.actualKg >= x.targetKg - tol ? "achieved" : "missed") : x.actualKg <= x.targetKg + tol ? "achieved" : "missed";
}
