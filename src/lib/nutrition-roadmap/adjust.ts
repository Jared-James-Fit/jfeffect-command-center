/**
 * What to do about it, if anything. A check-in is never a reason to change
 * calories by itself: the order below is the coaching, and holding the plan
 * is the most common answer.
 *
 * 1. Health first: a referral flag or signs of low energy availability mean
 *    nothing gets more restrictive (and food comes back up if it's too low).
 * 2. Not enough data: hold, and ask for what would settle it.
 * 3. The weight-management engine's reasons a scale number lies (a new plan
 *    settling, digestion, inconsistent eating, recovery, workload, a target
 *    that can't be made safely) come before the numbers (decision.ts).
 * 4. Losing too fast is fixed whatever the plan says.
 * 5. A new kind of block starting (a diet break, the peak, recovery), or a
 *    plan for another phase whose trend isn't already doing what the block
 *    asks: move to the block's targets, with approval. The plan they're on
 *    for this very block is never moved to an estimate (most estimates are
 *    the formula): the trend judges it in 6. A coached athlete's numbers are
 *    their coach's plan, so only a self-coached athlete is offered starting
 *    targets from the estimate.
 * 6. Against the block, not the far-off goal: on track or ahead → hold;
 *    behind with poor adherence → find out why; behind with consistent
 *    eating and a reliable trend → the smallest change that closes it,
 *    100–250 kcal, never under the energy floor, and never again until the
 *    last change has had 2–3 weeks to show.
 *
 * A coached athlete's coach approves every change; a self-coached athlete
 * accepts or declines it, and only small routine ones (≤ 150 kcal, no health
 * flag, not a competition phase) may apply by themselves, and only with their
 * consent. Pure.
 */
import type { Assessment } from "@/lib/weight-management/assessment";
import { MAX_STEP_KCAL } from "@/lib/weight-management/decision";
import { daysBetween, fmtRate, round, type WeightUnit } from "@/lib/weight-management/units";
import { KCAL_PER_KG, r25 } from "@/lib/nutrition-roadmap/energy";
import { BLOCK_LABEL, type Block, type Decision, type Macros, type Progress, type RoadmapPlan, type Safety } from "@/lib/nutrition-roadmap/types";

/** No second change to the targets inside this many days (a gain shows slower). */
export const OBSERVE_DAYS = 14;
export const OBSERVE_DAYS_GAIN = 21;
/** The most a self-coached athlete's targets may move by themselves. */
export const AUTO_MAX_KCAL = 150;

const HOLD_KINDS: Block["kind"][] = ["baseline", "maintenance", "diet_break", "performance", "taper", "post_comp", "transition"];
const FUELED: Block["kind"][] = ["performance", "taper", "post_comp"];

export type AdjustInput = {
  today: string;
  unit: WeightUnit;
  plan: RoadmapPlan;
  progress: Progress;
  assessment: Assessment;
  safety: Safety;
  /** The targets they're on now (average day), if any. */
  current: Macros | null;
  /** When those targets last changed. */
  changedOn: string | null;
  selfCoached: boolean;
  /** A self-coached athlete let small changes apply by themselves. */
  consent: boolean;
  /** First roadmap (or a goal just changed): the block's targets are offered as a start. */
  initial: boolean;
  strengthSport: boolean;
  /** A coach locked the competition phases. */
  locked: boolean;
  /** The energy floor at today's bodyweight. */
  floorKcal: number;
};

const currentOf = (blocks: Block[], today: string) => blocks.find((b) => b.start <= today && b.end >= today) ?? null;

/** The current targets moved by `delta` kcal: carbs when adding, fats first for a lifter when taking. */
export function shiftMacros(cur: Macros, delta: number, kg: number, strengthSport: boolean): Macros {
  const kcal = r25(cur.kcal + delta);
  if (delta >= 0) return { ...cur, kcal, carbsG: Math.round(cur.carbsG + delta / 4) };
  const take = -delta;
  const fatFloor = Math.round(0.6 * kg);
  const fatRoom = Math.max(0, (cur.fatG - fatFloor) * 9);
  const fromFat = strengthSport ? Math.min(take, fatRoom) : Math.min(take / 2, fatRoom);
  const fromCarbs = take - fromFat;
  return { kcal, proteinG: cur.proteinG, fatG: Math.round(cur.fatG - fromFat / 9), carbsG: Math.max(0, Math.round(cur.carbsG - fromCarbs / 4)) };
}

export function decideRoadmap(x: AdjustInput): Decision {
  const a = x.assessment;
  const rec = a.recommendation;
  const t = a.trajectory;
  const block = currentOf(x.plan.blocks, x.today);
  const kg = t.current?.kg ?? x.plan.startKg ?? 70;
  const approval: Decision["approval"] = x.selfCoached ? "athlete" : "coach";
  const others = rec.actions.flatMap((act) => (act.kind === "cardio" ? [act.step.why] : act.kind === "digestion" ? act.suggestions : act.kind === "medical" || act.kind === "target" || act.kind === "ask" ? [act.text] : []));
  const observe = block?.kind === "surplus" ? OBSERVE_DAYS_GAIN : OBSERVE_DAYS;
  const sinceChange = x.changedOn ? daysBetween(x.changedOn, x.today) : null;
  const settled = sinceChange == null || sinceChange >= observe;
  const floor = Math.max(block?.energy.floorKcal ?? 0, x.floorKcal);

  const out = (d: Partial<Decision> & Pick<Decision, "action" | "headline">): Decision => {
    const base: Decision = { reasons: [], kcalChange: null, next: null, observeDays: rec.reviewInDays || OBSERVE_DAYS, approval: "none", autoEligible: false, other: [], ...d };
    if (base.kcalChange != null && base.next) {
      base.approval = approval;
      const routine = Math.abs(base.kcalChange) <= AUTO_MAX_KCAL && base.next.kcal >= floor && !x.safety.flags.length && !x.initial && !(block && FUELED.includes(block.kind)) && !x.locked;
      base.autoEligible = x.selfCoached && x.consent && routine && base.action === "adjust";
    }
    return base;
  };
  const change = (delta: number, reasons: string[], headline: string) => {
    if (!x.current) return null;
    let d = delta;
    const next = shiftMacros(x.current, d, kg, x.strengthSport);
    if (next.kcal < floor) {
      d = floor - x.current.kcal;
      if (d >= -25) return null;
      return out({ action: "adjust", headline, reasons: [...reasons, `Kept at the ${floor} kcal floor for them.`], kcalChange: r25(d), next: shiftMacros(x.current, d, kg, x.strengthSport) });
    }
    return out({ action: "adjust", headline, reasons, kcalChange: r25(d), next });
  };

  // 1. health first
  const refer = x.safety.flags.find((f) => f.severity === "refer");
  const lowEnergy = x.safety.flags.find((f) => f.key === "reds_energy" || f.key === "under_rmr" || f.key === "reds_cycle");
  if (refer || lowEnergy) {
    const reasons = [(refer ?? lowEnergy)!.text];
    // eating too little is fixed: food comes back toward maintenance
    const maintenance = block?.energy.maintenance ?? x.plan.energy.kcal;
    if (x.current && (lowEnergy || x.safety.noDeficit) && x.current.kcal < maintenance - 150) {
      const up = Math.min(MAX_STEP_KCAL + 100, r25(maintenance - x.current.kcal));
      const d = out({ action: "escalate", headline: "Bring food back toward maintenance and get a professional's review", reasons, kcalChange: up, next: shiftMacros(x.current, up, kg, x.strengthSport), observeDays: 7 });
      return { ...d, autoEligible: false };
    }
    return out({ action: "escalate", headline: refer ? "See a professional before the plan goes further" : "Don't cut further: energy looks too low", reasons, observeDays: 7, other: others });
  }

  // 2. data
  if (x.progress.status === "insufficient_data") {
    // a member's first targets come from the estimate; a coached athlete's numbers are their coach's plan
    if (!x.current && block && x.initial && x.selfCoached) {
      return out({ action: "adjust", headline: `Start with the ${BLOCK_LABEL[block.kind].toLowerCase()} targets`, reasons: ["A starting point from the estimate; the first weeks of weigh-ins set the real numbers."], kcalChange: 0, next: block.energy.engine });
    }
    return out({ action: "hold", headline: "Hold: not enough weigh-ins to judge yet", reasons: ["Weigh in 4+ mornings a week so the trend can be read. Nothing changes on too little data."], observeDays: 7 });
  }

  // 3. the reasons a scale number lies, from the weight-management engine
  if (rec.limiting === "digestion" || rec.limiting === "adherence" || rec.limiting === "recovery" || rec.limiting === "workload") {
    return out({ action: "investigate", headline: rec.headline, reasons: rec.reasons.slice(-2), other: others, observeDays: rec.reviewInDays });
  }
  if (rec.limiting === "target" && rec.verdict === "reconsider_target") return out({ action: "reconsider", headline: rec.headline, reasons: rec.reasons.slice(-2), other: others });
  if (rec.limiting === "target") return out({ action: "investigate", headline: rec.headline, reasons: rec.reasons.slice(-1), other: others });

  // 4. a rate that costs them is fixed whatever the plan says: losing too fast (food back),
  //    or gaining faster than muscle can be built (a little less), never a cut in a fueled phase
  if (rec.limiting === "rate" && rec.verdict === "adjust") {
    const n = rec.actions.find((act) => act.kind === "nutrition");
    if (n && n.kind === "nutrition" && (n.kcalPerDay > 0 || (block?.kind === "surplus" && settled))) {
      const d = change(n.kcalPerDay, rec.reasons.slice(-2), rec.headline);
      if (d) return d;
    }
  }

  // 5. a new kind of block starting, or a plan for another phase that the trend says isn't working.
  //    The plan they're on for this very block is never moved to an estimate: the trend judges it (6).
  if (block) {
    const engine = block.energy.engine;
    const cur = x.current;
    const blockAge = daysBetween(block.start, x.today);
    const maintenance = block.energy.maintenance;
    if (!cur) {
      if (x.selfCoached) return out({ action: "adjust", headline: `Set your targets for ${block.title.toLowerCase()}`, reasons: [block.why], kcalChange: 0, next: engine });
      return out({ action: "hold", headline: "No calorie targets on the plan yet", reasons: [`${block.title} calls for about ${engine.kcal} kcal a day (protein ${engine.proteinG} g, carbs ${engine.carbsG} g, fat ${engine.fatG} g) as a starting point when the plan gets its numbers.`] });
    }
    const gap = engine.kcal - cur.kcal;
    const meaningful = Math.abs(gap) >= Math.max(150, cur.kcal * 0.07);
    const mismatch =
      (block.rate.kgPerWeek < 0 && cur.kcal >= maintenance - 50) ||
      (block.rate.kgPerWeek > 0 && cur.kcal <= maintenance + 25) ||
      (HOLD_KINDS.includes(block.kind) && Math.abs(cur.kcal - maintenance) > 200);
    const idx = x.plan.blocks.indexOf(block);
    const prev = idx > 0 ? x.plan.blocks[idx - 1] : null;
    // a new kind of block (a diet break, the peak, recovery), not part 2 of the same one
    const transition = !!prev && prev.kind !== block.kind && blockAge <= 10 && block.start <= x.today;
    const planIsBlock = block.energy.from === "plan";
    // a plan for another phase whose trend already does what the block asks needs nothing
    const tr0 = t.trend;
    const want0 = block.rate.kgPerWeek;
    const alreadyMoving = !!tr0 && tr0.clear && want0 !== 0 && Math.sign(tr0.kgPerWeek) === Math.sign(want0) && Math.abs(tr0.kgPerWeek) >= Math.abs(want0) * 0.75;
    const offPhase = !planIsBlock && !alreadyMoving && settled && (x.initial || mismatch);
    if (meaningful && (transition || offPhase)) {
      const verb = gap > 0 ? "up" : "down";
      const reasons = [`${block.title} calls for about ${engine.kcal} kcal a day; the current targets average ${cur.kcal}.`, block.why];
      if (gap < 0 && x.safety.conservative) {
        const d = change(Math.max(gap, -AUTO_MAX_KCAL), reasons, `Start ${block.title.toLowerCase()}: a small step down`);
        if (d) return d;
      }
      return out({ action: "adjust", headline: `Start ${block.title.toLowerCase()}: calories ${verb} to about ${engine.kcal}`, reasons, kcalChange: r25(gap), next: engine });
    }
  }

  const status = x.progress.status;
  const adherence = a.checkins.adherence;
  // 6. against the block
  if (status === "on_track" || status === "ahead") {
    const reasons = [x.progress.detail];
    if (status === "on_track" && adherence != null && adherence < 4) reasons.push("Consistency could improve, but there's nothing to change in the numbers.");
    return out({ action: "hold", headline: status === "ahead" ? "Hold: ahead of plan with nothing to fix" : "Hold: progressing where it should. No changes needed", reasons, other: others });
  }
  if (!block || HOLD_KINDS.includes(block.kind)) {
    // a hold block drifting: only a clear, sustained drift is worth a small step
    const tr = t.trend;
    const dev = x.progress.deviationKg ?? 0;
    if (tr && tr.clear && tr.spanDays >= 21 && Math.abs(dev) > kg * 0.01 && settled && !(block && FUELED.includes(block.kind) && dev < 0)) {
      const d = change(dev > 0 ? -125 : 125, [x.progress.detail], dev > 0 ? "Drifting up for 3+ weeks: a small step down" : "Drifting down for 3+ weeks: a small step up");
      if (d) return d;
    }
    return out({ action: "hold", headline: "Hold: inside the normal range for this block", reasons: [x.progress.detail], other: others });
  }

  // behind in a block that moves bodyweight
  if (adherence != null && adherence < 4) {
    return out({
      action: "investigate",
      headline: "Behind, but consistency comes first: keep the numbers, fix what's getting in the way",
      reasons: [`Sticking to the plan: ${adherence}/5. Reducing calories wouldn't fix that.`, x.progress.detail],
      other: ["Which meals or days go off plan, and what would make them easier (prep, eating out, a swap)?"],
    });
  }
  const tr = t.trend;
  const reliable = !!tr && tr.weighIns >= 8 && tr.spanDays >= 14;
  if (!reliable) return out({ action: "hold", headline: "Behind, but too early to act: another week of weigh-ins", reasons: [x.progress.detail], observeDays: 7 });
  if (!settled) return out({ action: "hold", headline: "Behind, but the last change needs time to show", reasons: [`The targets changed ${sinceChange} days ago; a change takes 2–3 weeks to show on the trend.`, x.progress.detail] });
  const actual = tr!.clear ? tr!.kgPerWeek : 0;
  const want = block.rate.kgPerWeek;
  const gapKcal = r25(((want - actual) * KCAL_PER_KG) / 7);
  if (Math.abs(gapKcal) < 75) return out({ action: "hold", headline: "Hold: the gap is too small to change anything for", reasons: [x.progress.detail] });
  const cap = x.safety.conservative ? AUTO_MAX_KCAL : MAX_STEP_KCAL;
  const delta = Math.sign(gapKcal) * Math.min(cap, Math.max(100, Math.abs(gapKcal)));
  if (delta < 0 && block.kind !== "surplus" && FUELED.includes(block.kind)) return out({ action: "hold", headline: "Hold: this phase is fueled, not dieted", reasons: [x.progress.detail] });
  const d = change(delta, [x.progress.detail, `The block plans ${fmtRate(want, x.unit)}; the trend is ${fmtRate(actual, x.unit)} over ${tr!.spanDays} days with consistent eating.`], delta < 0 ? `A small change: take about ${Math.abs(r25(delta))} kcal a day` : `A small change: add about ${r25(delta)} kcal a day`);
  if (d) return { ...d, reasons: [...d.reasons, `Expected to move the trend about ${fmtRate(round((delta * 7) / KCAL_PER_KG, 2), x.unit)}, showing in 2–3 weeks.`] };
  return out({ action: "reconsider", headline: "Nothing left to safely cut: move the date or the target", reasons: [`Intake is at the ${floor} kcal floor for them.`] });
}
