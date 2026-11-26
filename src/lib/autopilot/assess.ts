/**
 * Cleo Autopilot's weekly assessment (Nov 25 2026): one consolidated read per
 * coaching client across training, nutrition and cardio, composed from the
 * deterministic reads that already exist, never a parallel engine:
 *
 *   - nutrition and cardio: the weight-management engine's one recommendation
 *     (`decide`, weight-management/decision.ts: the calorie step, the
 *     treadmill step, the safety and data gates) and the coordinated check-in
 *     recommendation (`consolidate`, coaching-recommendation/consolidate.ts:
 *     cardio's own recovery read, one lever at a time);
 *   - training: the program in force (block, week, what's next), the lower
 *     lifts from comparable sets (strength-read.ts via the assessment),
 *     planned vs completed workouts, the check-in's training rating and the
 *     pain read.
 *
 * It decides a category (Maintain / Optimize / Accelerate / Extend /
 * Intervene / Investigate), the evidence, the rationale, what it should do and
 * when to look again, per domain whether anything changes, and what is
 * protected (pain or injury, a health concern, an unsafe weight target, a
 * bigger restructure, a competition close by, the coach's own draft in
 * progress): a protected decision always goes to the coach. Nothing here
 * writes anything; the autonomy settings (autonomy.ts) decide what a decision
 * becomes. Pure and tested (autopilot.test.ts).
 */
import { MAX_STEP_KCAL, type Recommendation as WmRecommendation } from "@/lib/weight-management/decision";
import type { CoachingRecommendation } from "@/lib/coaching-recommendation/consolidate";
import type { CardioStep, TreadmillSession } from "@/lib/weight-management/treadmill";
import type { AutopilotAssessment, Category, Domain, DomainDecision, EvidenceItem, Protection } from "@/lib/autopilot/types";

export type TrainingRead = {
  /** A program is running (a current block they train). */
  activeProgram: boolean;
  /** Scheduled and completed workouts over the last 14 days. */
  planned: number | null;
  completed: number | null;
  /** The latest weekly check-in's training rating, 1–5. */
  rating: number | null;
  block: { name: string; week: number; weeks: number; endsInDays: number | null } | null;
  /** Something is set to start when this block ends. */
  nextBlockReady: boolean;
  /** Days since a program change was last applied (Edit with AI / a version); null = unknown. */
  daysSinceChange: number | null;
};

export type PainRead = { level: "none" | "mild" | "flag" | "severe"; text: string | null };

export type AssessInput = {
  today: string;
  trigger: "checkin" | "scheduled" | "manual";
  /** The weekly check-in this assessment answers (null: the week went without one). */
  checkinId: string | null;
  direction: "lose" | "gain" | "maintain";
  wm: WmRecommendation | null;
  /** The cardio plan the weight-management step would set (with the step). */
  wmCardioPlan?: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null } | null;
  rec: CoachingRecommendation | null;
  /** Squat and deadlift from comparable sets. */
  performance: "up" | "steady" | "down" | null;
  training: TrainingRead;
  pain: PainRead;
  /** Days to their next competition (null: none on file). */
  meetDaysOut: number | null;
  hasNutritionPlan: boolean;
  /** The coach's own unpublished draft in a builder: autopilot never writes over it. */
  coachDrafts: Partial<Record<Domain, boolean>>;
};

/** A competition this close freezes everything but the coach's own changes. */
export const MEET_FREEZE_DAYS = 14;
/** A program change is judged after at least this long (training changes every 1–4 weeks, never weekly churn). */
export const TRAINING_SETTLE_DAYS = 7;
/** A calorie change up to the engine's own step counts as routine (the permitted ranges decide the rest). */
export const SMALL_KCAL = MAX_STEP_KCAL;
/** Below this share of planned workouts, the question is what got in the way, never the program. */
export const ADHERENCE_FLOOR = 0.6;

const hold = (domain: Domain, summary: string, reason: string): DomainDecision => ({
  domain,
  change: "hold",
  summary,
  instruction: null,
  reason,
  size: null,
  kcalPerDay: null,
  cardioStep: null,
  cardioMinutesDelta: null,
  toward: null,
});

export function isoAdd(date: string, days: number): string {
  const t = Date.parse(`${date}T12:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** How many weekly minutes a weight-management treadmill step changes (estimate). */
export function stepMinutesDelta(step: CardioStep | null, plan: AssessInput["wmCardioPlan"]): number | null {
  if (!step || step.variable === "none") return null;
  const s = step.session ? plan?.[step.session] ?? null : null;
  const per = s?.perWeek ?? 1;
  const mins = s?.minutes ?? 0;
  const from = step.from ?? 0;
  const to = step.to ?? 0;
  switch (step.variable) {
    case "minutes":
      return (to - from) * per;
    case "frequency":
      return (to - from) * mins;
    case "added":
      return mins * per;
    case "removed":
      return -from * Math.max(1, per);
    default:
      return 0;
  }
}

/** Adherence over the window, or null when too little was planned to judge. */
export function adherence(t: TrainingRead): number | null {
  if (t.planned == null || t.completed == null || t.planned < 3) return null;
  return Math.min(1, t.completed / t.planned);
}

function trainingDecision(x: AssessInput, protections: Protection[], missing: string[], evidence: EvidenceItem[]): { d: DomainDecision; extend: boolean } {
  const t = x.training;
  const adh = adherence(t);
  if (adh != null) evidence.push({ domain: "training", text: `${t.completed} of ${t.planned} planned workouts done in the last 2 weeks`, source: "measured" });
  if (x.performance) evidence.push({ domain: "training", text: `Squat and deadlift from comparable sets: ${x.performance}`, source: "measured" });
  if (t.rating != null) evidence.push({ domain: "training", text: `Training rated ${t.rating}/5 this week`, source: "reported" });

  if (!t.activeProgram) {
    missing.push("No program running");
    protections.push({ reason: "restructure", domain: "training", text: "No program is running: the next one is the coach's to build." });
    return { d: { ...hold("training", "No program running", "There's no current block to adjust."), change: "review", instruction: null }, extend: false };
  }
  if (x.pain.level === "flag" || x.pain.level === "severe") {
    protections.push({ reason: "injury", domain: "training", text: x.pain.text ?? "Pain reported: any training change is the coach's." });
    return { d: { ...hold("training", "Pain to look at before changing training", x.pain.text ?? "Pain reported this week."), change: "review" }, extend: false };
  }
  if (x.meetDaysOut != null && x.meetDaysOut >= 0 && x.meetDaysOut <= MEET_FREEZE_DAYS) {
    protections.push({ reason: "competition", domain: "training", text: `Competition in ${x.meetDaysOut} days: the peak stays as planned.` });
    return { d: hold("training", "Hold: competition close", `Competition in ${x.meetDaysOut} days.`), extend: false };
  }
  if (adh != null && adh < ADHERENCE_FLOOR) {
    return {
      d: { ...hold("training", "Ask what got in the way before changing the program", `${t.completed} of ${t.planned} workouts done: the program can't be judged on this.`), change: "review" },
      extend: false,
    };
  }
  const progressing = x.performance !== "down" && (adh == null || adh >= 0.8);
  if (t.block && t.block.endsInDays != null && t.block.endsInDays <= 7 && !t.nextBlockReady) {
    protections.push({ reason: "restructure", domain: "training", text: `${t.block.name} ends in ${Math.max(0, t.block.endsInDays)} days with nothing after it.` });
    return {
      d: {
        ...hold(
          "training",
          progressing ? "Extend the current block a week, or build the next one" : "Build the next block",
          `${t.block.name} (week ${t.block.week} of ${t.block.weeks}) ends with no next block ready.`,
        ),
        change: "review",
        size: "large",
      },
      extend: progressing,
    };
  }
  const recoveryPoor = (t.rating != null && t.rating <= 2) || x.wm?.limiting === "recovery";
  const settled = t.daysSinceChange == null || t.daysSinceChange >= TRAINING_SETTLE_DAYS;
  if (x.performance === "down" && recoveryPoor && settled && !x.coachDrafts.training) {
    return {
      d: {
        domain: "training",
        change: "propose",
        summary: "Ease next week's lower-body volume",
        instruction:
          "Next week only, on workouts not yet trained or started: take one working set off each lower-body accessory and cap the main squat and deadlift work at RPE 8. Keep every exercise, the order and the block's intent. Reason: the lower lifts are down on comparable sets and recovery was poor this week.",
        reason: "Lower lifts are down on comparable sets and recovery was poor: a lighter week protects the block.",
        size: "small",
        kcalPerDay: null,
        cardioStep: null,
        cardioMinutesDelta: null,
        toward: false,
      },
      extend: false,
    };
  }
  if (x.performance === "down" && !settled) {
    return { d: hold("training", "Hold: the last program change is still settling", `Changed ${t.daysSinceChange} days ago.`), extend: false };
  }
  return { d: hold("training", progressing ? "Progressing: leave it" : "Hold the program", progressing ? "The lifts are holding or up and the work is getting done." : "Nothing in the data calls for a program change yet."), extend: false };
}

function nutritionDecision(x: AssessInput, protections: Protection[], missing: string[], evidence: EvidenceItem[]): DomainDecision {
  const wm = x.wm;
  if (!wm) {
    missing.push("No weight-management read (weigh-ins or a nutrition plan)");
    return { ...hold("nutrition", "Nothing to read yet", "No weigh-ins or plan on file."), change: "review" };
  }
  for (const r of wm.reasons.slice(0, 3)) evidence.push({ domain: "nutrition", text: r, source: "measured" });
  if (wm.verdict === "need_data") missing.push(wm.headline);
  for (const a of wm.actions) {
    if (a.kind === "medical") protections.push({ reason: "medical", domain: "nutrition", text: a.text });
    if (a.kind === "target") protections.push({ reason: "unsafe_weight", domain: "nutrition", text: a.text });
  }
  if (wm.limiting === "safety") protections.push({ reason: "medical", domain: "nutrition", text: wm.headline });
  const food = wm.actions.find((a) => a.kind === "nutrition");
  if (food && food.kind === "nutrition") {
    if (!x.hasNutritionPlan) {
      missing.push("No nutrition plan to change");
      return { ...hold("nutrition", wm.headline, "There's no current nutrition plan."), change: "review" };
    }
    const toward = x.direction === "lose" ? food.kcalPerDay < 0 : x.direction === "gain" ? food.kcalPerDay > 0 : null;
    return {
      domain: "nutrition",
      change: "propose",
      summary: `${food.kcalPerDay > 0 ? "+" : ""}${food.kcalPerDay} kcal a day`,
      instruction: food.instruction,
      reason: wm.reasons[0] ?? wm.headline,
      size: Math.abs(food.kcalPerDay) <= SMALL_KCAL ? "small" : "large",
      kcalPerDay: food.kcalPerDay,
      cardioStep: null,
      cardioMinutesDelta: null,
      toward,
    };
  }
  if (wm.verdict === "investigate" || wm.verdict === "reconsider_target" || wm.verdict === "need_data") {
    return { ...hold("nutrition", wm.headline, wm.reasons[0] ?? wm.headline), change: "review" };
  }
  return hold("nutrition", wm.limiting === "none" ? "On track: keep the numbers" : wm.headline, wm.reasons[0] ?? wm.headline);
}

function cardioDecision(x: AssessInput, nutrition: DomainDecision, evidence: EvidenceItem[]): DomainDecision {
  const wmCardio = x.wm?.actions.find((a) => a.kind === "cardio");
  if (wmCardio && wmCardio.kind === "cardio" && wmCardio.step.variable !== "none") {
    const delta = stepMinutesDelta(wmCardio.step, wmCardio.plan ?? x.wmCardioPlan ?? null);
    const up = wmCardio.direction === "up";
    return {
      domain: "cardio",
      change: "propose",
      summary: up ? "One small cardio step up" : "Ease the cardio back one step",
      instruction: `${up ? "Increase" : "Reduce"} cardio by one small step: ${wmCardio.step.why}`,
      reason: x.wm!.reasons[0] ?? x.wm!.headline,
      size: delta == null || Math.abs(delta) <= 30 ? "small" : "large",
      kcalPerDay: null,
      cardioStep: wmCardio.step,
      cardioMinutesDelta: delta,
      toward: x.direction === "lose" ? up : x.direction === "gain" ? !up : null,
    };
  }
  // cardio's own read, from the coordinated recommendation (never beside a food change: one lever at a time)
  const own = x.rec?.items.find((i) => i.domain === "cardio" && i.action.kind === "cardio_draft");
  if (own && own.action.kind === "cardio_draft" && nutrition.change !== "propose") {
    evidence.push({ domain: "cardio", text: own.observation, source: "measured" });
    return {
      domain: "cardio",
      change: "propose",
      summary: own.title,
      instruction: own.action.ask,
      reason: own.reason,
      size: "small",
      kcalPerDay: null,
      cardioStep: null,
      cardioMinutesDelta: null,
      toward: null,
    };
  }
  return hold("cardio", "Keep the cardio as it is", "Nothing in the cardio or recovery read calls for a change.");
}

/** The one assessment. */
export function assessClient(x: AssessInput): AutopilotAssessment {
  const protections: Protection[] = [];
  const missing: string[] = [];
  const evidence: EvidenceItem[] = [];

  if (!x.checkinId) missing.push("No weekly check-in this week");
  if (x.pain.level !== "none" && x.pain.text) evidence.push({ domain: "overall", text: x.pain.text, source: "reported" });

  const { d: training, extend } = trainingDecision(x, protections, missing, evidence);
  const nutrition = nutritionDecision(x, protections, missing, evidence);
  const cardio = cardioDecision(x, nutrition, evidence);
  const domains: Record<Domain, DomainDecision> = { training, nutrition, cardio };

  // the coach's own draft in a builder is never written over
  for (const d of ["training", "nutrition", "cardio"] as Domain[]) {
    if (domains[d].change === "propose" && x.coachDrafts[d]) {
      protections.push({ reason: "coach_draft", domain: d, text: `${d[0].toUpperCase()}${d.slice(1)} has your own unpublished draft: autopilot leaves it alone.` });
      domains[d] = { ...domains[d], change: "review" };
    }
  }
  // a competition close by: nutrition and cardio are the coach's too (make-weight and the taper)
  if (x.meetDaysOut != null && x.meetDaysOut >= 0 && x.meetDaysOut <= MEET_FREEZE_DAYS) {
    for (const d of ["nutrition", "cardio"] as Domain[]) {
      if (domains[d].change === "propose") {
        protections.push({ reason: "competition", domain: d, text: `Competition in ${x.meetDaysOut} days: the coach decides any ${d} change.` });
      }
    }
  }
  // big swings are restructures
  for (const d of ["nutrition", "cardio"] as Domain[]) {
    if (domains[d].change === "propose" && domains[d].size === "large" && !protections.some((p) => p.domain === d && p.reason === "restructure")) {
      protections.push({ reason: "restructure", domain: d, text: `A bigger ${d} change than a routine step.` });
    }
  }

  const proposals = Object.values(domains).filter((d) => d.change === "propose");
  const hard = protections.some((p) => p.reason === "injury" || p.reason === "medical" || p.reason === "unsafe_weight");
  const wmInvestigates = !!x.wm && ["investigate", "reconsider_target", "need_data"].includes(x.wm.verdict);
  const trainingReview = training.change === "review" && !extend;

  let category: Category;
  if (hard) category = "intervene";
  else if (missing.length && !proposals.length) category = "investigate";
  else if (proposals.length) category = proposals.some((p) => p.toward === true) ? "accelerate" : "optimize";
  else if (extend) category = "extend";
  else if (wmInvestigates || trainingReview || Object.values(domains).some((d) => d.change === "review")) category = "investigate";
  else category = "maintain";

  const lead =
    category === "intervene"
      ? protections.find((p) => p.reason === "injury" || p.reason === "medical" || p.reason === "unsafe_weight")!.text
      : proposals.length
        ? proposals.map((p) => p.summary).join(" · ")
        : category === "extend"
          ? training.summary
          : category === "investigate"
            ? missing[0] ?? Object.values(domains).find((d) => d.change === "review")?.summary ?? "Look before changing anything"
            : "Keep the current plan";
  const rationale = [...proposals, ...Object.values(domains).filter((d) => d.change === "review")]
    .map((d) => d.reason)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ") || (x.wm?.limiting === "none" ? x.wm.headline : "Training, nutrition and cardio are where they should be for now.");
  const expected =
    proposals.length && x.wm?.expected
      ? x.wm.expected
      : category === "maintain"
        ? "The current trend continues."
        : category === "accelerate"
          ? "Progress toward the goal picks up over the next 2–3 weeks."
          : category === "optimize"
            ? "Better recovery and steadier progress at the same pace or slightly slower."
            : category === "extend"
              ? "The block's progress carries on another week without a gap."
              : null;
  // a change gets the time it needs to read (a calorie change 14 days: its first week is water)
  const days = proposals.some((p) => p.domain === "nutrition") ? Math.max(14, x.wm?.reviewInDays ?? 14) : category === "maintain" ? 7 : Math.min(14, x.wm?.reviewInDays ?? 7);
  return {
    category,
    headline: lead.slice(0, 200),
    rationale: rationale.slice(0, 1200),
    expected,
    reassessOn: isoAdd(x.today, days),
    evidence: evidence.slice(0, 10),
    protections,
    missing: Array.from(new Set(missing)),
    domains,
  };
}

/** A stable fingerprint of what the assessment was made from (the record's `input_hash`). */
export function assessmentHash(a: AutopilotAssessment, extra = ""): string {
  const s = JSON.stringify([a.category, a.headline, Object.values(a.domains).map((d) => [d.domain, d.change, d.instruction, d.kcalPerDay]), a.protections.map((p) => p.reason), extra]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** The assessment as text for the check-in reply writer (the reply is written from the same decision). */
export function assessmentForReply(a: AutopilotAssessment): string {
  const lines = [
    `AUTOPILOT ASSESSMENT (the coach's decision this week; the reply must agree with it): ${a.category.toUpperCase()}: ${a.headline}`,
    `Why: ${a.rationale}`,
  ];
  for (const d of Object.values(a.domains)) {
    if (d.change === "hold") lines.push(`- ${d.domain}: no change (${d.summary})`);
    else if (d.change === "propose") lines.push(`- ${d.domain}: a change is being prepared for the coach to approve (${d.summary}). Say the coach is looking at it, never that it has already changed.`);
    else lines.push(`- ${d.domain}: the coach will look at it first (${d.summary})`);
  }
  if (a.missing.length) lines.push(`Missing: ${a.missing.join("; ")}`);
  return lines.join("\n");
}
