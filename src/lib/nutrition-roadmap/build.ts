/**
 * The roadmap from end to end: the goal read from what's on file (a meet's
 * weight class, a show, the bodyweight goal, else the phase they're in), the
 * energy estimate, the safety screen, the feasibility check, the blocks, and
 * then today's read against the roadmap they're actually on (the active one
 * when there is one): progress, the decision and the next check-in.
 *
 * Reforecasting compares a fresh plan with the active one and calls it
 * meaningful only when the journey really changed (the goal, the blocks, an
 * end date by a week or more, a target by half a kilo, a block's calories by
 * 150), so a normal week never rewrites anything. Locked competition phases
 * are kept exactly as approved. Pure.
 */
import { hashOf, type Assessment, type AssessmentInput } from "@/lib/weight-management/assessment";
import { daysBetween, fmtDay, fmtWeight, round } from "@/lib/weight-management/units";
import type { Maintenance } from "@/lib/nutrition-targets/nutrition-intel";
import { estimateEnergy } from "@/lib/nutrition-roadmap/energy";
import { assessFeasibility } from "@/lib/nutrition-roadmap/feasibility";
import { pathOf, planBlocks, type CurrentPlan } from "@/lib/nutrition-roadmap/blocks";
import { screenSafety } from "@/lib/nutrition-roadmap/safety";
import { readProgress } from "@/lib/nutrition-roadmap/progress";
import { decideRoadmap } from "@/lib/nutrition-roadmap/adjust";
import { scheduleCheckin } from "@/lib/nutrition-roadmap/checkins";
import { readRoadmapAnswers } from "@/lib/nutrition-roadmap/questions";
import { BLOCK_LABEL, COMPETITION_KINDS, GOAL_KIND_LABEL, ROADMAP_VERSION, type Block, type Macros, type RoadmapGoal, type RoadmapGoalKind, type RoadmapPlan, type RoadmapRead } from "@/lib/nutrition-roadmap/types";

export type RoadmapInput = {
  today: string;
  input: AssessmentInput;
  assessment: Assessment;
  selfCoached: boolean;
  /** The targets they're on: the coach's plan, or a self-coached athlete's own. */
  planNow: CurrentPlan | null;
  current: Macros | null;
  targetsChangedOn: string | null;
  /** Maintenance their own results imply (observedMaintenance). */
  observed: Maintenance | null;
  /** Health conditions, medications, form answers in their words. */
  healthTexts: string[];
  /** Roadmap check-ins (self-coached) and the weekly check-ins' roadmap answers, newest first. */
  answers: Array<{ date: string; answers: Record<string, unknown> }>;
  recentEvent: { name: string | null; date: string; physique: boolean } | null;
  nextEvent: { name: string | null; date: string } | null;
  prefs: { everyDays: number | null; lockCompetition: boolean };
  consent: boolean;
  /** The approved (or accepted) roadmap, read against today. */
  active: RoadmapPlan | null;
  lastCheckin: string | null;
  missedCheckins: number;
};

const STRENGTH = (x: AssessmentInput, a: Assessment) => x.powerlifter || a.context === "powerlifting_class" || a.context === "weight_class_sport";

/** The goal the roadmap plans to. */
export function roadmapGoal(a: Assessment, x: AssessmentInput): RoadmapGoal | null {
  const timing = a.weighInTiming;
  if (a.goal) {
    const kind: RoadmapGoalKind =
      a.context === "powerlifting_class" || a.context === "weight_class_sport"
        ? "weight_class"
        : a.context === "bodybuilding"
          ? "contest_prep"
          : a.context === "gain"
            ? "muscle_gain"
            : a.context === "recomp"
              ? "recomp"
              : a.context === "maintain"
                ? "maintain"
                : a.context === "event"
                  ? "event"
                  : "fat_loss";
    return {
      kind,
      label: a.goal.label,
      kg: a.goal.kg,
      date: a.goal.date,
      direction: a.goal.kind,
      source: a.goal.source,
      eventName: a.goal.eventName,
      weightClass: a.goal.weightClass,
      limitKg: a.goal.limitKg,
      weighInHours: a.goal.source === "meet" ? (timing?.hours ?? null) : null,
      federation: a.goal.source === "meet" ? (timing?.federation ?? x.meet?.federation ?? null) : null,
    };
  }
  const p = String(x.plan.phase ?? "").toLowerCase();
  const kind: RoadmapGoalKind | null = /loss|cut/.test(p) ? "fat_loss" : /gain|bulk/.test(p) ? "muscle_gain" : /recomp/.test(p) ? "recomp" : /maint|perform/.test(p) ? "maintain" : null;
  if (!kind) return null;
  const meet = x.meet && x.meet.date >= x.today ? x.meet : null;
  return { kind, label: GOAL_KIND_LABEL[kind], kg: null, date: kind === "maintain" ? (meet?.date ?? null) : null, direction: kind === "maintain" ? "around" : null, source: "phase", eventName: meet?.name ?? null, weightClass: null, limitKg: null, weighInHours: null, federation: null };
}

/** Block statuses for a given day (stored ones go stale). */
export function asOf(plan: RoadmapPlan, today: string): RoadmapPlan {
  return {
    ...plan,
    blocks: plan.blocks.map((b) => {
      const status: Block["status"] = b.end < today ? "done" : b.start <= today ? "current" : "upcoming";
      return { ...b, status, final: status === "current" };
    }),
  };
}

/** Locked competition phases stay exactly as approved while the event's date hasn't moved. */
export function applyLocks(fresh: RoadmapPlan, active: RoadmapPlan | null, lock: boolean): RoadmapPlan {
  if (!lock || !active || active.goal?.date !== fresh.goal?.date) return fresh;
  const keep = active.blocks.filter((b) => COMPETITION_KINDS.includes(b.kind));
  if (!keep.length) return fresh;
  const firstLocked = keep[0].start;
  const before = fresh.blocks.filter((b) => b.end < firstLocked && !COMPETITION_KINDS.includes(b.kind));
  // the block before the locked ones ends where they start
  if (before.length) {
    const last = before[before.length - 1];
    if (last.end !== keep[0].start) before[before.length - 1] = { ...last, end: new Date(Date.parse(`${firstLocked}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) };
  }
  const after = fresh.blocks.filter((b) => b.start > keep[keep.length - 1].end);
  return { ...fresh, blocks: [...before, ...keep.map((b) => ({ ...b, locked: true })), ...after] };
}

export function planHash(p: Pick<RoadmapPlan, "goal" | "blocks" | "feasibility">): string {
  return hashOf([
    ROADMAP_VERSION,
    p.goal ? [p.goal.kind, p.goal.kg != null ? round(p.goal.kg, 1) : null, p.goal.date, p.goal.weightClass] : null,
    p.feasibility.verdict,
    p.blocks.map((b) => [b.kind, b.start, b.end, b.weight ? round(b.weight.targetKg, 1) : null, Math.round(b.energy.engine.kcal / 50) * 50]),
  ]);
}

export function buildRoadmap(x: RoadmapInput): { fresh: RoadmapPlan; read: RoadmapRead } {
  const a = x.assessment;
  const inp = x.input;
  const t = a.trajectory;
  const unit = inp.unit;
  const goal = roadmapGoal(a, inp);
  const currentKg = t.current?.kg ?? t.latest?.kg ?? null;
  const strengthSport = STRENGTH(inp, a);
  const latest = readRoadmapAnswers(x.answers[0]?.answers);
  const recentCycle = x.answers.find((r) => r.answers.cycle_changes != null);
  const cycleChanged = !!recentCycle && daysBetween(recentCycle.date, x.today) <= 42 && readRoadmapAnswers(recentCycle.answers).cycleChanged;
  const illness = !!x.answers[0] && daysBetween(x.answers[0].date, x.today) <= 10 && latest.illness;

  const energy = estimateEnergy({ sex: inp.sex, age: inp.age, heightCm: inp.heightCm, kg: currentKg ?? 75, trainingDays: inp.trainingDays.length, steps: inp.dailySteps, observed: x.observed });
  const losing = goal?.kg != null && currentKg != null ? goal.kg < currentKg : goal?.kind === "fat_loss" || goal?.kind === "recomp" || goal?.kind === "contest_prep";
  const safety = screenSafety({
    age: inp.age,
    sex: inp.sex,
    heightCm: inp.heightCm,
    kg: currentKg,
    healthTexts: x.healthTexts,
    recentLowEnergy: a.checkins.lowEnergy,
    recentChecks: Math.min(3, a.checkins.count),
    cycleChanged,
    illness,
    trendPctPerWeek: t.trend?.clear ? t.trend.pctPerWeek : null,
    intakeKcal: x.current?.kcal ?? null,
    rmr: energy.rmr,
    losing,
  });
  const feas = assessFeasibility({ today: x.today, unit, goal, currentKg, level: inp.level, sex: inp.sex, age: inp.age, energy, trajectory: t, safety });

  const missing: string[] = [];
  if (currentKg == null) missing.push("A few morning weigh-ins: the roadmap starts from their real bodyweight.");
  if (!goal) missing.push("A goal: lose fat, build muscle, hold, or a competition.");
  else if (goal.kg == null && goal.kind !== "maintain") missing.push("A target weight (and a date, if there is one) so the whole journey can be planned.");
  if (energy.source === "bodyweight") missing.push("Height, date of birth and sex, for a far better energy estimate.");
  if (inp.meet && inp.meet.sport === "powerlifting" && !inp.meet.weightClass) missing.push(`The weight class for ${inp.meet.name ?? "the meet"}.`);
  if (goal?.kind === "weight_class" && !goal.federation) missing.push("The federation, for the weigh-in timing.");

  let blocks: Block[] = [];
  let endsShort = false;
  if (currentKg != null) {
    const res = planBlocks({
      today: x.today,
      unit,
      goal,
      currentKg,
      level: inp.level,
      sex: inp.sex,
      age: inp.age,
      heightCm: inp.heightCm,
      energy,
      plannedKgPerWeek: feas.plannedKgPerWeek,
      maxKgPerWeek: feas.maxKgPerWeek,
      makeBy: feas.makeBy,
      safety,
      trainingDays: inp.trainingDays.length || 3,
      strengthSport,
      plan: x.planNow,
      needsBaseline: !t.trend && energy.source !== "observed" && energy.source !== "blend",
      recentEvent: x.recentEvent,
      nextEvent: x.nextEvent,
      phaseMeet: inp.meet && inp.meet.date >= x.today && (!goal || goal.kg == null) ? { name: inp.meet.name, date: inp.meet.date, physique: inp.meet.sport === "bodybuilding" } : null,
      noiseKg: t.trend?.noiseKg ?? null,
    });
    blocks = res.blocks;
    endsShort = res.endsShort;
  }
  if (endsShort && !(losing && safety.noDeficit) && goal?.kg != null) feas.reasons.push("The roadmap plans at a pace that protects training, so it ends short of the target unless the date or target moves.");
  const { plannedKgPerWeek: _p, maxKgPerWeek: _x, makeBy: _m, ...feasibility } = feas;
  void _p;
  void _x;
  void _m;
  const draft: RoadmapPlan = { version: ROADMAP_VERSION, madeOn: x.today, unit, goal, startKg: currentKg, feasibility, energy, blocks, path: [], missing, safety, hash: "" };
  draft.path = pathOf(blocks, x.today, t.trend?.noiseKg ?? null);
  let fresh = applyLocks(draft, x.active, x.prefs.lockCompetition);
  fresh = { ...fresh, hash: planHash(fresh) };

  // today's read: against the roadmap they're on (its health screen and gaps are today's)
  const plan = { ...asOf(x.active ?? fresh, x.today), safety, missing };
  const progress = readProgress({ today: x.today, unit, plan, assessment: a, safety, sex: inp.sex, missedCheckins: x.missedCheckins });
  const decision = decideRoadmap({
    today: x.today,
    unit,
    plan,
    progress,
    assessment: a,
    safety,
    current: x.current,
    changedOn: x.targetsChangedOn,
    selfCoached: x.selfCoached,
    consent: x.consent,
    initial: !x.active,
    strengthSport,
    locked: x.prefs.lockCompetition,
    floorKcal: energy.floorKcal,
  });
  const lastCycle = x.answers.find((r) => r.answers.cycle_changes != null)?.date ?? null;
  const checkin = scheduleCheckin({
    today: x.today,
    plan,
    progress,
    safety,
    lastCheckin: x.lastCheckin,
    firstWeighIn: inp.weighIns.length ? inp.weighIns.map((w) => w.date).sort()[0] : null,
    targetsChangedOn: x.targetsChangedOn,
    everyDays: x.prefs.everyDays,
    sex: inp.sex,
    cycleAskedOn: lastCycle,
    fluctuation: t.fluctuation?.direction ?? null,
    adherence: a.checkins.adherence,
    lowerLifts: inp.performance.lower,
  });
  if (decision.action === "investigate" && !checkin.asks.includes("barriers") && a.recommendation.limiting === "adherence") checkin.asks.push("barriers");
  const currentBlock = plan.blocks.find((b) => b.status === "current") ?? null;
  const nextMilestone = milestoneAfter(plan, x.today);
  return { fresh, read: { plan, progress, decision, checkin, currentBlock, nextMilestone } };
}

/** The next checkpoint or block start, whichever comes first. */
export function milestoneAfter(plan: RoadmapPlan, today: string): RoadmapRead["nextMilestone"] {
  type M = NonNullable<RoadmapRead["nextMilestone"]>;
  const cands: M[] = [];
  for (const b of plan.blocks) {
    if (b.start > today) cands.push({ date: b.start, label: b.title, kg: b.weight?.startKg ?? null, kind: "block" });
    for (const c of b.checkpoints) if (c.date > today) cands.push({ date: c.date, label: b.title, kg: c.kg, kind: "checkpoint" });
  }
  if (plan.goal?.date && plan.goal.date > today) cands.push({ date: plan.goal.date, label: plan.goal.eventName ?? plan.goal.label, kg: plan.goal.kg, kind: "goal" });
  // a block starting or the goal wins over a routine checkpoint on the same day
  const rank = { goal: 0, block: 1, checkpoint: 2 } as const;
  cands.sort((p, q) => p.date.localeCompare(q.date) || rank[p.kind] - rank[q.kind]);
  return cands[0] ?? null;
}

export type RoadmapDiff = { meaningful: boolean; changes: string[] };

/** What changed between the roadmap they're on and a fresh one, in words, and whether it matters. */
export function compareRoadmaps(active: RoadmapPlan | null, fresh: RoadmapPlan, today: string): RoadmapDiff {
  if (!active) return { meaningful: true, changes: ["A first roadmap."] };
  const u = fresh.unit;
  const W = (kg: number) => fmtWeight(kg, u);
  const changes: string[] = [];
  const ga = active.goal;
  const gf = fresh.goal;
  if ((ga?.kind ?? null) !== (gf?.kind ?? null)) changes.push(`Goal: ${ga ? GOAL_KIND_LABEL[ga.kind] : "none"} → ${gf ? GOAL_KIND_LABEL[gf.kind] : "none"}.`);
  if (ga?.kg != null && gf?.kg != null && Math.abs(ga.kg - gf.kg) >= 0.3) changes.push(`Target: ${W(ga.kg)} → ${W(gf.kg)}.`);
  if ((ga?.kg == null) !== (gf?.kg == null)) changes.push(gf?.kg != null ? `Target set: ${W(gf.kg)}.` : "Target removed.");
  if ((ga?.date ?? null) !== (gf?.date ?? null)) changes.push(`Date: ${ga?.date ? fmtDay(ga.date, today) : "none"} → ${gf?.date ? fmtDay(gf.date, today) : "none"}.`);
  if ((ga?.weightClass ?? null) !== (gf?.weightClass ?? null)) changes.push(`Weight class: ${ga?.weightClass ?? "none"} → ${gf?.weightClass ?? "none"}.`);
  if (active.feasibility.verdict !== fresh.feasibility.verdict) changes.push(`Feasibility: ${active.feasibility.verdict.replace("_", " ")} → ${fresh.feasibility.verdict.replace("_", " ")}.`);

  const ahead = (p: RoadmapPlan) => p.blocks.filter((b) => b.end >= today);
  const A = ahead(active);
  const F = ahead(fresh);
  const seq = (bs: Block[]) => bs.map((b) => b.kind).join(">");
  if (seq(A) !== seq(F)) changes.push(`Blocks: ${A.map((b) => BLOCK_LABEL[b.kind]).join(", ") || "none"} → ${F.map((b) => BLOCK_LABEL[b.kind]).join(", ") || "none"}.`);
  else {
    A.forEach((b, i) => {
      const f = F[i];
      if (!f) return;
      if (Math.abs(daysBetween(b.end, f.end)) >= 7) changes.push(`${f.title} ends ${fmtDay(f.end, today)} instead of ${fmtDay(b.end, today)}.`);
      if (b.weight && f.weight && Math.abs(b.weight.targetKg - f.weight.targetKg) >= Math.max(0.5, b.weight.targetKg * 0.0075)) changes.push(`${f.title} target: ${W(b.weight.targetKg)} → ${W(f.weight.targetKg)}.`);
      if (i > 0 && Math.abs(b.energy.engine.kcal - f.energy.engine.kcal) >= 150) changes.push(`${f.title}: about ${f.energy.engine.kcal} kcal a day instead of ${b.energy.engine.kcal}.`);
    });
  }
  return { meaningful: changes.length > 0, changes };
}
