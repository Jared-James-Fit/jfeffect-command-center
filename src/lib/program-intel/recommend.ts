/**
 * The recommended setup for the next program, prefilled from the records:
 * every value says where it came from and why, and an established constraint
 * (the days they actually train, their session length, their equipment) is
 * never changed without a reason. When the coach changes one (4 days → 3),
 * `redistribution` says what that does to the workload, and `findConflicts`
 * names any requirements that can't all hold. Deterministic.
 */
import { mean, round, sum } from "./core";
import type { AthleteContext } from "./context";
import { missingEquipment, type EquipmentResolution } from "./equipment";
import type { Pattern } from "./patterns";
import { exerciseResponse, type ProgramReview } from "./review";
import { calibrationFactor, estimateDay, type TimedExercise } from "./session-time";
import { cardioGoal, liftingMinutesWith, proposeCardio, type CardioPlan } from "./cardio";
import { LEVEL_LABEL, PRIORITY_GROUPS, startingDose } from "./first-program";
import { BRAIN_LABEL, LIFTS, STRENGTH_BRAINS, type Brain, type EquipmentItem, type IntelReport, type Lift, type RawExercise } from "./types";
import { defaultMode, goalDeadline, planHorizon, plannedStart, type Deadline, type DurationMode, type Horizon } from "./horizon";

export type ExerciseRef = { id: string | null; name: string };
export type BlockPlan = { name: string; weeks: number; objective: string };
export type GenerationSetup = {
  brain: Brain;
  mainGoal: string;
  secondaryGoals: string[];
  daysPerWeek: number;
  trainingDays: string[];
  /** Weeks written and scheduled now (the horizon; horizon.ts). */
  weeks: number;
  /** How the length was chosen: the 12-week default, the coach's own number, or the goal timeline. */
  durationMode: DurationMode;
  /** The program's first day (a Monday after whatever is running now). */
  startDate: string | null;
  sessionMinutes: number | null;
  maxSessionMinutes: number | null;
  /** The coach's own block layout; empty = the strategy chooses the phases and block lengths. */
  blocks: BlockPlan[];
  priorities: string[];
  equipment: { items: EquipmentItem[]; location: string | null; cableStations: number | null; notes: string | null; source: EquipmentResolution["source"]; confidence: EquipmentResolution["confidence"] };
  restrictions: string[];
  retain: ExerciseRef[];
  replace: ExerciseRef[];
  meetDate: string | null;
  frequency: Array<{ target: string; perWeek: number }>;
  volume: Array<{ target: string; setsPerWeek: number }>;
  intensity: string;
  effort: string;
  progression: string;
  specificity: string;
  required: ExerciseRef[];
  excluded: ExerciseRef[];
  recovery: string;
  preferences: string;
  coachNotes: string;
  newCircumstances: string;
  /** The cardio plan the program is built around: theirs, one proposed when there's none, or none. Never workout rows. */
  cardio: CardioPlan | null;
};
export type SetupField = keyof GenerationSetup;
export type Why = { source: string; reason: string; confidence: "high" | "medium" | "low" };

export type Baseline = {
  daysPerWeek: number | null;
  weeks: number | null;
  weeklySets: number;
  perSessionSets: number | null;
  estMinutesPerSession: number | null;
  actualMinutesPerSession: number | null;
  calibration: number | null;
  liftSets: Record<Lift, number | null>;
  liftFreq: Record<Lift, number | null>;
  muscleSets: Array<{ muscle: string; sets: number; freq: number | null }>;
};

export type SetupRecommendation = { setup: GenerationSetup; why: Partial<Record<SetupField, Why>>; baseline: Baseline };

const roundUp5 = (n: number) => Math.ceil(n / 5) * 5;
/** An answer that says nothing ("None", "N/A", "-"). */
const EMPTY_ANSWER = /^(none|n\/?a|na|no|nothing|nope|-+|\.)?$/i;
/** Muscles worth training at least twice a week (the rest keep what they had). */
const MAJOR_MUSCLES = /^(chest|back|upper back|lats|shoulders|delts|quads|glutes|hamstrings)$/i;
const LIFT_NAME: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

/** The previous program's real dose: what a redistribution keeps and an audit compares against. */
export function programBaseline(prev: IntelReport | null, exercises: Map<string, RawExercise>, opts: { adjustableDumbbells?: boolean } = {}): Baseline {
  const empty: Baseline = { daysPerWeek: null, weeks: null, weeklySets: 0, perSessionSets: null, estMinutesPerSession: null, actualMinutesPerSession: null, calibration: null, liftSets: { squat: null, bench: null, deadlift: null }, liftFreq: { squat: null, bench: null, deadlift: null }, muscleSets: [] };
  if (!prev || !prev.weeks.length) return empty;
  const plannedWeeks = prev.weeks.filter((w) => w.plannedDays > 0);
  const days = plannedWeeks.length ? Math.round(mean(plannedWeeks.map((w) => w.plannedDays)) as number) : null;
  // the prescribed sets of a typical week (median week)
  const weekSets = prev.weeks.map((w) => sum(prev.days.filter((d) => d.weekKey === w.key).flatMap((d) => d.rows.map((r) => r.prescribed.sets ?? 0)))).filter((n) => n > 0).sort((a, b) => a - b);
  const weeklySets = weekSets.length ? weekSets[weekSets.length >> 1] : 0;
  const timed = (d: IntelReport["days"][number]): TimedExercise[] =>
    d.rows.map((r) => ({ name: r.exercise, equipment: exercises.get(r.exerciseId ?? "")?.equipment ?? null, sets: r.prescribed.sets ?? 3, reps: r.prescribed.reps, restSeconds: r.prescribed.restSeconds }));
  const pairs = prev.days.filter((d) => d.durationMin != null && (d.status === "completed" || d.status === "partial")).map((d) => ({ estimated: estimateDay(timed(d), opts).minutes, actual: d.durationMin as number }));
  const cal = calibrationFactor(pairs);
  const firstWeek = prev.weeks[0]?.key;
  const wk1 = prev.days.filter((d) => d.weekKey === firstWeek);
  const est = wk1.length ? Math.round(mean(wk1.map((d) => estimateDay(timed(d), { ...opts, calibration: cal ?? 1 }).minutes)) as number) : null;
  const trained = prev.weeks.filter((w) => w.completedDays + w.partialDays > 0);
  const liftSets = Object.fromEntries(LIFTS.map((l) => [l, trained.length ? round(sum(trained.map((w) => w.lifts[l].sets)) / trained.length, 1) : null])) as Record<Lift, number | null>;
  const liftFreq = Object.fromEntries(LIFTS.map((l) => [l, trained.length ? round(sum(trained.map((w) => w.lifts[l].sessions)) / trained.length, 1) : null])) as Record<Lift, number | null>;
  const durations = prev.days.map((d) => d.durationMin).filter((n): n is number => n != null && n >= 10 && n <= 240);
  return {
    daysPerWeek: days,
    weeks: prev.weeks.length,
    weeklySets,
    perSessionSets: days ? round(weeklySets / days, 1) : null,
    estMinutesPerSession: est,
    actualMinutesPerSession: durations.length ? Math.round(mean(durations) as number) : null,
    calibration: cal,
    liftSets,
    liftFreq,
    muscleSets: prev.muscles.filter((m) => m.avgHardSetsPerWeek != null).map((m) => ({ muscle: m.muscle, sets: m.avgHardSetsPerWeek as number, freq: m.frequencyPerWeek })),
  };
}

/** A block layout for the program length, the brain and a meet (a starting point the strategy may change for a reason). */
export function blockStructure(brain: Brain, weeks: number, meetWeeksOut: number | null): BlockPlan[] {
  const w = Math.max(1, Math.round(weeks));
  if (brain === "powerlifting" && meetWeeksOut != null && meetWeeksOut <= w + 1) {
    if (w <= 4) return [{ name: "Peak and taper", weeks: w, objective: "Express strength for the meet: heavy singles and attempt practice, volume coming down, last week a taper." }];
    const taper = w >= 10 ? 3 : 2;
    const intens = Math.max(2, Math.round((w - taper) * 0.45));
    const accum = w - taper - intens;
    return [
      ...(accum > 0 ? [{ name: "Accumulation", weeks: accum, objective: "Build work capacity and technique on the competition lifts with moderate intensity and the most volume of the cycle." }] : []),
      { name: "Intensification", weeks: intens, objective: "Raise intensity toward competition loads while volume comes down; top sets with back-offs." },
      { name: "Realization and taper", weeks: taper, objective: "Heavy singles and attempt rehearsal, then a taper into the meet." },
    ];
  }
  if ((brain === "powerlifting" || brain === "general_strength" || brain === "powerbuilding") && w >= 8) {
    const a = Math.ceil(w / 2);
    return [
      { name: brain === "powerbuilding" ? "Strength + volume" : "Accumulation", weeks: a, objective: brain === "powerbuilding" ? "Main lifts at moderate intensity with back-off volume; accessories progressing in their rep ranges." : "Volume and technique on the main lifts at moderate intensity." },
      { name: brain === "powerbuilding" ? "Strength + intensity" : "Intensification", weeks: w - a, objective: brain === "powerbuilding" ? "Main lifts heavier with less volume; accessories held; last week lighter." : "Heavier top sets, less volume; last week lighter or a test." },
    ];
  }
  const objective: Record<Brain, string> = {
    powerlifting: "Progress each competition lift from its own response; heavier top sets as the weeks go on, lighter final week.",
    bodybuilding: "Stable exercises progressed by double progression to near failure; deload or reassess in the last week if fatigue builds.",
    powerbuilding: "Main lifts first for strength, accessories for hypertrophy; progress both, lighter final week.",
    general_strength: "Progress the main patterns week to week; lighter final week.",
    general_fitness: "Consistent sessions with steady progression on the main exercises.",
    hybrid: "Strength and conditioning progressed together, hard days separated.",
    other: "Progress toward the stated goal.",
  };
  return [{ name: brain === "bodybuilding" ? "Hypertrophy" : BRAIN_LABEL[brain], weeks: w, objective: objective[brain] }];
}

function prescriptionStyle(prev: IntelReport | null): { intensity: string; effort: string; progression: string } {
  if (!prev) return { intensity: "", effort: "", progression: "" };
  const rows = prev.days.filter((d) => d.weekKey === prev.weeks[0]?.key).flatMap((d) => d.rows);
  const main = rows.filter((r) => r.lift && (r.competition || /primary/i.test(r.role ?? "")) || (r.prescribed.repRange && r.prescribed.repRange[1] <= 8));
  const acc = rows.filter((r) => !main.includes(r));
  const fmt = (list: typeof rows) => {
    const reps = [...new Set(list.map((r) => r.prescribed.reps).filter(Boolean))].slice(0, 4).join(", ");
    const rpe = [...new Set(list.map((r) => r.prescribed.rpe).filter(Boolean))].slice(0, 3).join(", ");
    return `${reps || "?"} reps${rpe ? ` @RPE ${rpe}` : ""}`;
  };
  const pct = rows.some((r) => r.prescribed.percentage != null);
  const ranges = rows.filter((r) => r.prescribed.repRange && r.prescribed.repRange[1] > r.prescribed.repRange[0]).length;
  const rpes = rows.filter((r) => r.prescribed.rpe).length;
  return {
    intensity: [main.length ? `Main lifts: ${fmt(main)}` : null, acc.length ? `Accessories: ${fmt(acc)}` : null].filter(Boolean).join(" · ") + " (as in the last program)",
    effort: rpes ? `RPE targets as last program (${[...new Set(rows.map((r) => r.prescribed.rpe).filter(Boolean))].slice(0, 4).join(", ")})` : "No effort targets in the last program: add RPE / RIR so effort can be read next time",
    progression: pct ? "Percentage-based load progression (from the last program)" : ranges >= rows.length / 2 && rpes ? "Double progression: reps to the top of the range at the target RPE, then add load (as last program)" : rpes ? "Load chosen by RPE each session, added when the target RPE drops" : "Add load or reps when all sets are completed",
  };
}

/** Every dated deadline on file: the next meet, and the long-term goal when it has a date. */
export function deadlinesOf(ctx: AthleteContext): Deadline[] {
  const out: Deadline[] = [];
  const meet = ctx.competition.next;
  if (meet) out.push({ kind: "meet", name: meet.name, date: meet.date, source: "Meet prep" });
  const goal = goalDeadline(ctx.goals.longTerm);
  if (goal) out.push(goal);
  return out;
}

/** The horizon for a mode (and the coach's own number of weeks), from when the next program starts. */
export function horizonFor(ctx: AthleteContext, mode: DurationMode, customWeeks?: number | null, startDate?: string | null): Horizon {
  const start = startDate ? { date: startDate, why: "the start you set" } : plannedStart(ctx.today, ctx.schedule.currentEnd ?? null);
  return planHorizon({ mode, customWeeks, start: start.date, startWhy: start.why, deadlines: deadlinesOf(ctx) });
}

/** The horizon a setup describes (a default length other than 12 is the coach's own number). */
export function setupHorizon(setup: Pick<GenerationSetup, "weeks" | "durationMode" | "startDate">, ctx: AthleteContext): Horizon {
  const mode: DurationMode = setup.durationMode === "default" && setup.weeks !== 12 ? "custom" : setup.durationMode ?? "default";
  const h = horizonFor(ctx, mode === "goal" ? "custom" : mode, setup.weeks, setup.startDate);
  return mode === "goal" ? { ...h, mode: "goal", why: horizonFor(ctx, "goal", null, setup.startDate).recommended.why, conflicts: [] } : h;
}

export function recommendSetup(x: {
  ctx: AthleteContext;
  brain: Brain;
  brainWhy: string;
  prev: IntelReport | null;
  history: IntelReport;
  review: ProgramReview | null;
  patterns: Pattern[];
  exercises: Map<string, RawExercise>;
}): SetupRecommendation {
  const { ctx, brain, prev } = x;
  const why: Partial<Record<SetupField, Why>> = {};
  const p = ctx.previous;
  const baseline = programBaseline(prev, x.exercises, { adjustableDumbbells: ctx.equipment.items.includes("adjustable_dumbbells") });
  // A first program: nothing logged yet, so it's built from what they told you at setup.
  const fresh = x.history.coverage.loggedSets === 0;
  const level = ctx.profile.level ?? null;

  // Goals.
  const goalBits = [ctx.goals.main, ctx.goals.other].filter(Boolean) as string[];
  const progFocus = p?.intent[0] ?? null;
  const mainGoal = ctx.competition.next ? `Compete: ${ctx.competition.next.name} on ${ctx.competition.next.date}` : goalBits[0] ?? progFocus ?? BRAIN_LABEL[brain];
  const goalsAgeDays = ctx.goals.updatedAt ? Math.round((Date.parse(ctx.today) - Date.parse(ctx.goals.updatedAt.slice(0, 10))) / 86_400_000) : null;
  const stale = goalsAgeDays != null && goalsAgeDays > 120;
  why.mainGoal = ctx.competition.next
    ? { source: "Meet prep on file", reason: `${ctx.competition.next.weeksOut} weeks out.`, confidence: "high" }
    : goalBits[0]
      ? { source: "Goals & Setup", reason: `Stated goal${ctx.goals.updatedAt ? ` (updated ${ctx.goals.updatedAt.slice(0, 10)})` : ""}.${stale ? ` That's ${Math.round((goalsAgeDays as number) / 30)} months old: check it's still their goal.` : ""}`, confidence: stale ? "low" : "medium" }
      : { source: "Last program", reason: "No goal on file; taken from the last program's focus.", confidence: "low" };
  const secondary = [...new Set([...(ctx.goals.styles ?? []).filter((s) => !/coach can decide/i.test(s)), ...(ctx.goals.target ? [ctx.goals.target] : []), ...(ctx.goals.bodyweightGoal ? [`Bodyweight: ${ctx.goals.bodyweightGoal}`] : [])])]
    .filter((s) => !EMPTY_ANSWER.test(s.trim()))
    .slice(0, 5);
  if (goalBits[0] && progFocus && !new RegExp(goalBits[0].split(" ")[0], "i").test(progFocus)) secondary.push(`Keep the last program's focus: ${progFocus.split(" · ")[0]}`);
  why.secondaryGoals = fresh
    ? { source: "Goals & Setup", reason: "Their training styles and target.", confidence: "medium" }
    : { source: "Goals & Setup + last program", reason: "Training styles, target and the last program's focus.", confidence: "medium" };

  // Days per week: their training schedule (clients.committed_training_days, which Goals & Setup
  // follows) is where every workout lands, so a program with another number of days can't be placed.
  // What they actually did only explains it; changing the number means changing their schedule.
  const committed = ctx.schedule.committedFrequency ?? (ctx.schedule.committedDays.length || null);
  const goalsDays = ctx.schedule.goalsDaysPerWeek;
  let days: number;
  if (committed) {
    days = committed;
    const bits: string[] = [];
    if (p && p.plannedDaysPerWeek && p.trained >= 6) {
      bits.push(`last program: ${p.plannedDaysPerWeek} days, ${p.sessionAdherencePct}% of due workouts done`);
      if ((p.sessionAdherencePct ?? 100) < 75)
        bits.push(`keep sessions short and doable; if ${committed} days is too many, change their training days first`);
    }
    why.daysPerWeek = {
      source: "Training schedule",
      reason: `${ctx.schedule.committedDays.join(", ") || `${committed} days`}: the days their workouts go on (Goals & Setup follows them).${bits.length ? ` ${bits.join("; ")}.` : ""}`,
      confidence: "high",
    };
  } else if (p && p.plannedDaysPerWeek && p.trained >= 6) {
    if ((p.sessionAdherencePct ?? 0) >= 75) {
      days = p.plannedDaysPerWeek;
      why.daysPerWeek = { source: "Last program", reason: `Trained ${p.trained} of ${p.due} due workouts (${p.sessionAdherencePct}%) on ${days} days a week. No training schedule on file: set their days so workouts land on them.`, confidence: "medium" };
    } else {
      days = Math.max(1, Math.min(p.plannedDaysPerWeek, Math.round(p.trainedDaysPerWeek ?? p.plannedDaysPerWeek)));
      why.daysPerWeek = { source: "Last program (adherence)", reason: `Programmed ${p.plannedDaysPerWeek} days but trained about ${p.trainedDaysPerWeek ?? "?"} a week (${p.sessionAdherencePct}% of due workouts): matching what they actually did.`, confidence: "medium" };
    }
  } else if (goalsDays) {
    days = goalsDays;
    why.daysPerWeek = { source: "Goals & Setup", reason: "Their stated days per week; too little training logged to go by.", confidence: "medium" };
  } else {
    days = brain === "general_fitness" ? 3 : 4;
    why.daysPerWeek = { source: "Default", reason: "Nothing on file: a common starting point. Set their real days.", confidence: "low" };
  }
  const trainingDays = ctx.schedule.committedDays.length === days ? ctx.schedule.committedDays : ctx.schedule.observedWeekdays.length === days ? ctx.schedule.observedWeekdays : ctx.schedule.committedDays;
  why.trainingDays = trainingDays.length ? { source: trainingDays === ctx.schedule.committedDays ? "Committed schedule" : "When they trained", reason: trainingDays.join(", "), confidence: trainingDays.length === days ? "high" : "low" } : { source: "Not on file", reason: "Workouts are placed on their training days when you assign.", confidence: "low" };

  // Weeks: 12 written at a time by default; a deadline within 16 weeks of the start sets the length
  // (Goal timeline), counted from when the program starts (after whatever is running now).
  const meet = ctx.competition.next;
  const auto = horizonFor(ctx, "goal");
  const mode = defaultMode(auto);
  const hz = mode === "goal" ? auto : horizonFor(ctx, "default");
  const weeks = hz.weeks;
  why.weeks = mode === "goal" ? { source: "Goal timeline", reason: hz.why, confidence: "high" } : { source: "Default", reason: `${hz.why}${fresh ? " Week 1 finds their working weights; the rest progresses from what they log." : ""}`, confidence: "medium" };

  // Session length: as long as their sessions actually take, within their stated limit, and for a
  // client who trains in booked PT sessions within that hour (warm-up, lifting and cardio all inside it).
  const pt = ctx.session.ptMinutes ?? null;
  const stated = ctx.session.goalsMinutes ?? null;
  const cap = pt != null && (stated == null || pt <= stated) ? pt : stated;
  const capIsPt = cap != null && cap === pt;
  const capName = capIsPt ? `their ${pt}-min PT session` : "Goals & Setup";
  let sessionMinutes: number | null;
  if (ctx.session.entries >= 4 && ctx.session.observedMedian != null) {
    sessionMinutes = cap ? Math.min(cap, roundUp5(ctx.session.observedMedian)) : roundUp5(ctx.session.observedMedian);
    why.sessionMinutes = { source: "Logged sessions", reason: `Their sessions took ${ctx.session.observedMedian} min (median of ${ctx.session.entries})${cap ? `; ${capName} allows ${cap}` : ""}.`, confidence: "high" };
  } else if (cap) {
    sessionMinutes = cap;
    why.sessionMinutes = capIsPt
      ? { source: "Booked PT sessions", reason: `They train in ${cap}-min PT sessions: the whole workout fits the hour.`, confidence: "high" }
      : { source: "Goals & Setup", reason: "Their stated session length.", confidence: "medium" };
  } else {
    sessionMinutes = baseline.estMinutesPerSession ? roundUp5(baseline.estMinutesPerSession) : null;
    why.sessionMinutes = { source: sessionMinutes ? "Last program (estimated)" : "Not on file", reason: sessionMinutes ? "Estimated from the last program's prescription." : "No session length on file.", confidence: "low" };
  }
  // within what a setup accepts (a sparse prescription can estimate under 15 minutes)
  if (sessionMinutes != null) sessionMinutes = Math.min(240, Math.max(15, sessionMinutes));
  let maxSessionMinutes = cap ?? (ctx.session.observedP80 ? roundUp5(ctx.session.observedP80) : null);
  if (maxSessionMinutes != null) maxSessionMinutes = Math.min(300, Math.max(15, maxSessionMinutes));
  why.maxSessionMinutes = capIsPt
    ? { source: "Booked PT sessions", reason: `They book ${cap}-min PT sessions (${ctx.session.ptBooked ?? 0} from 8 weeks back to 4 ahead): the warm-up, the lifting and the cardio after it all fit inside${stated != null && stated > cap ? `, though Goals & Setup says ${stated}` : ""}.`, confidence: "high" }
    : cap ? { source: "Goals & Setup", reason: "Their stated maximum session length.", confidence: "medium" } : maxSessionMinutes ? { source: "Logged sessions", reason: "The longest typical session (80th percentile).", confidence: "medium" } : { source: "Not on file", reason: "No limit on file.", confidence: "low" };

  // Cardio: their plan (the app adds its training-day session to every workout), or, with none on
  // file, one proposed from the goal that becomes their plan on Assign. Lifting leaves room for it.
  const goalForCardio = cardioGoal(mainGoal) !== "none" ? mainGoal : [mainGoal, ...secondary, ctx.goals.target ?? ""].join(" ");
  const cardio: CardioPlan =
    ctx.cardio.source === "plan" ? ctx.cardio : proposeCardio({ goalText: goalForCardio, trainingDays, meetWeeksOut: meet?.weeksOut ?? null });
  const lifting = liftingMinutesWith(cardio, sessionMinutes, cap);
  if (lifting != null && sessionMinutes != null && lifting < sessionMinutes && cardio.trainingDay) {
    why.sessionMinutes = {
      source: why.sessionMinutes?.source ?? "Goals & Setup",
      reason: `${why.sessionMinutes?.reason ?? ""} Lifting ${lifting} min so the ${cardio.trainingDay.minutes}-min cardio after it still fits their ${cap} min.`.trim(),
      confidence: why.sessionMinutes?.confidence ?? "medium",
    };
    sessionMinutes = lifting;
  }
  why.cardio = {
    source: cardio.source === "plan" ? (cardio.origin === "nutrition" ? "Nutrition plan" : cardio.origin === "program_rows" ? "Their program's cardio" : "Cardio targets") : cardio.source === "proposed" ? "Proposed (no plan on file)" : "No added cardio",
    reason: cardio.why,
    confidence: cardio.source === "plan" ? "high" : "medium",
  };

  // the strategy decides the phases and block lengths for this athlete and timeline (no fixed 4-week blocks)
  const blocks: BlockPlan[] = [];
  why.blocks = { source: "Strategy", reason: `The AI picks the phases, block lengths and any lighter weeks for this athlete${hz.deadline ? ` and ${hz.deadline.name}` : ""}; set your own in Advanced if you want them fixed.`, confidence: "medium" };

  // Priorities: what the evidence says is lagging (never invented).
  const priorities: string[] = [];
  const prioWhy: string[] = [];
  if (prev && STRENGTH_BRAINS.includes(brain)) {
    for (const L of prev.lifts) {
      const exp = L.exposures.filter((e) => e.e1rm != null).length;
      if (exp >= 3 && (L.stalled || (L.compTrend.changePct ?? 0) < 1)) {
        priorities.push(LIFT_NAME[L.lift]);
        prioWhy.push(`${LIFT_NAME[L.lift]} didn't progress (${L.compTrend.changePct ?? 0}%)`);
      }
    }
  }
  if (prev) for (const m of prev.muscles.filter((m) => m.target && m.status === "below")) { priorities.push(m.muscle); prioWhy.push(`${m.muscle} below its volume target`); }
  const goalText = [ctx.goals.target, ctx.goals.other, ctx.goals.clientGoals].filter(Boolean).join(" ").toLowerCase();
  // a body part they named, as the muscle groups the program counts ("arms" = biceps and triceps)
  for (const word of ["glutes", "arms", "chest", "back", "shoulders", "legs", "bench", "squat", "deadlift", "total"]) {
    if (!new RegExp(`\\b${word}\\b`).test(goalText)) continue;
    const groups = PRIORITY_GROUPS[word] ?? [word[0].toUpperCase() + word.slice(1)];
    const added = groups.filter((g) => !priorities.some((q) => q.toLowerCase() === g.toLowerCase()));
    if (!added.length) continue;
    priorities.push(...added);
    prioWhy.push(`${word} named in their goals`);
  }
  why.priorities = priorities.length ? { source: "Records + goals", reason: prioWhy.join("; "), confidence: "medium" } : { source: "Nothing stands out", reason: "No lift or muscle lagged in the records and none is named in their goals. Add one if you want an emphasis.", confidence: "low" };

  const restrictions = [...ctx.injuries.stated, ...ctx.injuries.areas.map((a) => `Pain reported: ${a} (${ctx.injuries.painReports.filter((p) => (p.area ?? "").toLowerCase().trim() === a).length}×)`)];
  why.restrictions = restrictions.length && fresh ? { source: "Goals & Setup", reason: "Injuries they told you about at setup.", confidence: "medium" } : restrictions.length ? { source: "Injuries + check-outs", reason: "Stated injuries and pain reported after workouts.", confidence: "medium" } : { source: "Nothing on file", reason: ctx.recovery.checkouts ? "No injuries or pain reports on file." : "No injuries on file and no check-outs to report pain: confirm with them.", confidence: ctx.recovery.checkouts ? "medium" : "low" };

  // Exercises to keep and to reconsider.
  const retain: ExerciseRef[] = [];
  const replace: ExerciseRef[] = [];
  if (prev) {
    for (const e of prev.exercises) {
      const resp = exerciseResponse(e);
      if (resp === "progressed" && (e.adherencePct ?? 0) >= 85) retain.push({ id: e.exerciseId, name: e.name });
      else if (e.competition && STRENGTH_BRAINS.includes(brain) && !retain.some((r) => r.id === e.exerciseId)) retain.push({ id: e.exerciseId, name: e.name });
      if ((resp === "stalled" || resp === "regressed") && e.exposures >= 4) replace.push({ id: e.exerciseId, name: e.name });
      else if (e.adherencePct != null && e.adherencePct < 75 && e.setsPrescribedDue >= 6) replace.push({ id: e.exerciseId, name: e.name });
    }
  }
  for (const pt of x.patterns.filter((q) => q.id.startsWith("pain:") || q.id.endsWith(":stalls"))) if (!replace.some((r) => r.name === pt.subject)) replace.push({ id: null, name: pt.subject });
  why.retain = fresh
    ? { source: "First program", reason: "No training logged yet: exercises are chosen from their goal, level, equipment and injuries.", confidence: "medium" }
    : { source: "Last program", reason: retain.length ? "Progressed with their sets done (and the competition lifts for a strength program)." : "No exercise clearly progressed with full adherence.", confidence: retain.length ? "high" : "low" };
  why.replace = fresh
    ? { source: "First program", reason: "Nothing to reconsider yet.", confidence: "medium" }
    : { source: "Last program + patterns", reason: replace.length ? "Stalled over 4+ exposures, often skipped, or linked to pain reports. Candidates only: the strategy decides." : "Nothing clearly failed.", confidence: "medium" };

  // Advanced: the previous dose per lift / muscle, so the next program starts from what they did.
  const frequency: GenerationSetup["frequency"] = [];
  const volume: GenerationSetup["volume"] = [];
  // How often: what the last program did, but at least twice a week for the squat and bench and for
  // the major muscles (and once for the deadlift) when the days allow it: the same weekly sets spread
  // over two sessions build more than one, and a priority never gets less.
  const half = (n: number) => Math.round(n * 2) / 2;
  const isPriority = (t: string) => priorities.some((q) => q.toLowerCase() === t.toLowerCase());
  const floorFor = (t: string, isLift: boolean) => {
    if (isLift) return t === "Deadlift" ? 1 : 2;
    return MAJOR_MUSCLES.test(t) || isPriority(t) ? 2 : 1;
  };
  const often = (t: string, was: number | null, isLift: boolean) => Math.max(1, Math.min(days, Math.max(half(was ?? 0), floorFor(t, isLift))));
  if (STRENGTH_BRAINS.includes(brain)) for (const l of LIFTS) {
    const trained = baseline.liftFreq[l] != null || baseline.liftSets[l] != null;
    if (trained || brain === "powerlifting" || brain === "powerbuilding") frequency.push({ target: LIFT_NAME[l], perWeek: often(LIFT_NAME[l], baseline.liftFreq[l], true) });
    if (baseline.liftSets[l]) volume.push({ target: LIFT_NAME[l], setsPerWeek: Math.round(baseline.liftSets[l] as number) });
  }
  if (brain !== "powerlifting") for (const m of baseline.muscleSets.slice(0, 10)) {
    frequency.push({ target: m.muscle, perWeek: often(m.muscle, m.freq, false) });
    volume.push({ target: m.muscle, setsPerWeek: Math.round(m.sets) });
  }
  why.frequency = { source: "Last program + at least 2×/week", reason: `How often each was trained in the last program, raised to at least twice a week for the squat, bench and major muscles (deadlift once) where ${days} day${days === 1 ? "" : "s"} allow it.`, confidence: prev ? "high" : "low" };
  why.volume = { source: "Last program", reason: "Weekly working sets (lifts) and hard sets (muscles, secondary muscles counted half) in the last program.", confidence: prev ? "high" : "low" };
  let style = prescriptionStyle(prev);
  why.intensity = { source: "Last program", reason: "Its rep ranges and RPE targets.", confidence: prev ? "medium" : "low" };
  why.progression = { source: "Last program", reason: "How its prescriptions were written.", confidence: prev ? "medium" : "low" };
  // A first program starts from evidence-based doses for their framework and level, fitted to their time.
  if (fresh) {
    const dose = startingDose({ brain, level, days, liftingMinutes: sessionMinutes, priorities, maxesOnFile: x.history.lifts.some((l) => l.maxOnFileKg != null) });
    frequency.splice(0, frequency.length, ...dose.frequency);
    volume.splice(0, volume.length, ...dose.volume);
    style = { intensity: dose.intensity, effort: dose.effort, progression: dose.progression };
    const lvl = level ? `a ${LEVEL_LABEL[level]} (Goals & Setup: "${ctx.profile.experience}")` : "a beginner (no experience on file, so the safe start; set it in Goals & Setup if they've trained before)";
    const fitText = dose.fit.scaled
      ? ` Scaled to ${Math.round(dose.fit.scaled * 100)}% to fit ${days} × ${sessionMinutes}-min sessions (about ${dose.fit.fits} working sets a week).`
      : sessionMinutes ? ` Fits ${days} × ${sessionMinutes}-min sessions (about ${dose.fit.needed} of ${dose.fit.fits} working sets a week).` : "";
    why.frequency = { source: "First program", reason: `No training logged yet: each major muscle twice a week${STRENGTH_BRAINS.includes(brain) ? ", the squat and bench twice and the deadlift once" : ""} where ${days} day${days === 1 ? "" : "s"} allow it.`, confidence: "medium" };
    why.volume = { source: "First program", reason: `A starting dose for ${lvl}: weekly hard sets per muscle (secondary muscles count half)${STRENGTH_BRAINS.includes(brain) ? " and working sets per lift" : ""}, a little more for their priorities.${fitText} The next program adjusts it from what they log.`, confidence: "medium" };
    why.intensity = { source: "First program", reason: `Rep ranges for ${lvl} in a ${BRAIN_LABEL[brain].toLowerCase()} program.`, confidence: "medium" };
    why.effort = { source: "First program", reason: "Week 1 a little easier to find their working weights; effort rises from there.", confidence: "medium" };
    why.progression = { source: "First program", reason: `How ${level ? LEVEL_LABEL[level] : "beginner"}s progress best on this kind of program.`, confidence: "medium" };
  }

  const setup: GenerationSetup = {
    brain,
    mainGoal,
    secondaryGoals: secondary,
    daysPerWeek: days,
    trainingDays,
    weeks,
    durationMode: mode,
    startDate: hz.start,
    sessionMinutes,
    maxSessionMinutes,
    blocks,
    priorities,
    equipment: { items: ctx.equipment.items, location: ctx.equipment.location, cableStations: ctx.equipment.cableStations, notes: ctx.equipment.notes, source: ctx.equipment.source, confidence: ctx.equipment.confidence },
    restrictions,
    retain,
    replace,
    meetDate: meet?.date ?? null,
    frequency,
    volume,
    intensity: style.intensity,
    effort: style.effort,
    progression: style.progression,
    specificity: brain === "powerlifting" ? (meet && meet.weeksOut <= 12 ? "High: competition lifts and close variations; specificity rises toward the meet" : "Moderate: competition lifts plus variations that address weak points") : "",
    required: [],
    excluded: [],
    recovery: "",
    preferences: "",
    coachNotes: "",
    newCircumstances: "",
    cardio,
  };
  // keep every value inside what the server's setup check accepts (free text on file can be long)
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  setup.mainGoal = clip(setup.mainGoal, 300);
  setup.secondaryGoals = setup.secondaryGoals.slice(0, 8).map((g) => clip(g, 200));
  setup.priorities = setup.priorities.slice(0, 10).map((g) => clip(g, 60));
  setup.restrictions = setup.restrictions.slice(0, 12).map((g) => clip(g, 300));
  setup.retain = setup.retain.slice(0, 40).map((r) => ({ ...r, name: clip(r.name, 120) }));
  setup.replace = setup.replace.slice(0, 30).map((r) => ({ ...r, name: clip(r.name, 120) }));
  setup.frequency = setup.frequency.slice(0, 24).map((f) => ({ ...f, target: clip(f.target, 60), perWeek: Math.min(7, f.perWeek) }));
  setup.volume = setup.volume.slice(0, 30).map((v) => ({ ...v, target: clip(v.target, 60), setsPerWeek: Math.min(60, v.setsPerWeek) }));
  setup.intensity = clip(setup.intensity, 800);
  setup.effort = clip(setup.effort, 400);
  setup.progression = clip(setup.progression, 600);
  setup.equipment.location = setup.equipment.location ? clip(setup.equipment.location, 120) : null;
  setup.equipment.notes = setup.equipment.notes ? clip(setup.equipment.notes, 600) : null;
  setup.blocks = setup.blocks.map((b) => ({ ...b, name: clip(b.name, 80), objective: clip(b.objective, 400) }));
  why.brain = { source: "Classification", reason: x.brainWhy, confidence: "medium" };
  why.equipment = { source: ctx.equipment.source === "coach" ? "Confirmed by you" : ctx.equipment.source === "program" ? "Last program" : ctx.equipment.source === "goals" ? "Goals & Setup" : "Not on file", reason: ctx.equipment.conflicts[0] ?? (ctx.equipment.evidence.slice(0, 3).join("; ") || (ctx.equipment.source === "goals" ? "What they listed at setup." : ctx.equipment.source === "unknown" ? "Nothing on file: nothing is ruled out." : "")), confidence: ctx.equipment.confidence === "confirmed" ? "high" : ctx.equipment.confidence === "unknown" ? "low" : "medium" };
  return { setup, why, baseline };
}

export type Redistribution = {
  fromDays: number;
  toDays: number;
  weeklySets: number;
  perSessionBefore: number;
  perSessionAfter: number;
  estMinutesBefore: number | null;
  estMinutesAfter: number | null;
  cap: number | null;
  fits: boolean;
  trimToSets: number | null;
  lines: string[];
};

/** What changing the training days does to the workload (the program's weekly dose is kept unless it can't fit). */
export function redistribution(setup: GenerationSetup, baseline: Baseline): Redistribution | null {
  if (!baseline.daysPerWeek || baseline.daysPerWeek === setup.daysPerWeek || !baseline.weeklySets) return null;
  const from = baseline.daysPerWeek;
  const to = setup.daysPerWeek;
  const perBefore = round(baseline.weeklySets / from, 1);
  const perAfter = round(baseline.weeklySets / to, 1);
  const minutesBefore = baseline.estMinutesPerSession;
  // time scales with sets; a session's fixed costs (warm-up, setup) stay
  const fixed = minutesBefore != null ? Math.min(12, minutesBefore * 0.2) : null;
  const minutesAfter = minutesBefore != null && fixed != null ? Math.round(fixed + (minutesBefore - fixed) * (perAfter / perBefore)) : null;
  const cap = setup.maxSessionMinutes ?? setup.sessionMinutes;
  const fits = cap == null || minutesAfter == null || minutesAfter <= cap + 3;
  const trimToSets = !fits && cap != null && minutesBefore != null && fixed != null ? Math.floor((((cap - fixed) / (minutesBefore - fixed)) * perBefore) * to) : null;
  const lines: string[] = [];
  lines.push(`${from} → ${to} days: keeping the last program's ${baseline.weeklySets} sets a week means ${perBefore} → ${perAfter} sets per session${minutesAfter != null ? ` (about ${minutesBefore} → ${minutesAfter} min)` : ""}.`);
  if (!fits && trimToSets != null) lines.push(`That runs past the ${cap}-minute limit. To fit, the week comes down to about ${trimToSets} sets (lowest-priority work first), or allow ${minutesAfter} minutes.`);
  if (to < from) lines.push(`Each lift and muscle keeps its weekly sets where it can; anything trained ${from}×/week has to drop to at most ${to}×, so sessions become ${to <= 3 ? "full-body" : "upper / lower"} and exposures are re-spaced for recovery.`);
  else lines.push(`More days spreads the same weekly dose thinner per session (shorter sessions, or room for more frequency on the priorities).`);
  for (const [l, f] of Object.entries(baseline.liftFreq)) if (f != null && f > to) lines.push(`${LIFT_NAME[l as Lift]} was trained ${f}×/week: at most ${to}× now.`);
  return { fromDays: from, toDays: to, weeklySets: baseline.weeklySets, perSessionBefore: perBefore, perSessionAfter: perAfter, estMinutesBefore: minutesBefore, estMinutesAfter: minutesAfter, cap, fits, trimToSets, lines };
}

export type Conflict = { id: string; severity: "blocker" | "warning"; title: string; detail: string; options: string[] };

/** Requirements that can't all hold, named (never silently resolved). Blockers must be fixed before generating. */
export function findConflicts(setup: GenerationSetup, ctx: AthleteContext, baseline: Baseline, lookup: (ref: ExerciseRef) => { name: string; equipment?: string | null } | null, recommended?: GenerationSetup): Conflict[] {
  const out: Conflict[] = [];
  const key = (r: ExerciseRef) => r.id ?? r.name.toLowerCase();
  for (const r of setup.required) if (setup.excluded.some((e) => key(e) === key(r))) out.push({ id: `req-excl:${key(r)}`, severity: "blocker", title: `${r.name} is both required and excluded`, detail: "Pick one.", options: ["Remove it from Required", "Remove it from Excluded"] });
  for (const r of setup.retain) if (setup.excluded.some((e) => key(e) === key(r))) out.push({ id: `keep-excl:${key(r)}`, severity: "warning", title: `${r.name} is recommended to keep but you excluded it`, detail: "Your exclusion wins; it won't be programmed.", options: [] });
  for (const r of setup.required) if (setup.replace.some((e) => key(e) === key(r))) out.push({ id: `req-repl:${key(r)}`, severity: "warning", title: `${r.name} is required but the records suggest reconsidering it`, detail: "Your requirement wins; the reason it was flagged stays visible.", options: [] });
  const eq = { items: setup.equipment.items, confidence: setup.equipment.confidence };
  for (const r of setup.required) {
    const ex = lookup(r);
    if (!ex) continue;
    const miss = missingEquipment(ex, eq);
    if (miss.length) out.push({ id: `req-eq:${key(r)}`, severity: "blocker", title: `${r.name} needs equipment that isn't in their setup`, detail: `Needs ${miss.map((g) => g.join(" or ")).join(" and ")}.`, options: ["Add the equipment", "Remove the requirement"] });
  }
  const avail = ctx.schedule.availableWeekdays.length;
  if (avail && setup.daysPerWeek > avail) out.push({ id: "days-avail", severity: "warning", title: `${setup.daysPerWeek} days a week but only ${avail} available days on file`, detail: `Available (Goals & Setup${ctx.goals.updatedAt ? `, updated ${ctx.goals.updatedAt.slice(0, 10)}` : ""}): ${ctx.schedule.availableWeekdays.join(", ")}.`, options: [`Train ${avail} days`, "Keep it and update their availability"] });
  if (setup.trainingDays.length && setup.trainingDays.length !== setup.daysPerWeek) out.push({ id: "days-list", severity: "warning", title: `${setup.daysPerWeek} days a week but ${setup.trainingDays.length} training days picked`, detail: `Picked: ${setup.trainingDays.join(", ")}.`, options: ["Match the days to the count"] });
  if (setup.meetDate && setup.meetDate < ctx.today) out.push({ id: "meet-past", severity: "blocker", title: "The meet date is in the past", detail: setup.meetDate, options: ["Clear or fix the meet date"] });
  // the length against the deadlines on file (counted from the program's start): your length wins, the conflict is named
  const hz = setupHorizon(setup, ctx);
  for (const c of hz.conflicts) out.push({ id: c.id, severity: "warning", title: c.title, detail: c.detail, options: c.options });
  if (setup.durationMode === "goal") {
    const now = horizonFor(ctx, "goal", null, setup.startDate);
    if (now.weeks !== setup.weeks) out.push({ id: "goal-moved", severity: "warning", title: `The goal timeline now gives ${now.weeks} weeks, not ${setup.weeks}`, detail: now.recommended.why, options: [`Make it ${now.weeks} weeks`, `Keep ${setup.weeks}`] });
  }
  if (setup.startDate && ctx.schedule.currentEnd && setup.startDate <= ctx.schedule.currentEnd)
    out.push({ id: "start-overlaps", severity: "warning", title: `It starts ${setup.startDate}, before the current program ends (${ctx.schedule.currentEnd})`, detail: "Both programs would have workouts on the same days until then.", options: [`Start after it (${plannedStart(ctx.today, ctx.schedule.currentEnd).date})`, "Keep the date (end the current program yourself)"] });
  const blockWeeks = setup.blocks.reduce((n, b) => n + b.weeks, 0);
  if (setup.blocks.length && blockWeeks !== setup.weeks) out.push({ id: "blocks-weeks", severity: "blocker", title: `The blocks add up to ${blockWeeks} weeks, not ${setup.weeks}`, detail: setup.blocks.map((b) => `${b.name} ${b.weeks}`).join(" + "), options: ["Adjust the blocks", "Reset the blocks to the recommendation"] });
  for (const f of setup.frequency) if (f.perWeek > setup.daysPerWeek) out.push({ id: `freq:${f.target}`, severity: "warning", title: `${f.target} ${f.perWeek}×/week is more than ${setup.daysPerWeek} training days`, detail: "It will be capped at one exposure per day.", options: [`${f.target} ${setup.daysPerWeek}×/week`] });
  // A first program comes from what they told you at setup: say what's missing from it.
  if (ctx.firstProgram) {
    if (!ctx.goals.onFile)
      out.push({ id: "first-no-setup", severity: "warning", title: "No training logged and no Goals & Setup on file", detail: `This program would come from defaults: ${setup.daysPerWeek} days, ${setup.sessionMinutes ?? "no"}-minute sessions, ${setup.equipment.items.length ? "the equipment set here" : "any equipment"}. Ask them to fill in Goals & Setup, or set the days, session length and equipment here and tell it what you know in Notes & ideas.`, options: ["Send them Goals & Setup", "Set it here and add notes"] });
    else if (!ctx.profile.level)
      out.push({ id: "first-no-experience", severity: "warning", title: "How long they've trained isn't on file", detail: "It starts them as a beginner (easier first weeks, simpler exercises, less volume). If they've trained before, set their experience in Goals & Setup or say so in Notes & ideas.", options: ["Keep the beginner start", "Add their experience"] });
    if (setup.equipment.confidence === "unknown")
      out.push({ id: "first-no-equipment", severity: "warning", title: "Their equipment isn't on file", detail: "Nothing rules an exercise out, so it may pick something they don't have. Set their equipment (Edit) or describe the gym in Notes & ideas.", options: ["Set their equipment"] });
  }
  const ptMin = ctx.session.ptMinutes ?? null;
  const walk = setup.cardio?.trainingDay?.minutes ?? 0;
  if (ptMin && walk > ptMin / 4) {
    const keep = Math.max(10, Math.round(ptMin / 6 / 5) * 5);
    out.push({
      id: "pt-cardio",
      severity: "warning",
      title: `The ${walk}-min cardio after lifting takes ${Math.round((walk / ptMin) * 100)}% of their ${ptMin}-min PT session`,
      detail: `That leaves about ${ptMin - walk} minutes to warm up and lift. Cut the after-workout cardio to ${keep} min in their cardio plan and add the rest to their days off: the week's cardio stays the same and the session gets the time.`,
      options: [`${keep} min after lifting, the rest on days off (in their cardio plan)`, "Keep it"],
    });
  }
  if (setup.sessionMinutes && setup.maxSessionMinutes && setup.sessionMinutes > setup.maxSessionMinutes) out.push({ id: "minutes", severity: "warning", title: `Target session ${setup.sessionMinutes} min is over the ${setup.maxSessionMinutes}-min maximum`, detail: "", options: [] });
  const red = redistribution(setup, baseline);
  if (red && !red.fits) out.push({ id: "redistribution", severity: "warning", title: `The last program's volume won't fit ${setup.daysPerWeek} sessions of ${red.cap} min`, detail: red.lines.join(" "), options: [`Trim to about ${red.trimToSets} sets a week (lowest priority first)`, `Allow ${red.estMinutesAfter}-minute sessions`] });
  if (recommended) {
    const jumps = setup.volume
      .map((v) => ({ v, was: recommended.volume.find((r) => r.target === v.target)?.setsPerWeek ?? null }))
      .filter((x) => x.was != null && x.v.setsPerWeek >= (x.was as number) * 1.3 && x.v.setsPerWeek - (x.was as number) >= 3);
    if (jumps.length) out.push({ id: "volume-up", severity: "warning", title: `Weekly volume raised well above the last program: ${jumps.map((x) => `${x.v.target} ${x.was} → ${x.v.setsPerWeek}`).join(", ")}`, detail: "Make sure that's intended; the audit checks that sessions still fit and flags big jumps.", options: [] });
  }
  return out;
}
