/**
 * One recommendation from everything at once: the bodyweight trend against
 * what the goal needs, how well they're sticking to the plan, digestion,
 * strength on the lower lifts, recovery, the cardio plan and the meet. The
 * order of the rules is the coaching: safety first, then "is there enough
 * data", then the reasons a scale number lies (a new plan settling, a gut
 * that's backed up, inconsistent eating) before anything touches calories or
 * cardio, and only then the smallest change that closes the gap. Holding the
 * plan is a real answer, and the most common one. Every change it proposes is
 * material: the coach approves it first. Pure, tested.
 */
import type { DigestionRead } from "@/lib/weight-management/digestion";
import { LOSS_RATES, GAIN_RATES, type GoalContext, type Level, type TargetAssessment } from "@/lib/weight-management/target";
import type { Trajectory } from "@/lib/weight-management/trajectory";
import { stepTreadmill, type CardioStep, type StepContext, type TreadmillSession } from "@/lib/weight-management/treadmill";
import { daysBetween, fmtPct, fmtRate, fmtWeight, round, type WeightUnit } from "@/lib/weight-management/units";

export const KCAL_PER_KG = 7700;
/** A new plan's first two weeks move water and glycogen, not tissue. */
export const SETTLE_DAYS = 14;
/** Smaller than this a day isn't worth a change. */
export const MIN_CHANGE_KCAL = 75;
export const MAX_STEP_KCAL = 250;
/** A cardio change this recent is the first suspect when the lower lifts drop. */
export const CARDIO_RECENT_DAYS = 21;

export type Verdict = "maintain" | "adjust" | "reduce_load" | "investigate" | "reconsider_target" | "need_data";
export type Evidence = "strong" | "moderate" | "weak";

export type Action =
  | { kind: "nutrition"; kcalPerDay: number; from: "carbs" | "fats" | "carbs_and_fats"; instruction: string }
  | { kind: "cardio"; direction: "up" | "down"; step: CardioStep; plan: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null } }
  | { kind: "digestion"; suggestions: string[] }
  | { kind: "medical"; text: string }
  | { kind: "target"; text: string }
  | { kind: "ask"; text: string };

export type Recommendation = {
  verdict: Verdict;
  headline: string;
  reasons: string[];
  evidence: Evidence;
  actions: Action[];
  /** What the change should do, roughly. */
  expected: string | null;
  /** Judge it again after this many days. */
  reviewInDays: number;
  /** A nutrition or cardio change: the coach approves it first. */
  material: boolean;
};

export type DecisionInput = {
  today: string;
  unit: WeightUnit;
  direction: "lose" | "gain" | "maintain";
  context: GoalContext;
  level: Level | null;
  trajectory: Trajectory;
  target: TargetAssessment | null;
  plan: { start: string | null; weeklyKcal: number | null };
  /** Lowest a day's calories may go: 1,200 for women, 1,500 otherwise. */
  kcalFloor: number;
  adherence: { avg: number | null; checkins: number };
  recovery: { poorSleep: number; lowEnergy: number; stress: number; hungerHigh: boolean; of: number };
  /** Squat and deadlift strength from comparable sets (strength-read.ts). */
  performance: { lower: "up" | "steady" | "down" | null; detail: string | null };
  cardio: {
    plan: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null };
    treadmill: boolean;
    lastChanged: string | null;
    issues: string[];
  };
  digestion: DigestionRead | null;
  waist: { changeCm: number; weeks: number } | null;
  meetWeeksOut: number | null;
  powerlifter: boolean;
  stepCtx: StepContext;
};

const r25 = (n: number) => Math.round(n / 25) * 25;

function ratesFor(x: DecisionInput) {
  if (x.target) return x.target.rates;
  if (x.direction === "gain") return GAIN_RATES[x.level ?? "intermediate"];
  if (x.context === "maintain" || x.context === "gain") return { comfortable: 0.25, limit: 0.5 };
  return LOSS_RATES[x.context];
}

function macroSource(x: DecisionInput, kcal: number): { from: "carbs" | "fats" | "carbs_and_fats"; words: string } {
  if (kcal > 0) return { from: "carbs", words: "from carbs, mostly around training" };
  if (x.context === "powerlifting_class" || x.context === "weight_class_sport" || x.powerlifter)
    return { from: "fats", words: "from fats first, keeping the carbs around training the same" };
  return { from: "carbs_and_fats", words: "from carbs and fats, keeping the carbs around training" };
}

function nutritionAction(x: DecisionInput, kcalPerDay: number): Extract<Action, { kind: "nutrition" }> {
  const src = macroSource(x, kcalPerDay);
  const verb = kcalPerDay > 0 ? "Add" : "Take";
  const prep = kcalPerDay > 0 ? "a day to" : "a day off";
  return {
    kind: "nutrition",
    kcalPerDay,
    from: src.from,
    instruction: `${verb} ${Math.abs(kcalPerDay)} kcal ${prep} every day type, ${src.words}. Keep protein the same and keep every meal a meal-prep container.`,
  };
}

const expectedFromKcal = (kcalPerDay: number, unit: WeightUnit) =>
  `Should move the trend about ${fmtRate((kcalPerDay * 7) / KCAL_PER_KG, unit)} (2–3 weeks to show)`;

export function decide(x: DecisionInput): Recommendation {
  const t = x.trajectory;
  const trend = t.trend;
  const reasons: string[] = [];
  const unit = x.unit;
  const rates = ratesFor(x);
  const nearMeet = x.meetWeeksOut != null && x.meetWeeksOut <= 4;
  const review = nearMeet ? 7 : 14;
  const rec = (r: Partial<Omit<Recommendation, "material">> & Pick<Recommendation, "verdict" | "headline">): Recommendation => {
    const out = { reasons, evidence: "moderate" as Evidence, actions: [] as Action[], expected: null, reviewInDays: review, ...r };
    return { ...out, material: out.actions.some((a) => a.kind === "nutrition" || a.kind === "cardio") };
  };
  if (trend) reasons.push(`Trend ${fmtRate(trend.kgPerWeek, unit)} (${fmtPct(trend.pctPerWeek)}/week) over ${trend.weighIns} weigh-ins, ${trend.clear ? "a clear trend" : `within normal day-to-day scatter (±${fmtWeight(trend.noiseKg, unit)})`}.`);
  if (t.required && t.goal) reasons.push(`The goal needs ${fmtRate(t.required.kgPerWeek, unit)} (${fmtPct(t.required.pctPerWeek)}/week) for ${t.required.weeksLeft} weeks.`);

  // 1. safety
  if (x.digestion?.medical) {
    return rec({ verdict: "investigate", headline: "Digestion needs a doctor's look first", evidence: "strong", actions: [{ kind: "medical", text: x.digestion.medical }, { kind: "digestion", suggestions: x.digestion.suggestions }], reviewInDays: 7 });
  }

  // 2. enough data?
  if (!trend || t.status === "not_enough_data") {
    return rec({
      verdict: "need_data",
      headline: "Not enough weigh-ins to read a trend",
      evidence: "weak",
      actions: [{ kind: "ask", text: "Weigh in 4+ mornings a week (after the bathroom, before eating) so the trend can be read." }],
      reviewInDays: 7,
    });
  }
  if (t.stale) {
    return rec({ verdict: "need_data", headline: "No recent weigh-ins", evidence: "weak", actions: [{ kind: "ask", text: `No weigh-in since ${t.latest?.date}: ask for 4+ this week before changing anything.` }], reviewInDays: 7 });
  }

  const losing = trend.clear && trend.kgPerWeek < 0;
  const pct = trend.pctPerWeek;
  const cardioRecent = !!x.cardio.lastChanged && daysBetween(x.cardio.lastChanged, x.today) <= CARDIO_RECENT_DAYS;
  const perfDown = x.performance.lower === "down";
  if (x.performance.detail) reasons.push(x.performance.detail);

  // 3. losing too fast
  if (x.direction !== "gain" && losing && (Math.abs(pct) > rates.limit || (perfDown && Math.abs(pct) > rates.comfortable))) {
    const want = t.required && t.required.kgPerWeek < 0 ? Math.max(Math.abs(t.required.pctPerWeek), rates.comfortable * 0.6) : rates.comfortable;
    const wantKg = (want / 100) * trend.levelKg;
    reasons.push(`Losing ${fmtPct(pct)}/week is faster than ${perfDown ? "their training is handling" : `the ${rates.limit}%/week that protects strength and muscle`}.`);
    if (cardioRecent && perfDown) {
      const s = stepTreadmill(x.cardio.plan, "down", { ...x.stepCtx, treadmill: x.cardio.treadmill });
      if (s.step.variable !== "none")
        return rec({ verdict: "reduce_load", headline: "Ease the cardio back: losing fast and the lower lifts are dropping", evidence: "strong", actions: [{ kind: "cardio", direction: "down", step: s.step, plan: s.plan }], expected: s.step.weeklyNetKcal != null ? `About ${fmtRate(-s.step.weeklyNetKcal / KCAL_PER_KG, unit)} less loss, and fresher legs` : null });
    }
    const add = Math.min(MAX_STEP_KCAL, Math.max(100, r25(((Math.abs(trend.kgPerWeek) - wantKg) * KCAL_PER_KG) / 7)));
    return rec({ verdict: "adjust", headline: `Add about ${add} kcal a day: losing faster than needed`, evidence: trend.weighIns >= 10 ? "strong" : "moderate", actions: [nutritionAction(x, add)], expected: expectedFromKcal(add, unit) });
  }

  // 4. a new plan settling
  if (x.plan.start && daysBetween(x.plan.start, x.today) < SETTLE_DAYS) {
    reasons.push(`The plan started ${daysBetween(x.plan.start, x.today)} days ago: the first two weeks move water and glycogen, so the scale can't be judged yet.`);
    return rec({ verdict: "maintain", headline: "Hold the plan: it's still settling in", evidence: "weak", reviewInDays: SETTLE_DAYS - daysBetween(x.plan.start, x.today) + 1 });
  }

  const offCourse = t.status === "behind" || t.status === "stalled" || t.status === "wrong_way";

  // 5. the gut before the calories
  if (offCourse && x.digestion?.scaleEffect && (t.fluctuation?.direction === "above" || !trend.clear)) {
    reasons.push("Bloating or constipation this week can read 0.5–1.5 kg heavy on the scale and the tape.");
    return rec({ verdict: "investigate", headline: "Sort the digestion before changing calories", evidence: "moderate", actions: [{ kind: "digestion", suggestions: x.digestion.suggestions }], reviewInDays: 7 });
  }

  // 6. consistency before numbers
  if (offCourse && x.adherence.avg != null && x.adherence.checkins >= 2 && x.adherence.avg < 4) {
    reasons.push(`Sticking to the plan: ${x.adherence.avg}/5 over the last ${x.adherence.checkins} check-ins. The numbers aren't the problem yet.`);
    return rec({ verdict: "investigate", headline: "Consistency first: keep the numbers, fix what's getting in the way", evidence: "moderate", actions: [{ kind: "ask", text: "Ask which meals or days go off plan and what would make them easier (prep, eating out, a swap)." }] });
  }

  // 7. cardio costing the lifts
  if (perfDown && cardioRecent && x.direction !== "gain") {
    const s = stepTreadmill(x.cardio.plan, "down", { ...x.stepCtx, treadmill: x.cardio.treadmill });
    if (s.step.variable !== "none") {
      reasons.push(`Cardio changed on ${x.cardio.lastChanged} and the lower lifts have dropped since.`);
      return rec({ verdict: "reduce_load", headline: "Ease the cardio back: the squat and deadlift are paying for it", evidence: "moderate", actions: [{ kind: "cardio", direction: "down", step: s.step, plan: s.plan }], expected: "Fresher legs for heavy days; make up any energy with nutrition if loss slows" });
    }
  }

  // 8. a target that can't be made safely
  if (x.target?.verdict === "too_fast") {
    reasons.push(x.target.message);
    return rec({
      verdict: "reconsider_target",
      headline: x.target.alternative ? `Reconsider the class: the ${x.target.alternative.label} class is the safer call` : "Reconsider the target or the date",
      evidence: "strong",
      actions: [{ kind: "target", text: x.target.message }],
    });
  }

  // 9. the scale lags a recomposition
  if (offCourse && x.direction === "lose" && x.waist && x.waist.changeCm <= -1 && x.waist.weeks >= 3 && !perfDown) {
    reasons.push(`Waist ${round(x.waist.changeCm, 1)} cm over ${x.waist.weeks} weeks with strength holding: the body is changing even if the scale isn't.`);
    return rec({ verdict: "maintain", headline: "Hold the plan: waist down, strength holding", evidence: "moderate" });
  }

  // 10. off course: the smallest change that closes it
  if (offCourse) {
    // No date: steady progress at any pace is fine; only a real plateau (3+ weeks, 12+ weigh-ins, flat) or going the
    // wrong way is a reason to change anything, and then toward the slow end of the comfortable rate.
    if (!t.required && t.status !== "wrong_way" && !(trend.spanDays >= 21 && trend.weighIns >= 12 && !trend.clear)) {
      reasons.push("No date on the goal, so a slow week isn't a reason to change anything.");
      return rec({ verdict: "maintain", headline: "Hold the plan: give it more weigh-ins", evidence: "weak", actions: [{ kind: "ask", text: "Keep weighing in 4+ mornings a week; it's judged again over 3+ weeks." }], reviewInDays: 7 });
    }
    const enough = trend.weighIns >= 8 && trend.spanDays >= 14;
    if (!enough) {
      reasons.push("Too few weigh-ins over too short a time to act on.");
      return rec({ verdict: "maintain", headline: "Hold for another week of weigh-ins", evidence: "weak", actions: [{ kind: "ask", text: "Weigh in 4+ mornings this week." }], reviewInDays: 7 });
    }
    const evidence: Evidence = trend.clear || (trend.weighIns >= 12 && trend.spanDays >= 21) ? "strong" : "moderate";
    // with no date, aim for the slow end of the comfortable rate, not the top of it
    const noDatePace = (rates.comfortable / 2 / 100) * trend.levelKg;
    const needKg = t.required ? t.required.kgPerWeek : x.direction === "gain" ? noDatePace : -noDatePace;
    const actualKg = trend.clear ? trend.kgPerWeek : 0;
    const gapKcal = r25(((needKg - actualKg) * KCAL_PER_KG) / 7);
    if (Math.abs(gapKcal) < MIN_CHANGE_KCAL) return rec({ verdict: "maintain", headline: "Hold: the gap is too small to change anything for", evidence });
    if (gapKcal > 0) {
      const add = Math.min(MAX_STEP_KCAL, Math.max(100, gapKcal));
      return rec({ verdict: "adjust", headline: `Add about ${add} kcal a day`, evidence, actions: [nutritionAction(x, add)], expected: expectedFromKcal(add, unit) });
    }
    // a loss gap: nutrition first, never under the floor, then one cardio step for the rest
    const need = Math.abs(gapKcal);
    const roomToFloor = x.plan.weeklyKcal != null ? Math.max(0, x.plan.weeklyKcal - x.kcalFloor) : MAX_STEP_KCAL;
    const capPct = x.plan.weeklyKcal ? Math.round(x.plan.weeklyKcal * 0.12) : MAX_STEP_KCAL;
    const cardioFirst = x.recovery.hungerHigh && !nearMeet;
    let fromFood = Math.min(need, MAX_STEP_KCAL, capPct, roomToFloor);
    if (cardioFirst) fromFood = Math.min(fromFood, Math.max(0, need - 100));
    fromFood = fromFood >= 50 ? r25(fromFood) : 0;
    const actions: Action[] = [];
    let expectedKcal = fromFood;
    if (fromFood > 0) actions.push(nutritionAction(x, -fromFood));
    if (cardioFirst) reasons.push("Hunger has been high, so part of it comes from cardio rather than food.");
    if (roomToFloor < need) reasons.push(`Calories are near the floor (${x.kcalFloor}): the rest has to come from activity.`);
    const left = need - fromFood;
    if (left >= MIN_CHANGE_KCAL && !(x.powerlifter && nearMeet)) {
      const s = stepTreadmill(x.cardio.plan, "up", { ...x.stepCtx, treadmill: x.cardio.treadmill });
      if (s.step.variable !== "none") {
        actions.push({ kind: "cardio", direction: "up", step: s.step, plan: s.plan });
        expectedKcal += Math.round((s.step.weeklyNetKcal ?? 0) / 7);
      }
    }
    if (!actions.length) return rec({ verdict: "reconsider_target", headline: "Nothing left to safely change: move the date or the target", evidence, actions: [{ kind: "target", text: "Calories are at the floor and cardio is at its ceiling." }] });
    const headline =
      actions.length === 2 ? `Take ${fromFood} kcal a day and add a little cardio` : fromFood > 0 ? `Take about ${fromFood} kcal a day` : "Add a little cardio";
    return rec({ verdict: "adjust", headline, evidence, actions, expected: expectedFromKcal(-expectedKcal, unit) });
  }

  // 11. gaining too fast
  if (x.direction === "gain" && trend.clear && pct > rates.limit) {
    reasons.push(`Gaining ${fmtPct(pct)}/week is past the ${rates.limit}%/week that stays mostly muscle at their training age.`);
    const take = Math.min(MAX_STEP_KCAL, Math.max(100, r25(((trend.kgPerWeek - (rates.comfortable / 100) * trend.levelKg) * KCAL_PER_KG) / 7)));
    return rec({ verdict: "adjust", headline: `Take about ${take} kcal a day: gaining faster than useful`, evidence: "moderate", actions: [nutritionAction(x, -take)], expected: expectedFromKcal(-take, unit) });
  }

  // 12. ahead of schedule
  if (t.status === "ahead") {
    reasons.push("Ahead of what the goal needs.");
    if (perfDown) {
      const add = 150;
      return rec({ verdict: "adjust", headline: "Ahead of schedule and the lifts are dipping: add a little food back", evidence: "moderate", actions: [nutritionAction(x, add)], expected: expectedFromKcal(add, unit) });
    }
    return rec({ verdict: "maintain", headline: "Hold the plan: ahead of schedule with training holding", evidence: "moderate" });
  }

  if (t.status === "reached") {
    // under a weight class and still losing: food back for training, the class is made either way
    if (t.goal?.kind === "at_most" && losing && t.projected && t.projected.highKg < t.goal.kg - trend.levelKg * 0.01) {
      const add = Math.min(MAX_STEP_KCAL, Math.max(100, r25((Math.abs(trend.kgPerWeek) * KCAL_PER_KG) / 7)));
      reasons.push(`Already under ${fmtWeight(t.goal.kg, unit)} and still losing: more food now goes into training, and they'll still make it.`);
      return rec({ verdict: "adjust", headline: `Under the target and still losing: add about ${add} kcal a day`, evidence: "moderate", actions: [nutritionAction(x, add)], expected: expectedFromKcal(add, unit) });
    }
    return rec({ verdict: "maintain", headline: "At the goal: hold it there", evidence: "strong" });
  }
  if (t.status === "no_target") return rec({ verdict: "maintain", headline: "Hold the plan", evidence: "weak", actions: [{ kind: "ask", text: "Set a target weight (and a date, for a meet or show) so the trajectory can be planned." }] });
  return rec({ verdict: "maintain", headline: "On track: hold the plan", evidence: trend.clear ? "strong" : "moderate" });
}
