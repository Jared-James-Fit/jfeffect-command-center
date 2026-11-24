/**
 * Everything the engines say about one competition, put together (pure,
 * tested): the forecast, the field, the attempts, the warm-ups, the day, what
 * to watch, whether a call is worth it, what's been learned about the athlete
 * and what's still missing. The Competition tab shows it live; each milestone
 * keeps a copy as its assessment's numbers, and Cleo's write-up is checked
 * against it (grounding.ts).
 */
import { planAttempts, type AttemptPlan } from "./attempts";
import { recommendCall, type CallRecommendation } from "./call";
import { readCompetitor, type CompetitorRead } from "./competitor";
import { forecastMeet, type ConversionPoint, type Forecast, type LiftEvidence } from "./forecast";
import { planGameDay, type DayStep } from "./gameday";
import { buildLandscape, type Landscape } from "./landscape";
import { competitionProfile, type CompetitionProfile, type ForecastCheck } from "./learning";
import { attemptStats } from "./meet-stats";
import { currentMilestone, daysBetween, phaseFor, type Phase } from "./milestones";
import type { FederationRules } from "./rules";
import type {
  Lift,
  MeetLevel,
  MeetRecord,
  MilestoneKind,
  Objective,
  Observation,
  Range,
} from "./types";
import { planWarmups, type WarmupHistory, type WarmupPlan } from "./warmups";
import { watchList, type WatchInput, type WatchItem } from "./watch";

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

export type CompetitionFacts = {
  id: string;
  name: string;
  meetDate: string;
  meetEndDate: string | null;
  federation: string | null;
  division: string | null;
  weightClass: string | null;
  level: MeetLevel | null;
  objective: Objective | null;
  targetTotal: number | null;
  targetPlace: number | null;
  qualificationTotal: number | null;
  recordsNote: string | null;
  registration: "registered" | "not_registered" | "unknown";
  liftingStart: string | null;
  weighInAt: string | null;
  flight: string | null;
  location: string | null;
  rules: FederationRules;
  /** the athlete's own stated goal total, when they gave one (the competition form) */
  athleteGoalTotal: number | null;
};

export type BriefContext = {
  today: string;
  milestone: MilestoneKind | null;
  competition: CompetitionFacts;
  athlete: {
    name: string;
    firstName: string;
    sex: "M" | "F" | null;
    bodyweightAvg: number | null;
    bodyweightTrendPerWeek: number | null;
    classLimit: number | null;
  };
  lifts: Record<Lift, LiftEvidence>;
  meets: MeetRecord[];
  conversion: ConversionPoint[];
  warmups: Partial<Record<Lift, WarmupHistory>>;
  topSingles: Partial<Record<Lift, number | null>>;
  competitors: Array<{
    id: string;
    name: string;
    meets: MeetRecord[];
    observations: Observation[];
    identity: string;
    /** suggested (found by research, not confirmed), confirmed, registered (on a start list) */
    status?: "suggested" | "confirmed" | "registered";
  }>;
  watch: Omit<
    WatchInput,
    | "daysOut"
    | "meetDate"
    | "bodyweightAvg"
    | "bodyweightTrendPerWeek"
    | "classLimit"
    | "expectedTotal"
    | "targetTotal"
    | "missing"
  >;
  call: {
    lastCallDaysAgo: number | null;
    upcomingCallOn: string | null;
    includedCallsLeft: number | null;
    packageName: string | null;
  };
  previous: { expectedTotal: number | null } | null;
  checks: ForecastCheck[];
  cues: Partial<Record<Lift, string[]>>;
  /** each competition lift's training days in the last 12 weeks (newest first): the evidence Cleo reads */
  sessions?: Partial<Record<Lift, TrainingDay[]>>;
  /** an adjacent class's field when the athlete is well over their limit (research.server.ts) */
  classOptions?: ClassOption[];
};

export type ClassOption = {
  weightClass: string;
  lifters: Array<{ name: string; total: number; date: string }>;
  ourPlace: number | null;
  reason: string;
};

/** One training day of a competition lift: its most telling set, as the strength line read it. */
export type TrainingDay = {
  day: string;
  kg: number;
  reps: number;
  rpe: number | null;
  /** estimated max from this set (kg) */
  e1rm: number;
  confidence: "high" | "medium" | "low";
  /** heaviest load moved that day (kg) */
  heaviestKg: number;
  velocity: number | null;
};

export type MissingInfo = {
  essential: string[];
  improves: string[];
  optional: string[];
  retrieved: string[];
};

export type Brief = {
  today: string;
  milestone: MilestoneKind | null;
  phase: Phase;
  daysOut: number;
  competition: CompetitionFacts;
  forecast: Forecast;
  competitors: Array<{
    id: string;
    name: string;
    identity: string;
    read: CompetitorRead;
    status: "suggested" | "confirmed" | "registered";
  }>;
  landscape: Landscape;
  attempts: AttemptPlan;
  warmups: Record<Lift, WarmupPlan | null>;
  gameDay: DayStep[];
  watch: WatchItem[];
  call: CallRecommendation;
  profile: CompetitionProfile;
  missing: MissingInfo;
  /** the expected total moved since the last assessment, as a share */
  projectionShift: number | null;
  /** an adjacent class's field, when the class is a question */
  classOptions: ClassOption[];
  /** what the plan was built from, so a checked change from Cleo can rebuild it (proposals.ts) */
  inputs: {
    history: ReturnType<typeof attemptStats>;
    topSingles: Partial<Record<Lift, number | null>>;
    warmups: Partial<Record<Lift, WarmupHistory>>;
    sessions: Partial<Record<Lift, TrainingDay[]>>;
    meets: MeetRecord[];
    bodyweightAvg: number | null;
    bodyweightTrendPerWeek: number | null;
    classLimit: number | null;
    conversion: ConversionPoint[];
    watchFacts: BriefContext["watch"];
  };
};

export function missingInfo(ctx: BriefContext): MissingInfo {
  const c = ctx.competition;
  const essential: string[] = [];
  const improves: string[] = [];
  const optional: string[] = [];
  const retrieved: string[] = [];
  if (!c.weightClass) essential.push("Weight class");
  if (!c.federation) essential.push("Federation");
  if (!c.objective) essential.push("The objective (win, podium, qualify, best total…)");
  if (c.objective === "qualify" && !c.qualificationTotal) essential.push("The qualifying total");
  if (!ctx.competitors.length && (c.objective === "win" || c.objective === "podium"))
    essential.push("Competitors: placing is the objective and nobody's on file");
  if (!ctx.competitors.length && c.objective !== "win" && c.objective !== "podium")
    improves.push("Competitors (for placing and threats)");
  if (!c.targetTotal) improves.push("A target total");
  if (c.registration === "unknown") improves.push("Whether they're registered");
  if (!c.rules.confirmed)
    improves.push("The meet's rules confirmed (increments, tie-break, weigh-in)");
  if (!c.liftingStart && daysBetween(ctx.today, c.meetDate) <= 21)
    improves.push("The lifting schedule and flight");
  if (ctx.athlete.bodyweightAvg == null && c.weightClass) improves.push("Recent weigh-ins");
  if (ctx.competitors.some((x) => x.identity === "ambiguous"))
    improves.push("Which OpenPowerlifting profile is the right competitor");
  if (!ctx.competitors.some((x) => x.observations.length))
    optional.push("Competitors' recent training (posts, videos, captions)");
  if (!c.location) optional.push("Venue");
  if (ctx.meets.length)
    retrieved.push(
      `${ctx.meets.length} past meet${ctx.meets.length === 1 ? "" : "s"} from their record`,
    );
  const hard = LIFTS.reduce((s, l) => s + (ctx.lifts[l]?.hardSessions6w ?? 0), 0);
  if (hard) retrieved.push(`${hard} hard competition-lift sessions in the last 6 weeks`);
  if (ctx.athlete.bodyweightAvg)
    retrieved.push(`Bodyweight: ${ctx.athlete.bodyweightAvg} kg (7-day average)`);
  const synced = ctx.competitors.filter((x) => x.meets.length).length;
  if (synced)
    retrieved.push(`${synced} competitor record${synced === 1 ? "" : "s"} from OpenPowerlifting`);
  return { essential, improves, optional, retrieved };
}

export function buildBrief(ctx: BriefContext): Brief {
  const c = ctx.competition;
  const daysOut = daysBetween(ctx.today, c.meetDate);
  const meetDays = c.meetEndDate ? Math.max(1, daysBetween(c.meetDate, c.meetEndDate) + 1) : 1;
  const missing = missingInfo(ctx);

  // concerns first (they lower the conservative scenario), then the forecast
  const pre = watchList({
    ...ctx.watch,
    daysOut,
    meetDate: c.meetDate,
    bodyweightAvg: ctx.athlete.bodyweightAvg,
    bodyweightTrendPerWeek: ctx.athlete.bodyweightTrendPerWeek,
    classLimit: ctx.athlete.classLimit,
    expectedTotal: null,
    targetTotal: c.targetTotal,
    missing: [],
  });
  const forecast = forecastMeet({
    today: ctx.today,
    meetDate: c.meetDate,
    lifts: ctx.lifts,
    meets: ctx.meets,
    conversion: ctx.conversion,
    concerns: pre.filter((w) => w.area === "pain" || w.area === "recovery"),
    increment: c.rules.incrementKg,
  });
  const watch = watchList({
    ...ctx.watch,
    daysOut,
    meetDate: c.meetDate,
    bodyweightAvg: ctx.athlete.bodyweightAvg,
    bodyweightTrendPerWeek: ctx.athlete.bodyweightTrendPerWeek,
    classLimit: ctx.athlete.classLimit,
    expectedTotal: forecast.total?.expected ?? null,
    targetTotal: c.targetTotal,
    missing: missing.essential,
  });

  const competitors = ctx.competitors.map((x) => ({
    id: x.id,
    name: x.name,
    identity: x.identity,
    read: readCompetitor({
      meets: x.meets,
      today: ctx.today,
      meetDate: c.meetDate,
      observations: x.observations,
      increment: c.rules.incrementKg,
      meetClassLimitKg: ctx.athlete.classLimit,
      classic: c.rules.family === "ipf",
    }),
    status: x.status ?? "confirmed",
  }));
  const liftRanges = Object.fromEntries(
    LIFTS.map((l) => [l, forecast.lifts[l]?.range ?? null]),
  ) as Record<Lift, Range | null>;
  const landscape = buildLandscape({
    athlete: {
      total: forecast.total,
      lifts: liftRanges,
      bestMeetTotal: forecast.bestMeetTotal?.kg ?? null,
      confidence: forecast.confidence,
    },
    competitors,
    objective: c.objective,
    qualificationTotal: c.qualificationTotal,
    targetPlace: c.targetPlace,
    increment: c.rules.incrementKg,
  });
  const history = attemptStats(ctx.meets);
  const attempts = planAttempts({
    lifts: liftRanges,
    rules: c.rules,
    history,
    objective: c.objective,
    recentTopSingles: ctx.topSingles,
  });
  const warmups = Object.fromEntries(
    LIFTS.map((l) => {
      const a = attempts.lifts[l];
      return [
        l,
        a
          ? planWarmups({
              lift: l,
              openerKg: a.opener,
              history: ctx.warmups[l] ?? null,
              step: c.rules.incrementKg,
            })
          : null,
      ];
    }),
  ) as Record<Lift, WarmupPlan | null>;
  const gameDay = planGameDay({
    rules: c.rules,
    liftingStart: c.liftingStart,
    weighInAt: c.weighInAt,
    flight: c.flight,
    makingWeight: watch.some((w) => w.key === "bodyweight:over"),
    cues: ctx.cues,
  });
  const projectionShift =
    ctx.previous?.expectedTotal && forecast.total
      ? Math.round(
          ((forecast.total.expected - ctx.previous.expectedTotal) / ctx.previous.expectedTotal) *
            1000,
        ) / 1000
      : null;
  const call = recommendCall({
    milestone: ctx.milestone ?? currentMilestone(daysOut) ?? "update",
    level: c.level,
    firstMeet: ctx.meets.length === 0,
    objective: c.objective,
    closeField: !!landscape.biggest?.overlaps,
    qualificationOnLine:
      !!landscape.qualification && !landscape.qualification.reachableConservative,
    weightClassUndecided: !c.weightClass,
    projectionShift,
    concerns: watch.filter((w) => w.severity !== "watch").length,
    expectationGap:
      c.athleteGoalTotal && forecast.total
        ? (c.athleteGoalTotal - forecast.total.expected) / forecast.total.expected
        : null,
    complexAttempts:
      (c.objective === "win" || c.objective === "podium") && !!landscape.biggest?.overlaps,
    ...ctx.call,
  });
  const profile = competitionProfile({
    meets: ctx.meets,
    conversion: ctx.conversion,
    checks: ctx.checks,
    warmups: ctx.warmups,
  });
  return {
    today: ctx.today,
    milestone: ctx.milestone,
    phase: phaseFor(daysOut, meetDays),
    daysOut,
    competition: c,
    forecast,
    competitors,
    landscape,
    attempts,
    warmups,
    gameDay,
    watch,
    call,
    profile,
    missing,
    projectionShift,
    classOptions: ctx.classOptions ?? [],
    inputs: {
      history,
      topSingles: ctx.topSingles,
      warmups: ctx.warmups,
      sessions: ctx.sessions ?? {},
      meets: ctx.meets.slice(0, 12),
      bodyweightAvg: ctx.athlete.bodyweightAvg,
      bodyweightTrendPerWeek: ctx.athlete.bodyweightTrendPerWeek,
      classLimit: ctx.athlete.classLimit,
      conversion: ctx.conversion,
      watchFacts: ctx.watch,
    },
  };
}

/** One line for a notification and the overview: the most important thing in the brief. */
export function headline(b: Brief): string {
  const top = b.watch.find((w) => w.severity === "serious");
  if (top) return top.text;
  if (b.landscape.overestimate)
    return "The expected total leans on thin evidence: check it before building strategy on it";
  if (b.forecast.total && b.projectionShift != null && Math.abs(b.projectionShift) >= 0.02)
    return `Projected total ${b.projectionShift > 0 ? "up" : "down"} to ${b.forecast.total.expected} kg (${b.forecast.total.conservative}–${b.forecast.total.high})`;
  if (b.landscape.biggest && b.landscape.biggest.overlaps)
    return `${b.landscape.biggest.name} is the threat: expected ${b.landscape.biggest.expected} kg against our ${b.forecast.total?.expected ?? "—"}`;
  if (b.forecast.total)
    return `Projected total ${b.forecast.total.expected} kg (${b.forecast.total.conservative}–${b.forecast.total.high})`;
  const w = b.watch[0];
  return w ? w.text : "Not enough training or meet data for a projection yet";
}

/** How urgent the brief is for the coach. */
export function urgency(b: Brief): "routine" | "attention" | "urgent" {
  if (
    b.watch.some(
      (w) =>
        w.severity === "serious" &&
        (w.area === "pain" || w.area === "bodyweight" || w.area === "program"),
    )
  )
    return "urgent";
  if (
    b.watch.some((w) => w.severity !== "watch") ||
    (b.projectionShift != null && Math.abs(b.projectionShift) >= 0.03) ||
    b.call.recommend
  )
    return "attention";
  return "routine";
}
