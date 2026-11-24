/**
 * Cardio plan quality (Nov 23 2026): how well a cardio prescription suits this
 * person, by category (goal, recovery, training, dose, sustainability, time,
 * progression), from the plan itself and what's on file. Deterministic, pure
 * and tested (cardio-quality.test.ts); see plan-quality.ts for what the score
 * is and isn't. Also the plan's facts the recovery read uses (planFacts).
 *
 * Audit (Nov 24 2026): the design score no longer moves with results on their
 * own. The bodyweight trend counts only as evidence about the dose (a light plan
 * whose fat loss is on track is enough; one followed well while it's behind
 * isn't), adherence only corroborates a practicality problem the plan already
 * shows, and a plan with no cardio has no number (it says whether that's right
 * for them instead of scoring 100). Adherence and results sit beside the score
 * (execution), and what the training plan means for it is said (connections).
 */
import { CARDIO_WEEKDAYS, type CardioWeekday } from "@/lib/cardio-prescription";
import { WEEKLY_MINUTES, TRAIN_MINUTES_MAX, TRAIN_MINUTES_MAX_PL, TRAIN_INCLINE_MAX_PL, type CardioGoal } from "@/lib/weight-management/treadmill";
import { modalitySpec } from "@/lib/cardio/modalities";
import { planTotals, sessionTitle, weekdaysFor, type CardioPlan, type CardioSession, type PlanContext } from "@/lib/cardio/plan";
import { adherencePct, clampScore, finishQuality, FOLLOW_LOW, type QualityCategory, type QualityConnection, type QualityExecution, type QualityScore } from "@/lib/plan-quality";

export type CardioScoreContext = PlanContext & {
  /** "lose" | "gain" | "maintain", or null when no goal is on file. */
  direction: "lose" | "gain" | "maintain" | null;
  /** The weight-management context (powerlifting_class, bodybuilding, fat_loss, recomp, maintain, gain, event…). */
  context: string | null;
  /** How the bodyweight trend stands against the goal (trajectory status). */
  trendStatus: string | null;
  heavyLowerDays: CardioWeekday[];
  powerlifter: boolean;
  walkingLimits: string[];
  meetWeeksOut: number | null;
  /** Sessions done of those prescribed over the last 4 weeks, when known. */
  adherence: { done: number; planned: number } | null;
  /** Their own words about cardio from the latest check-in. */
  issues: string[];
  /** Recovery signals flagged right now (sleep, energy, HRV…). */
  recoveryFlags: number;
  steps: number | null;
  bodyweightKg: number | null;
  /** When the plan in force last changed. */
  lastChanged: string | null;
  today: string;
  checkins: number;
  /** Lower-body strength lately (weight-management's read of their comparable sets), when known. */
  lowerPerformance?: "up" | "steady" | "down" | null;
  /** Hunger flagged on their weekly check-ins (a cut with a lot of cardio feels it). */
  hungerHigh?: boolean;
};

const CARDIO_GOAL: Record<string, CardioGoal> = {
  powerlifting_class: "fat_loss",
  weight_class_sport: "fat_loss",
  bodybuilding: "contest",
  fat_loss: "fat_loss",
  recomp: "recomp",
  maintain: "maintain",
  gain: "gain",
  event: "performance",
};

/** The weekly minutes that do the job for their goal (less with 10k+ steps a day). */
export function goalMinutes(ctx: Pick<CardioScoreContext, "context" | "direction" | "steps">): number {
  const goal: CardioGoal = (ctx.context && CARDIO_GOAL[ctx.context]) || (ctx.direction === "lose" ? "fat_loss" : ctx.direction === "gain" ? "gain" : "maintain");
  const base = WEEKLY_MINUTES[goal];
  return ctx.steps != null && ctx.steps >= 10_000 ? Math.round(base * 0.75) : base;
}

const dayBefore = (d: CardioWeekday): CardioWeekday => CARDIO_WEEKDAYS[(CARDIO_WEEKDAYS.indexOf(d) + 6) % 7];

/** The plan's shape, for the recovery read and the score. */
export function planFacts(plan: CardioPlan, ctx: PlanContext & { heavyLowerDays: CardioWeekday[] }) {
  const totals = planTotals(plan, ctx);
  const training = new Set(ctx.trainingDays);
  const heavyEve = new Set(ctx.heavyLowerDays.map(dayBefore));
  let highImpact = 0;
  let before = 0;
  let eve = 0;
  let trainMax = 0;
  const perDay = new Map<string, number>();
  for (const s of plan.sessions) {
    if (!s.enabled) continue;
    const days = weekdaysFor(s.days, s.weekdays, ctx);
    const spec = modalitySpec(s.modality);
    const hard = (s.rpeMax ?? s.rpeMin ?? 0) >= 6;
    const moderate = (s.rpeMax ?? s.rpeMin ?? 0) >= 5;
    for (const d of days) {
      perDay.set(d, (perDay.get(d) ?? 0) + s.minutes);
      if (spec.lowerBody === "high") highImpact++;
      if (training.has(d) && s.timing === "before_lifting") before++;
      if (training.has(d)) trainMax = Math.max(trainMax, s.minutes);
      if (heavyEve.has(d) && (moderate || spec.lowerBody !== "low") && (hard || spec.lowerBody === "high" || s.minutes >= 30)) eve++;
    }
  }
  const biggest = Math.max(0, ...perDay.values());
  return {
    ...totals,
    empty: totals.sessions === 0,
    highImpactSessions: highImpact,
    beforeLifting: before,
    dayBeforeHeavyLower: eve,
    trainingDayMinutesMax: trainMax,
    biggestDayShare: totals.minutes ? biggest / totals.minutes : 0,
  };
}

function executionOf(ctx: CardioScoreContext): QualityExecution {
  const a = ctx.adherence;
  const pct = a ? adherencePct(a.done, a.planned) : null;
  const t = ctx.trendStatus;
  const outcome =
    ctx.direction && ctx.direction !== "maintain" && t
      ? t === "on_track" || t === "ahead" || t === "reached"
        ? { status: "on_track" as const, label: "Bodyweight is on track for the goal" }
        : t === "behind" || t === "stalled"
          ? { status: "behind" as const, label: "Bodyweight is behind the goal" }
          : t === "wrong_way"
            ? { status: "off" as const, label: "Bodyweight is moving the wrong way" }
            : null
      : null;
  return {
    adherence: pct != null && a ? { pct, label: `${Math.min(a.done, a.planned)} of ${a.planned} planned sessions done in 4 weeks` } : null,
    outcome,
  };
}

const DAY_SHORT = (d: string) => d.slice(0, 3);

export function scoreCardioPlan(plan: CardioPlan, ctx: CardioScoreContext): QualityScore {
  const f = planFacts(plan, ctx);
  const totals = planTotals(plan, ctx, ctx.bodyweightKg);
  const target = goalMinutes(ctx);
  const enabled = plan.sessions.filter((s) => s.enabled);
  const trainCap = ctx.powerlifter ? TRAIN_MINUTES_MAX_PL : TRAIN_MINUTES_MAX;
  const meetClose = ctx.meetWeeksOut != null && ctx.meetWeeksOut <= 4;
  const execution = executionOf(ctx);
  const adh = execution.adherence?.pct ?? null;
  const followed = adh != null && adh >= FOLLOW_LOW;
  const onTrack = execution.outcome?.status === "on_track";
  const behind = execution.outcome != null && execution.outcome.status !== "on_track";
  const points = [ctx.direction != null, ctx.trainingDays.length > 0, adh != null, ctx.checkins >= 2, ctx.trendStatus != null && ctx.trendStatus !== "not_enough_data"].filter(Boolean).length;
  const missing: string[] = [];
  if (ctx.direction == null) missing.push("A bodyweight goal");
  if (!ctx.trainingDays.length) missing.push("Their training days");
  if (adh == null) missing.push("A few weeks of logged cardio");
  if (ctx.checkins < 2) missing.push("Weekly check-ins");

  // what their training means for the cardio (and the other way round)
  const connections: QualityConnection[] = [];
  if (f.dayBeforeHeavyLower) connections.push({ domain: "training", text: `Harder cardio lands the day before heavy squat or deadlift days (${ctx.heavyLowerDays.map(DAY_SHORT).join(", ")})` });
  if (f.beforeLifting) connections.push({ domain: "training", text: "Cardio is set before lifting on training days" });
  if (ctx.lowerPerformance === "down" && (f.hardMinutes > 0 || f.highImpactSessions > 0)) connections.push({ domain: "training", text: "Lower-body strength is down while some cardio is hard or high-impact (a pattern, not a confirmed cause)" });
  if (ctx.hungerHigh && ctx.direction === "lose" && f.minutes > target * 1.5) connections.push({ domain: "nutrition", text: `Hunger is high on a fat-loss plan with ${f.minutes} min of cardio a week` });

  // nothing prescribed: no number, just whether that's right for them
  if (f.empty) {
    const none =
      ctx.direction === "lose" && behind
        ? { headline: `No cardio while fat loss is behind. A little easy cardio is one lever worth considering, alongside nutrition.`, action: "review" as const }
        : ctx.direction == null
          ? { headline: "No cardio set, and no bodyweight goal on file to judge it against.", action: "none" as const }
          : { headline: ctx.direction === "lose" ? "No cardio set: fat loss is coming from nutrition, which is fine while it's working." : "No cardio set: fits their goal.", action: "none" as const };
    return finishQuality([], { what: "cardio plan", points, missing, execution, connections, none });
  }

  const cats: QualityCategory[] = [];

  // Goal alignment: the dose against what the goal needs (results are evidence about the dose, nothing more)
  {
    const notes: string[] = [];
    let s: number | null = 100;
    if (ctx.direction == null) {
      s = null;
      notes.push("No bodyweight goal on file to judge the dose against");
    } else if (ctx.direction === "lose" || ctx.context === "bodybuilding") {
      if (f.minutes < target * 0.6) {
        if (onTrack) {
          s = 92;
          notes.push(`Light (${f.minutes} min a week), and fat loss is on track: no more needed`);
        } else if (behind && followed) {
          s = 62;
          notes.push(`${f.minutes} min a week, followed well, while fat loss is behind (about ${target} usually does the job)`);
        } else {
          s = 78;
          notes.push(`${f.minutes} min a week is light for a fat-loss goal (about ${target} usually does the job)`);
        }
      } else if (f.minutes > target * 4) {
        s = 50;
        notes.push(`${f.minutes} min a week is far more than the goal needs (about ${target})`);
      } else if (f.minutes > target * 2.5) {
        s = 70;
        notes.push(`${f.minutes} min a week is more than the goal usually needs (about ${target})`);
      } else if (behind && followed) {
        s = 80;
        notes.push(`${f.minutes} min a week, followed well, while fat loss is behind: nutrition is the likelier lever`);
      } else notes.push(`${f.minutes} min a week fits a fat-loss goal`);
    } else if (ctx.direction === "gain") {
      if (f.minutes > target * 4) s = 50;
      else if (f.minutes > target * 2) s = 70;
      if (f.hardMinutes > 30) s = (s ?? 100) - 15;
      notes.push(s != null && s < 100 ? `${f.minutes} min a week${f.hardMinutes > 30 ? `, ${f.hardMinutes} of them hard,` : ""} works against building` : "Light enough not to get in the way of building");
    } else {
      if (f.minutes > target * 4) {
        s = 65;
        notes.push(`${f.minutes} min a week is a lot for maintenance`);
      } else notes.push("Fits a maintenance goal");
    }
    cats.push({ key: "goal", label: "Goal alignment", score: s == null ? null : clampScore(s), weight: 0.22, notes });
  }

  // Recovery compatibility
  {
    const notes: string[] = [];
    let s = 100;
    if (f.hardMinutes > 60) {
      s -= 20;
      notes.push(`${f.hardMinutes} min a week at RPE 6+`);
    } else if (f.hardMinutes > 30) {
      s -= 10;
      notes.push(`${f.hardMinutes} min a week at RPE 6+`);
    }
    if (f.highImpactSessions) {
      s -= Math.min(30, f.highImpactSessions * 10);
      notes.push(`${f.highImpactSessions} high-impact session${f.highImpactSessions > 1 ? "s" : ""} a week (running, stairs or conditioning)`);
    }
    if (ctx.recoveryFlags >= 2 && (totals.avgRpe ?? 0) >= 5) {
      s -= 15;
      notes.push("Moderate-to-hard cardio while recovery signals are down");
    }
    const legs = ctx.issues.find((i) => /legs? (feel |felt )?tired|heavy legs|sore legs/i.test(i));
    if (legs) {
      s -= f.hardMinutes > 0 || f.minutes > 120 ? 20 : 10;
      notes.push("They said cardio leaves their legs tired for lifting");
    }
    if (ctx.walkingLimits.length && enabled.some((x) => (modalitySpec(x.modality).walking && (x.incline ?? 0) > 3) || modalitySpec(x.modality).lowerBody === "high")) {
      s -= 20;
      notes.push(`Incline or impact with ${ctx.walkingLimits.join(", ")} on file`);
    }
    if (meetClose && (f.hardMinutes > 0 || f.highImpactSessions > 0)) {
      s -= 20;
      notes.push("Hard cardio within 4 weeks of the meet");
    }
    if (!notes.length) notes.push("Easy enough to recover from alongside training");
    cats.push({ key: "recovery", label: "Recovery compatibility", score: clampScore(s), weight: 0.16, notes });
  }

  // Training compatibility
  {
    const notes: string[] = [];
    let s: number | null = 100;
    if (!ctx.trainingDays.length) {
      s = null;
      notes.push("Their training days aren't set, so placement can't be checked");
    } else {
      if (f.beforeLifting) {
        s -= 20;
        notes.push(`${f.beforeLifting} session${f.beforeLifting > 1 ? "s" : ""} a week before lifting`);
      }
      if (f.dayBeforeHeavyLower) {
        s -= 15;
        notes.push("Harder cardio the day before a heavy squat or deadlift day");
      }
      if (f.trainingDayMinutesMax > trainCap + 5) {
        s -= 15;
        notes.push(`${f.trainingDayMinutesMax} min on a lifting day (${trainCap} or less after lifting keeps sessions short)`);
      }
      const plIncline = ctx.powerlifter && enabled.some((x) => weekdaysFor(x.days, x.weekdays, ctx).some((d) => ctx.trainingDays.includes(d)) && (x.inclineMax ?? x.incline ?? 0) > TRAIN_INCLINE_MAX_PL);
      if (plIncline) {
        s -= 10;
        notes.push(`Over ${TRAIN_INCLINE_MAX_PL}% incline after heavy lifting`);
      }
      if (!notes.length) notes.push("Placed around training well");
    }
    cats.push({ key: "training", label: "Training compatibility", score: s == null ? null : clampScore(s), weight: 0.16, notes });
  }

  // Intensity and volume
  {
    const notes: string[] = [];
    let s = 100;
    const noEffort = enabled.filter((x) => x.rpeMin == null && x.rpeMax == null && x.hrMin == null && !x.hrZone);
    if (noEffort.length) {
      s -= Math.min(30, noEffort.length * 10);
      notes.push(`No effort target on ${noEffort.map(sessionTitle).join(", ")}`);
    }
    if ((totals.avgRpe ?? 0) > 7) {
      s -= 15;
      notes.push(`Average target effort RPE ${totals.avgRpe}`);
    }
    const cap = ctx.powerlifter ? 200 : 300;
    if (f.minutes > cap) {
      s -= 20;
      notes.push(`${f.minutes} min a week is a lot of volume`);
    }
    const long = enabled.filter((x) => x.minutes > 60);
    if (long.length) {
      s -= 10;
      notes.push(`${long.map((x) => `${x.minutes}-min ${sessionTitle(x).toLowerCase()}`).join(", ")}`);
    }
    const tiny = enabled.filter((x) => x.minutes < 10);
    if (tiny.length) {
      s -= 5;
      notes.push("A session under 10 minutes");
    }
    if (!notes.length) notes.push(`Dose fits: ${f.minutes} min a week${totals.avgRpe != null ? ` around RPE ${totals.avgRpe}` : ""}`);
    cats.push({ key: "dose", label: "Intensity and volume", score: clampScore(s), weight: 0.14, notes });
  }

  // Sustainability: judged on the plan; low adherence only corroborates a problem the plan already shows
  {
    const notes: string[] = [];
    let s = 100;
    let practical = 0;
    if (f.days >= 7 && f.minutes > 210) {
      s -= 10;
      practical++;
      notes.push("Cardio every day with a lot of minutes");
    }
    if (f.longest > 45 && enabled.some((x) => modalitySpec(x.modality).walking)) {
      s -= 10;
      practical++;
      notes.push(`A ${f.longest}-min session is hard to keep up`);
    }
    if (f.minutes > target * 2.5) {
      s -= 5;
      practical++;
      notes.push(`${f.minutes} min a week is a big time ask`);
    }
    const hard = ctx.issues.filter((i) => /no time|too hard|missed/i.test(i));
    if (hard.length) {
      s -= 15;
      practical++;
      notes.push(`They said: ${hard.join(", ").toLowerCase()}`);
    }
    if (adh != null && adh < FOLLOW_LOW && practical) {
      s -= 10;
      notes.push(`Only ${adh}% done lately, which fits the plan being hard to keep`);
    }
    if (!notes.length) notes.push("Simple to keep up");
    cats.push({ key: "sustain", label: "Sustainability", score: clampScore(s), weight: 0.14, notes });
  }

  // Time efficiency
  {
    const notes: string[] = [];
    let s = 100;
    const slowFlat = enabled.filter((x) => modalitySpec(x.modality).treadmill && x.minutes >= 40 && (x.incline ?? 0) < 2 && (x.speedMinMph ?? 3) < 3.2);
    if (slowFlat.length && ctx.walkingLimits.length === 0) {
      s -= 15;
      notes.push("Long flat walks: a little incline does the same work in less time");
    }
    if (enabled.some((x) => x.minutes > 60)) {
      s -= 10;
      notes.push("A session over an hour");
    }
    if (totals.estKcal != null && f.minutes > 0 && totals.estKcal / f.minutes < 3 && ctx.direction === "lose") {
      s -= 10;
      notes.push(`About ${Math.round((totals.estKcal / f.minutes) * 10) / 10} kcal a minute (estimate): low output for the time`);
    }
    if (!notes.length) notes.push("Good output for the time it takes");
    cats.push({ key: "efficiency", label: "Time efficiency", score: clampScore(s), weight: 0.08, notes });
  }

  // Progression strategy
  {
    const notes: string[] = [];
    let s = 100;
    const progressing = enabled.filter((x) => x.progression.kind !== "none" && x.progression.step > 0);
    const wantsProgress = ctx.direction === "lose" || ctx.context === "bodybuilding" || ctx.context === "event";
    const daysSince = ctx.lastChanged ? Math.round((Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(`${ctx.lastChanged.slice(0, 10)}T00:00:00Z`)) / 86_400_000) : null;
    if (wantsProgress && !progressing.length) {
      if (daysSince != null && daysSince < 28) {
        s = 92;
        notes.push("Holds steady while the new plan settles");
      } else if (behind && followed) {
        s = 70;
        notes.push("No progression, followed well, while the trend is behind the goal");
      } else if (onTrack) notes.push("Holding steady while it works");
      else {
        s = 85;
        notes.push("No progression set (fine while it's working; the trend will tell)");
      }
    } else if (!wantsProgress && progressing.length) {
      s = 85;
      notes.push("Progression a maintenance or building goal doesn't need");
    }
    for (const x of progressing) {
      const p = x.progression;
      const perWeek = p.step / Math.max(1, p.everyWeeks);
      const aggressive = (p.kind === "minutes" && perWeek > 10) || (p.kind === "incline" && perWeek > 2) || (p.kind === "speed" && perWeek > 0.3) || (p.kind === "sessions" && perWeek > 1);
      if (aggressive) {
        s -= 20;
        notes.push(`${sessionTitle(x)} progresses fast`);
      }
      if (p.cap == null) {
        s -= 15;
        notes.push(`${sessionTitle(x)}: progression has no ceiling`);
      }
    }
    if (!notes.length) notes.push(progressing.length ? "Progresses in small steps with a ceiling" : "No progression needed");
    cats.push({ key: "progression", label: "Progression strategy", score: clampScore(s), weight: 0.1, notes });
  }

  return finishQuality(cats, { what: "cardio plan", points, missing, execution, connections });
}

export type { CardioSession };
