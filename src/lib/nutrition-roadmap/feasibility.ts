/**
 * Is the goal realistic? Worked out before anything is planned, and said
 * plainly: the time there is, the change it takes, the weekly rate that
 * needs, the rate that keeps strength and muscle for this person and sport
 * (target.ts: slower cuts keep more lean mass and strength, Garthe et al.
 * 2011; 0.5–1%/week for contest prep, Helms et al. 2014; lean gaining by
 * training age), whether that rate can be eaten for (never under the energy
 * floor, energy.ts), and where their own trend says they'll be on the date.
 *
 * Realistic, aggressive, unlikely or unsafe. It never agrees with a goal just
 * because it was set, never claims a probability, and always offers a way
 * that works: a later date, a nearer target, the next weight class, or
 * performance first. Pure.
 */
import { GAIN_RATES, LOSS_RATES, ipfLimits, plannedClassWeight, type Level } from "@/lib/weight-management/target";
import type { Trajectory } from "@/lib/weight-management/trajectory";
import { addDays, daysBetween, fmtDay, fmtRate, fmtWeight, round, type WeightUnit } from "@/lib/weight-management/units";
import { KCAL_PER_KG } from "@/lib/nutrition-roadmap/energy";
import type { Alternative, Confidence, EnergyEstimate, Feasibility, FeasibilityVerdict, RoadmapGoal, Safety } from "@/lib/nutrition-roadmap/types";

export type Rates = { comfortable: number; limit: number };

export function ratesFor(kind: RoadmapGoal["kind"], level: Level | null, losing: boolean): Rates {
  switch (kind) {
    case "weight_class":
      return LOSS_RATES.powerlifting_class;
    case "contest_prep":
      return LOSS_RATES.bodybuilding;
    case "recomp":
      return LOSS_RATES.recomp;
    case "muscle_gain":
      return GAIN_RATES[level ?? "intermediate"];
    case "maintain":
      return { comfortable: 0.25, limit: 0.5 };
    default:
      return losing ? LOSS_RATES.fat_loss : GAIN_RATES[level ?? "intermediate"];
  }
}

/**
 * The days before the meet that are fueled, not dieted: the strength peak
 * and meet week at maintenance. Two weeks of peak and the meet week with
 * time for it, less when the meet is close.
 */
export function fueledDaysBeforeEvent(daysToEvent: number, kind: RoadmapGoal["kind"]): number {
  if (kind === "contest_prep") return daysToEvent >= 28 ? 7 : 0; // show week holds the targets
  if (kind !== "weight_class") return 0;
  if (daysToEvent >= 70) return 21;
  if (daysToEvent >= 35) return 14;
  if (daysToEvent >= 7) return 7;
  return 0;
}

export type FeasibilityInput = {
  today: string;
  unit: WeightUnit;
  goal: RoadmapGoal | null;
  currentKg: number | null;
  level: Level | null;
  sex: "M" | "F" | null;
  age: number | null;
  energy: EnergyEstimate;
  trajectory: Trajectory;
  safety: Safety;
};

const words = (kg: number, unit: WeightUnit) => fmtWeight(Math.abs(kg), unit);
/** "0.4 kg a week", no sign. */
export const perWeek = (kgPerWeek: number, unit: WeightUnit) => fmtRate(kgPerWeek, unit).replace(/^[+−]/, "");
const pctOf = (kg: number, of: number) => round((kg / of) * 100, 2);

export type FeasibilityPlan = Feasibility & { plannedKgPerWeek: number; maxKgPerWeek: number; makeBy: string | null };

export function assessFeasibility(x: FeasibilityInput): FeasibilityPlan {
  const f = judge(x);
  // a weigh-in from weeks ago says nothing about today: the plan is drawn from it, but nothing is judged on it
  const last = x.trajectory.latest;
  if (!x.trajectory.stale || !last || !x.goal || x.goal.kg == null || f.verdict === "no_goal" || f.verdict === "unsafe") return f;
  const weeksOut = x.goal.date ? daysBetween(x.today, x.goal.date) / 7 : null;
  const headline =
    weeksOut != null && weeksOut <= 4 && x.goal.eventName
      ? `${x.goal.eventName} in ${Math.max(0, Math.round(weeksOut))} ${Math.round(weeksOut) === 1 ? "week" : "weeks"}: no weigh-ins since ${fmtDay(last.date, x.today)}`
      : `No weigh-ins since ${fmtDay(last.date, x.today)}: the plan can't be judged until there are new ones`;
  return {
    ...f,
    verdict: "needs_weigh_ins",
    headline,
    confidence: "low",
    reasons: [`The last weigh-in was ${fmtWeight(last.kg, x.unit)} on ${fmtDay(last.date, x.today)}. The roadmap is drawn from it until a week of morning weigh-ins says where they are now.`, ...f.reasons],
  };
}

function judge(x: FeasibilityInput): FeasibilityPlan {
  const g = x.goal;
  const u = x.unit;
  const cur = x.currentKg;
  const losing = !!g && g.kg != null && cur != null && g.kg < cur;
  const rates = ratesFor(g?.kind ?? "maintain", x.level, losing);
  const comfortable = x.safety.conservative ? Math.min(rates.comfortable, rates.limit) : rates.comfortable;
  const limit = x.safety.conservative ? rates.comfortable : rates.limit;
  const kgPerWeekAt = (pct: number) => (cur ? (pct / 100) * cur : 0);
  const sustainable = { comfortablePct: comfortable, limitPct: limit, kgPerWeek: round(kgPerWeekAt(comfortable), 2) };
  // the fastest that's planned for them: the rate limit, and for a loss the energy floor
  const maxKgPerWeek = round(Math.max(0, Math.min(kgPerWeekAt(limit), losing ? ((x.energy.kcal - x.energy.floorKcal) * 7) / KCAL_PER_KG : Infinity)), 3);
  const conf = confidenceOf(x.trajectory, x.energy);
  const base = { sustainable, confidence: conf.level, confidenceWhy: conf.why, tradeoffs: [] as string[], reasons: [] as string[], alternatives: [] as Alternative[] };

  if (!g || g.kg == null || cur == null) {
    const headline = !g ? "No goal set yet" : cur == null ? "Needs weigh-ins to plan from" : g.kind === "maintain" ? "Holding bodyweight" : `${g.label}: no target weight yet`;
    return { ...base, verdict: g?.kind === "maintain" && cur != null ? "realistic" : "no_goal", headline, weeksAvailable: null, changeKg: null, required: null, expected: null, plannedKgPerWeek: 0, maxKgPerWeek, makeBy: null };
  }

  const changeKg = round(g.kg - cur, 2);
  const daysToDate = g.date ? daysBetween(x.today, g.date) : null;
  const fueled = daysToDate != null ? fueledDaysBeforeEvent(daysToDate, g.kind) : 0;
  const makeBy = g.date ? addDays(g.date, -fueled) : null;
  const weeks = makeBy ? Math.max(0, daysBetween(x.today, makeBy) / 7) : null;
  const met = g.direction === "at_most" ? changeKg >= 0 : g.direction === "at_least" ? changeKg <= 0 : Math.abs(changeKg) <= Math.max(0.3, cur * 0.01);

  if (met) {
    const headline = g.kind === "weight_class" ? `Already at or under the planned weight for the ${g.weightClass ?? ""} class: hold it there and fuel for training`.replace("the  class", "the class") : `At the goal: hold it`;
    return { ...base, verdict: "reached", headline, weeksAvailable: weeks != null ? round(weeks, 1) : null, changeKg, required: { kgPerWeek: 0, pctPerWeek: 0 }, expected: null, plannedKgPerWeek: 0, maxKgPerWeek, makeBy };
  }

  // safety first: some goals aren't planned by the app at all
  if (losing && x.safety.noDeficit) {
    return {
      ...base,
      verdict: "unsafe",
      headline: "Weight loss isn't planned for them right now",
      weeksAvailable: weeks != null ? round(weeks, 1) : null,
      changeKg,
      required: null,
      expected: null,
      reasons: [x.safety.referral ?? "A health flag means a qualified professional plans any weight change."],
      tradeoffs: [],
      alternatives: [{ kind: "performance", label: "Fuel for training and health", detail: "Eat around maintenance with enough protein and carbohydrate, and plan any change with a professional." }],
      plannedKgPerWeek: 0,
      maxKgPerWeek: 0,
      makeBy,
    };
  }

  if (weeks == null || weeks <= 0) {
    const plannedKgPerWeek = round((changeKg > 0 ? 1 : -1) * kgPerWeekAt(comfortable * 0.85), 3);
    const headline =
      weeks == null
        ? `No date set: ${words(changeKg, u)} to ${changeKg < 0 ? "lose" : "gain"} at about ${perWeek(plannedKgPerWeek, u)}, a pace that keeps training going well`
        : "The date has passed: set a new one";
    return { ...base, verdict: "no_deadline", headline, weeksAvailable: weeks == null ? null : 0, changeKg, required: null, expected: null, plannedKgPerWeek, maxKgPerWeek, makeBy };
  }

  const reqKg = changeKg / weeks;
  const reqPct = pctOf(reqKg, cur);
  const a = Math.abs(reqPct);
  let verdict: FeasibilityVerdict = a <= comfortable ? "realistic" : a <= limit ? "aggressive" : a <= limit * 1.6 ? "unlikely" : "unsafe";
  const reasons: string[] = [];
  const tradeoffs: string[] = [];

  // can it be eaten for? a deficit is never planned past the energy floor
  if (losing) {
    const room = Math.max(0, x.energy.kcal - x.energy.floorKcal);
    const need = (Math.abs(reqKg) * KCAL_PER_KG) / 7;
    if (need > room * 1.5 && verdict !== "unsafe") verdict = "unsafe";
    else if (need > room && (verdict === "realistic" || verdict === "aggressive")) verdict = "unlikely";
    if (need > room) reasons.push(`It takes a deficit of about ${Math.round(need / 25) * 25} kcal a day; their estimated maintenance (${x.energy.kcal} kcal) leaves room for about ${Math.round(room / 25) * 25} without eating under their resting energy.`);
  }

  // the rate the roadmap plans: what's needed, never past the limit or the floor
  const roomKg = losing ? ((x.energy.kcal - x.energy.floorKcal) * 7) / KCAL_PER_KG : Infinity;
  const plannedAbs = Math.min(Math.abs(reqKg), kgPerWeekAt(limit), roomKg);
  const plannedKgPerWeek = round(Math.sign(reqKg) * Math.max(plannedAbs, 0), 3);

  // where they'd be: their own trend first, else the plan followed
  const t = x.trajectory;
  let expected: Feasibility["expected"] = null;
  if (t.projected && t.trend && g.date && t.projected.date === g.date) expected = { lowKg: t.projected.lowKg, highKg: t.projected.highKg, basis: "trend" };
  else {
    const mid = cur + plannedKgPerWeek * weeks;
    const half = Math.max(cur * 0.005, Math.abs(plannedKgPerWeek * weeks) * 0.3);
    expected = { lowKg: round(mid - half, 1), highKg: round(mid + half, 1), basis: "plan" };
  }

  const pace = `${perWeek(reqKg, u)} (${round(a, 2)}% of bodyweight) for ${round(weeks, 1)} weeks`;
  if (verdict === "realistic") reasons.unshift(`It needs ${pace}, inside the ${comfortable}%/week that keeps ${losing ? "strength and muscle" : "the gain mostly muscle"}.`);
  else if (verdict === "aggressive") reasons.unshift(`It needs ${pace}: past the comfortable ${comfortable}%/week but under the ${limit}%/week limit.`);
  else reasons.unshift(`It needs ${pace}, past the ${limit}%/week ${losing ? "that protects strength, muscle and recovery" : "that keeps a gain mostly muscle"}.`);
  if (x.safety.conservative && rates.limit > limit) reasons.push("A health note on file keeps the plan at the comfortable rate.");

  // their trajectory against the goal, when it says something the rate doesn't
  if (expected.basis === "trend" && g.date) {
    const miss = g.direction === "at_most" ? expected.lowKg > g.kg : g.direction === "at_least" ? expected.highKg < g.kg : false;
    if (miss) reasons.push(`Their current trajectory projects ${fmtWeight(expected.lowKg, u)}–${fmtWeight(expected.highKg, u)} by ${fmtDay(g.date, x.today)}. Reaching ${fmtWeight(g.kg, u)} needs a faster ${losing ? "loss" : "gain"} than their recent progress supports.`);
  }

  // what it costs
  if (losing && verdict !== "realistic") {
    if (g.kind === "weight_class") tradeoffs.push("Expect heavy singles to feel harder in the last weeks of the cut, and less room for training volume.");
    else if (g.kind === "contest_prep") tradeoffs.push("Hunger and diet fatigue climb as they get leaner; training volume tolerance drops near the end.");
    else tradeoffs.push("More hunger, flatter sessions and slower recovery; strength may dip.");
  }
  if (!losing && verdict !== "realistic") tradeoffs.push("A faster gain puts on more fat for the same muscle.");
  if (g.kind === "weight_class" && losing) tradeoffs.push("The lowest class isn't always the best total: a cut that costs strength can lose more kilos on the bar than it gains in the class.");

  // ways that work
  const alternatives: Alternative[] = [];
  if (verdict !== "realistic") {
    const comfKg = kgPerWeekAt(comfortable);
    if (comfKg > 0) {
      const needWeeks = Math.abs(changeKg) / comfKg;
      if (g.source !== "meet") {
        const date = addDays(x.today, Math.ceil(needWeeks * 7) + fueled);
        alternatives.push({ kind: "extend", label: `Move the date to ${fmtDay(date, x.today)}`, detail: `${Math.ceil(needWeeks)} weeks at a comfortable ${perWeek(comfKg, u)}.`, date });
      }
      const reachable = round(cur + Math.sign(changeKg) * comfKg * weeks, 1);
      alternatives.push({ kind: "revise_target", label: `Aim for ${fmtWeight(reachable, u)} by ${fmtDay(makeBy ?? g.date!, x.today)}`, detail: "What a comfortable rate reaches in the time there is.", kg: reachable });
    }
    if (g.kind === "weight_class" && x.sex && g.limitKg != null) {
      const next = ipfLimits(x.sex, x.age).find((l) => l > g.limitKg! + 0.5);
      if (next) {
        const planned = plannedClassWeight(next).kg;
        const altPct = planned >= cur ? 0 : round(Math.abs(((planned - cur) / weeks / cur) * 100), 2);
        alternatives.push({ kind: "weight_class", label: `The ${next} kg class`, detail: altPct === 0 ? "Needs no cut at all: train and eat for the total." : `Needs ${altPct}% of bodyweight a week.`, kg: planned });
        if (altPct === 0) alternatives.push({ kind: "performance", label: "Put the total first", detail: `Compete in the ${next} kg class, fuel every session, and decide on the lighter class for a later meet with more time.` });
      }
    }
  }

  const headlineFor: Record<FeasibilityVerdict, string> = {
    realistic: `Realistic: ${perWeek(reqKg, u)} to ${fmtWeight(g.kg, u)}`,
    aggressive: `Aggressive but doable: ${perWeek(reqKg, u)}, no room to fall behind`,
    unlikely: `Unlikely as set: it needs ${perWeek(reqKg, u)}`,
    unsafe: `Not safe as set: it needs ${perWeek(reqKg, u)}`,
    no_deadline: "",
    reached: "",
    no_goal: "",
    needs_weigh_ins: "",
  };

  return {
    ...base,
    verdict,
    headline: headlineFor[verdict],
    weeksAvailable: round(weeks, 1),
    changeKg,
    required: { kgPerWeek: round(reqKg, 3), pctPerWeek: reqPct },
    expected,
    reasons,
    tradeoffs,
    alternatives,
    plannedKgPerWeek,
    maxKgPerWeek,
    makeBy,
  };
}

/** How much the data behind this can be trusted, in words; never a percentage. */
export function confidenceOf(t: Trajectory, e: EnergyEstimate): { level: Confidence; why: string } {
  const tr = t.trend;
  if (tr && tr.clear && tr.weighIns >= 12 && tr.spanDays >= 21 && e.confidence !== "low")
    return { level: "high", why: `${tr.weighIns} weigh-ins over ${tr.spanDays} days with a clear trend, and maintenance read from their own results.` };
  if ((tr && tr.weighIns >= 8) || e.confidence !== "low")
    return { level: "moderate", why: tr ? `${tr.weighIns} weigh-ins over ${tr.spanDays} days${tr.clear ? "" : ", within normal day-to-day scatter"}.` : "Maintenance read from their results; weigh-ins still thin." };
  return { level: "low", why: tr ? `Only ${tr.weighIns} weigh-ins so far.` : "Not enough weigh-ins yet: the first 2–3 weeks of data set the real numbers." };
}
