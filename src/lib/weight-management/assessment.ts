/**
 * The whole weight-management read for one client, from what's on file: the
 * goal (a meet's weight class first, else the bodyweight goal the coach set),
 * the trajectory, whether the target is realistic, the weekly check-ins
 * (sticking to the plan, hunger, recovery, digestion), the cardio plan and
 * what a treadmill prescription for them looks like, water, the waist tape,
 * strength on the lower lifts, and one recommendation. Deterministic: the
 * same records give the same answer, every number is worked out here, and the
 * AIs that write plans or check-in replies read it as text (assessmentText)
 * instead of guessing. Pure, tested.
 */
import { readDigestion, type CheckinRow, type DigestionRead } from "@/lib/weight-management/digestion";
import { decide, LIMITING_WORDS, type Recommendation } from "@/lib/weight-management/decision";
import { hydrationTarget, type Climate, type HydrationTarget, type SweatLevel } from "@/lib/weight-management/hydration";
import { assessTarget, classLimitKg, plannedClassWeight, weighInTiming, type GoalContext, type Level, type PastPhase, type Sex, type TargetAssessment, type WeighIn as WeighInTiming } from "@/lib/weight-management/target";
import { buildTrajectory, recentTrend, type GoalKind, type Trajectory, type WeighIn } from "@/lib/weight-management/trajectory";
import {
  plannedModality,
  prescribeTreadmill,
  sessionLine,
  sessionsFromExisting,
  type CardioGoal,
  type ExistingCardio,
  type TreadmillPlan,
  type TreadmillSession,
} from "@/lib/weight-management/treadmill";
import { addDays, daysBetween, fmtDay, fmtPct, fmtRate, fmtWeight, round, type SpeedUnit, type WeightUnit } from "@/lib/weight-management/units";

export const ASSESSMENT_VERSION = 1;

export type GoalType = "lose" | "gain" | "maintain" | "performance_cut" | "custom";

export type AssessmentInput = {
  today: string;
  unit: WeightUnit;
  speedUnit: SpeedUnit;
  sex: Sex | null;
  age: number | null;
  heightCm: number | null;
  level: Level | null;
  weighIns: WeighIn[];
  /** clients.bodyweight_goal_*, in kg. */
  goal: { type: GoalType | null; kg: number | null; kgMax: number | null; date: string | null } | null;
  /** The next meet or show (pl_preps), within the planning horizon. */
  meet: { name: string | null; date: string; weightClass: string | null; federation: string | null; sport: "powerlifting" | "bodybuilding" | "other" } | null;
  powerlifter: boolean;
  plan: { start: string | null; weeklyKcal: number | null; phase: string | null; starts: string[] };
  /** Weekly check-ins, any order: their date (submitted) and answers. */
  checkins: CheckinRow[];
  cardio: { targets: ExistingCardio[]; lastChanged: string | null; history: { speedMph: number | null; inclinePct: number | null; avgRpe: number | null; sessions: number } | null; done: number | null; planned: number | null };
  trainingDays: string[];
  heavyLowerDays: string[];
  sessionMinutes: number | null;
  dailySteps: number | null;
  water: { avgMl: number | null; targetMl: number | null; daysLogged: number };
  waist: Array<{ date: string; cm: number }>;
  performance: { lower: "up" | "steady" | "down" | null; detail: string | null };
  health: { walkingLimits: string[]; fluidRestriction: boolean };
  profile: { climate: Climate | null; sweat: SweatLevel | null; maxIncline: number | null; availableMinutes: number | null };
  pastPhases: PastPhase[];
};

export type Goal = {
  kg: number;
  date: string | null;
  kind: GoalKind;
  source: "meet" | "goal";
  label: string;
  eventName: string | null;
  weightClass: string | null;
  limitKg: number | null;
  bufferKg: number | null;
};

export type CheckinRead = {
  count: number;
  latest: string | null;
  /** Nutrition consistency 1–5, average of the last 3. */
  adherence: number | null;
  poorSleep: number;
  lowEnergy: number;
  stress: number;
  hungerHigh: boolean;
  cardioIssues: string[];
  waterIssues: string[];
};

export type Assessment = {
  version: number;
  today: string;
  unit: WeightUnit;
  speedUnit: SpeedUnit;
  context: GoalContext;
  direction: "lose" | "gain" | "maintain";
  goal: Goal | null;
  weighInTiming: WeighInTiming | null;
  meetWeeksOut: number | null;
  trajectory: Trajectory;
  target: TargetAssessment | null;
  checkins: CheckinRead;
  digestion: DigestionRead;
  hydration: HydrationTarget;
  cardio: {
    modality: "treadmill" | "other";
    /** The coach's own non-treadmill type, kept as it is. */
    keep: string | null;
    current: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null };
    /** What a treadmill plan for them looks like from scratch. */
    suggested: TreadmillPlan;
    adherence: { done: number; planned: number } | null;
  };
  waist: { changeCm: number; weeks: number; from: string; to: string } | null;
  performance: AssessmentInput["performance"];
  recommendation: Recommendation;
  hash: string;
};

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

/** The last 3 weekly check-ins, read for the decision. */
export function readCheckins(rows: CheckinRow[]): CheckinRead {
  const sorted = rows.filter((r) => r.date).slice().sort((a, b) => b.date.localeCompare(a.date));
  const last3 = sorted.slice(0, 3);
  const ratings = last3.map((r) => num(r.answers?.nutrition_rating)).filter((n): n is number => n != null && n >= 1 && n <= 5);
  const flags = last3.map((r) => arr(r.answers?.recovery_flags));
  const count = (f: string) => flags.filter((fl) => fl.includes(f)).length;
  const latest = sorted[0] ?? null;
  const hungerLatest = num(latest?.answers?.hunger_level);
  return {
    count: sorted.length,
    latest: latest?.date.slice(0, 10) ?? null,
    adherence: ratings.length ? round(ratings.reduce((a, b) => a + b, 0) / ratings.length, 1) : null,
    poorSleep: count("Sleep"),
    lowEnergy: count("Energy"),
    stress: count("Stress"),
    hungerHigh: (hungerLatest != null && hungerLatest >= 4) || count("Hunger / appetite") >= 2,
    cardioIssues: arr(latest?.answers?.cardio_issue),
    waterIssues: arr(latest?.answers?.water_issue),
  };
}

/** Waist change over the last 6 weeks: the first and last tape 3+ weeks apart. */
export function waistChange(points: Array<{ date: string; cm: number }>, today: string): Assessment["waist"] {
  const pts = points.filter((p) => p.date && p.cm > 30 && p.cm < 250 && p.date >= addDays(today, -42) && p.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const days = daysBetween(a.date, b.date);
  if (days < 21) return null;
  return { changeCm: round(b.cm - a.cm, 1), weeks: round(days / 7, 1), from: a.date, to: b.date };
}

const CARDIO_GOAL: Record<GoalContext, CardioGoal> = {
  powerlifting_class: "fat_loss",
  weight_class_sport: "fat_loss",
  bodybuilding: "contest",
  fat_loss: "fat_loss",
  recomp: "recomp",
  maintain: "maintain",
  gain: "gain",
  event: "fat_loss",
};

/** "83" → "83 kg", "-83kg" → "83 kg", "181 lb" stays. */
export function classLabel(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (/^[-–]?\d+(\.\d+)?\s*(kg)?$/i.test(t)) return `${t.replace(/^[-–]/, "").replace(/\s*kg$/i, "")} kg`;
  return t;
}

/** Which goal counts: a meet's weight class within 26 weeks, else a show, else their bodyweight goal. */
export function resolveGoal(x: Pick<AssessmentInput, "goal" | "meet" | "today" | "plan" | "powerlifter">, noiseKg: number | null): { goal: Goal | null; context: GoalContext } {
  const m = x.meet;
  if (m && m.date >= x.today && daysBetween(x.today, m.date) <= 26 * 7) {
    const limit = classLimitKg(m.weightClass);
    if (limit != null && m.sport !== "bodybuilding") {
      const planned = plannedClassWeight(limit, noiseKg);
      return {
        context: m.sport === "powerlifting" || x.powerlifter ? "powerlifting_class" : "weight_class_sport",
        goal: { kg: planned.kg, date: m.date, kind: "at_most", source: "meet", label: `${classLabel(m.weightClass)} class at ${m.name ?? "the meet"}`, eventName: m.name, weightClass: m.weightClass, limitKg: limit, bufferKg: planned.bufferKg },
      };
    }
    if (m.sport === "bodybuilding" && x.goal?.kg) {
      return { context: "bodybuilding", goal: { kg: x.goal.kg, date: m.date, kind: "at_most", source: "meet", label: `Stage weight for ${m.name ?? "the show"}`, eventName: m.name, weightClass: null, limitKg: null, bufferKg: null } };
    }
  }
  const g = x.goal;
  if (!g?.type || g.kg == null) return { goal: null, context: x.plan.phase === "Muscle Gain" ? "gain" : x.plan.phase === "Fat Loss" ? "fat_loss" : x.plan.phase === "Recomp" ? "recomp" : "maintain" };
  const mid = g.kgMax != null && g.kgMax > g.kg ? (g.kg + g.kgMax) / 2 : g.kg;
  const base = { date: g.date, source: "goal" as const, eventName: null, weightClass: null, limitKg: null, bufferKg: null };
  switch (g.type) {
    case "lose":
      return { context: x.plan.phase === "Recomp" ? "recomp" : "fat_loss", goal: { ...base, kg: g.kg, kind: "at_most", label: "Bodyweight goal" } };
    case "gain":
      return { context: "gain", goal: { ...base, kg: g.kg, kind: "at_least", label: "Bodyweight goal" } };
    case "maintain":
      return { context: "maintain", goal: { ...base, kg: round(mid, 2), kind: "around", label: "Hold bodyweight" } };
    case "performance_cut":
      return { context: x.powerlifter ? "powerlifting_class" : "weight_class_sport", goal: { ...base, kg: g.kg, kind: "at_most", label: "Weight to make" } };
    default:
      return { context: "event", goal: { ...base, kg: round(mid, 2), kind: "around", label: "Bodyweight goal" } };
  }
}

/** FNV-1a: a short stable hash of what the coach would see change. */
export function hashOf(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function buildAssessment(x: AssessmentInput): Assessment {
  const pre = recentTrend(x.weighIns);
  const { goal, context } = resolveGoal(x, pre?.noiseKg ?? null);
  // a plan's first week moves water and glycogen: leave it out, but only once 3+ weeks of the plan are left to read
  const trendSince = x.plan.start && daysBetween(addDays(x.plan.start, 7), x.today) >= 21 ? addDays(x.plan.start, 7) : null;
  const trajectory = buildTrajectory({ weighIns: x.weighIns, today: x.today, goal: goal ? { kg: goal.kg, date: goal.date, kind: goal.kind } : null, trendSince });
  const currentKg = trajectory.current?.kg ?? null;
  const direction: Assessment["direction"] =
    context === "gain" ? "gain" : context === "maintain" ? "maintain" : goal && currentKg != null && goal.kind === "around" ? (Math.abs(goal.kg - currentKg) < 0.5 ? "maintain" : goal.kg > currentKg ? "gain" : "lose") : "lose";
  const meetWeeksOut = x.meet && x.meet.date >= x.today ? round(daysBetween(x.today, x.meet.date) / 7, 1) : null;
  const target =
    goal && currentKg != null
      ? assessTarget({ context, currentKg, targetKg: goal.kg, weeks: goal.date ? daysBetween(x.today, goal.date) / 7 : null, sex: x.sex, age: x.age, level: x.level, unit: x.unit, classLimitKg: goal.limitKg, past: x.pastPhases })
      : null;
  const checkins = readCheckins(x.checkins);
  const digestion = readDigestion(x.checkins, x.plan.starts, x.water);
  const live = x.cardio.targets.filter((t) => (t.duration_minutes ?? 0) > 0);
  const modality = plannedModality(live);
  const current = sessionsFromExisting(live);
  const suggested = prescribeTreadmill({
    goal: direction === "gain" ? "gain" : CARDIO_GOAL[context],
    bodyweightKg: currentKg,
    heightCm: x.heightCm,
    age: x.age,
    level: x.level,
    unit: x.speedUnit,
    trainingDays: x.trainingDays,
    heavyLowerDays: x.heavyLowerDays,
    powerlifter: x.powerlifter,
    meetWeeksOut,
    jointLimits: x.health.walkingLimits,
    history: x.cardio.history,
    dailySteps: x.dailySteps,
    availableMinutes: x.profile.availableMinutes,
    maxIncline: x.profile.maxIncline,
  });
  const hydration = hydrationTarget({
    bodyweightKg: currentKg,
    trainingMinutes: x.sessionMinutes,
    trainingDayCardioMinutes: current.trainingDay?.minutes ?? null,
    restDayCardioMinutes: current.restDay?.minutes ?? null,
    climate: x.profile.climate,
    sweat: x.profile.sweat,
    fluidRestriction: x.health.fluidRestriction,
    recentAvgMl: x.water.daysLogged >= 4 ? x.water.avgMl : null,
  });
  const waist = waistChange(x.waist, x.today);
  const recommendation = decide({
    today: x.today,
    unit: x.unit,
    direction,
    context,
    level: x.level,
    trajectory,
    target,
    plan: { start: x.plan.start, weeklyKcal: x.plan.weeklyKcal },
    kcalFloor: x.sex === "F" ? 1200 : 1500,
    adherence: { avg: checkins.adherence, checkins: Math.min(3, checkins.count) },
    recovery: { poorSleep: checkins.poorSleep, lowEnergy: checkins.lowEnergy, stress: checkins.stress, hungerHigh: checkins.hungerHigh, of: Math.min(3, checkins.count) },
    performance: x.performance,
    cardio: { plan: current.trainingDay || current.restDay ? current : { trainingDay: null, restDay: null }, treadmill: modality.modality === "treadmill", lastChanged: x.cardio.lastChanged, issues: checkins.cardioIssues },
    digestion,
    waist: waist ? { changeCm: waist.changeCm, weeks: waist.weeks } : null,
    meetWeeksOut,
    powerlifter: x.powerlifter,
    stepCtx: {
      bodyweightKg: currentKg,
      trainingDays: x.trainingDays,
      heavyLowerDays: x.heavyLowerDays,
      powerlifter: x.powerlifter,
      meetWeeksOut,
      jointLimits: x.health.walkingLimits,
      maxIncline: x.profile.maxIncline,
      availableMinutes: x.profile.availableMinutes,
      unit: x.speedUnit,
    },
  });
  const hash = hashOf([
    ASSESSMENT_VERSION,
    recommendation.verdict,
    recommendation.headline,
    recommendation.actions.map((a) => (a.kind === "nutrition" ? ["n", a.kcalPerDay] : a.kind === "cardio" ? ["c", a.step.variable, a.step.to] : [a.kind])),
    trajectory.latest?.date ?? null,
    trajectory.trend ? round(trajectory.trend.kgPerWeek, 2) : null,
    goal ? [round(goal.kg, 1), goal.date] : null,
    checkins.latest,
  ]);
  return {
    version: ASSESSMENT_VERSION,
    today: x.today,
    unit: x.unit,
    speedUnit: x.speedUnit,
    context,
    direction,
    goal,
    weighInTiming: x.meet ? weighInTiming(x.meet.federation) : null,
    meetWeeksOut,
    trajectory,
    target,
    checkins,
    digestion,
    hydration,
    cardio: {
      modality: modality.modality,
      keep: modality.keep,
      current,
      suggested,
      adherence: x.cardio.done != null && x.cardio.planned ? { done: x.cardio.done, planned: x.cardio.planned } : null,
    },
    waist,
    performance: x.performance,
    recommendation,
    hash,
  };
}

export const CONTEXT_LABEL: Record<GoalContext, string> = {
  powerlifting_class: "Making a weight class",
  weight_class_sport: "Making weight",
  bodybuilding: "Contest prep",
  fat_loss: "Fat loss",
  recomp: "Recomposition",
  maintain: "Maintenance",
  gain: "Controlled gain",
  event: "Event bodyweight",
};

/**
 * The read as the nutrition AI and the check-in recap see it: every number
 * already worked out, so they reason from it instead of estimating.
 */
export function assessmentText(a: Assessment): string {
  const u = a.unit;
  const w = (kg: number) => fmtWeight(kg, u);
  const t = a.trajectory;
  const L: string[] = ["WEIGHT MANAGEMENT (computed from their records in the app; never recompute or contradict these numbers)"];
  L.push(`Goal: ${CONTEXT_LABEL[a.context]}${a.goal ? ` — ${a.goal.label}: ${w(a.goal.kg)}${a.goal.limitKg != null ? ` (class limit ${w(a.goal.limitKg)} less a ${w(a.goal.bufferKg ?? 0)} buffer, in a normal fed and hydrated state)` : ""}${a.goal.date ? ` by ${fmtDay(a.goal.date)}` : ""}` : " (no target on file)"}`);
  if (a.weighInTiming?.hours) L.push(`Weigh-in: about ${a.weighInTiming.hours} hours before lifting (${a.weighInTiming.federation}). Plan to the target in a normal state; any acute strategy is the coach's call, never the plan's.`);
  if (t.current) L.push(`Now: ${w(t.current.kg)} (${t.current.from === "trend" ? "trend line" : t.current.from === "average" ? "7-day average" : "last weigh-in"}${t.latest ? `, last weigh-in ${w(t.latest.kg)} on ${fmtDay(t.latest.date)}` : ""})`);
  if (t.trend) L.push(`Trend: ${fmtRate(t.trend.kgPerWeek, u)} (${fmtPct(t.trend.pctPerWeek)}/week) from ${t.trend.weighIns} weigh-ins over ${t.trend.spanDays} days; ${t.trend.clear ? "a clear trend" : `within normal scatter (±${w(t.trend.noiseKg)}), so treat it as flat`}`);
  else L.push("Trend: not enough weigh-ins (needs 4+ over 10+ days)");
  if (t.required) L.push(`Needed: ${fmtRate(t.required.kgPerWeek, u)} (${fmtPct(t.required.pctPerWeek)}/week) for ${t.required.weeksLeft} weeks`);
  if (t.projected) L.push(`Projected at the date: ${w(t.projected.kg)} (likely ${w(t.projected.lowKg)}–${w(t.projected.highKg)}, ${t.projected.confidence} confidence)`);
  L.push(`Status: ${t.status.replace(/_/g, " ")}`);
  if (t.fluctuation) L.push(`Latest weigh-in is ${w(Math.abs(t.fluctuation.deltaKg))} ${t.fluctuation.direction} the trend: water, glycogen, sodium or gut content, not tissue`);
  if (a.target) L.push(`Realism: ${a.target.message}${a.target.history ? ` ${a.target.history}` : ""}`);
  const c = a.checkins;
  L.push(`Check-ins: ${c.count ? `${c.adherence != null ? `nutrition ${c.adherence}/5` : "no nutrition rating"}; flagged in the last 3: sleep ${c.poorSleep}, energy ${c.lowEnergy}, stress ${c.stress}${c.hungerHigh ? "; hunger high" : ""}${c.cardioIssues.length ? `; cardio: ${c.cardioIssues.join(", ")}` : ""}${c.waterIssues.length ? `; water: ${c.waterIssues.join(", ")}` : ""}` : "none yet"}`);
  if (a.digestion.summary) L.push(`Digestion: ${a.digestion.summary}${a.digestion.medical ? `. ${a.digestion.medical}` : ""}`);
  if (a.waist) L.push(`Waist: ${a.waist.changeCm > 0 ? "+" : ""}${a.waist.changeCm} cm over ${a.waist.weeks} weeks`);
  if (a.performance.detail) L.push(`Lower lifts: ${a.performance.detail}`);
  const cur = a.cardio.current;
  const line = (s: TreadmillSession | null) => (s ? sessionLine(s, a.speedUnit, a.cardio.modality === "treadmill") : "none");
  L.push(`Cardio now: ${a.cardio.keep ? `${a.cardio.keep} (the coach's choice: keep the type)` : "treadmill"} — training days ${line(cur.trainingDay)}; days off ${line(cur.restDay)}${cur.restDay?.weekdays.length ? ` on ${cur.restDay.weekdays.join(", ")}` : ""}${a.cardio.adherence ? `; done ${a.cardio.adherence.done} of ${a.cardio.adherence.planned} planned in 4 weeks` : ""}`);
  if (!cur.trainingDay && !cur.restDay) {
    const s = a.cardio.suggested;
    L.push(`Treadmill if cardio is added: training days ${line(s.trainingDay)}; days off ${line(s.restDay)}. New cardio is a treadmill walk unless the coach says otherwise.`);
  }
  const h = a.hydration;
  L.push(h.restricted ? "Water: a medical fluid limit is on file; their doctor sets it." : `Water: ${round((h.restMl ?? 0) / 1000, 1)} L plain water on days off, ${round((h.trainingMl ?? 0) / 1000, 1)} L on training days${h.electrolytes ? "; sodium on long or sweaty training days" : ""}. Never dehydration, water loading or sodium manipulation to change the scale.`);
  const r = a.recommendation;
  L.push(`Is this client progressing while keeping muscle, strength and recovery? ${LIMITING_WORDS[r.limiting]}.`);
  L.push(`Recommendation (${r.evidence} evidence): ${r.headline}. ${r.reasons.slice(-2).join(" ")}`.trim());
  for (const act of r.actions) {
    if (act.kind === "nutrition") L.push(`- nutrition: ${act.instruction}`);
    else if (act.kind === "cardio") L.push(`- cardio: ${act.step.why}`);
    else if (act.kind === "digestion") L.push(`- digestion: ${act.suggestions.join("; ")}`);
    else L.push(`- ${act.kind}: ${act.text}`);
  }
  return L.join("\n");
}
