/**
 * Treadmill cardio, prescribed for the person instead of one setting for
 * everyone. The energy cost is the ACSM walking equation (VO2 = 0.1·S +
 * 1.8·S·G + 3.5 ml/kg/min, S in m/min, G the grade), which is valid for
 * walking at 1.9–3.7 mph: a heavier person already burns more at the same
 * setting, so they don't need the incline a lighter one does. The dose is the
 * smallest that does the job for the goal: most of it on days off, a short
 * easy walk after lifting on training days (never before), and for a
 * powerlifter nothing long or steep the day before a heavy squat or deadlift
 * day or close to a meet, since incline walking loads the same hips, calves
 * and lower back. Progression changes one thing at a time (duration, then how
 * often, then incline, then speed) and comes down incline first when it's
 * costing training. A coach's own non-treadmill plan is never switched to a
 * treadmill: only its time and frequency move. Pure, tested.
 */
import { round, fmtSpeed, treadmillSpeedMph, type SpeedUnit } from "@/lib/weight-management/units";

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const M_PER_MIN_PER_MPH = 26.8224;

export type CardioGoal = "fat_loss" | "contest" | "recomp" | "maintain" | "performance" | "gain";

/** Weekly treadmill minutes that do the job for each goal before steps are counted. */
export const WEEKLY_MINUTES: Record<CardioGoal, number> = {
  fat_loss: 90,
  contest: 120,
  recomp: 60,
  maintain: 45,
  performance: 40,
  gain: 40,
};

export const SPEED_MIN_MPH = 2.2;
/** Above about 3.7 mph walking stops being economical and turns into a jog. */
export const SPEED_MAX_MPH = 3.6;
export const INCLINE_CAP = 8;
/** Incline when the knees, ankles, hips or back are an issue, and for a powerlifter within 4 weeks of a meet. */
export const INCLINE_CAP_CAREFUL = 3;
export const REST_MINUTES_MAX = 45;
export const TRAIN_MINUTES_MAX = 20;
/** After lifting, a powerlifter's walk stays short and flat-ish: it's every training day, heavy ones included. */
export const TRAIN_MINUTES_MAX_PL = 15;
export const TRAIN_INCLINE_MAX_PL = 4;

export type TreadmillSession = { minutes: number; speedMph: number; inclinePct: number; perWeek: number; weekdays: string[] };

export type TreadmillInput = {
  goal: CardioGoal;
  bodyweightKg: number | null;
  heightCm?: number | null;
  age?: number | null;
  level?: "beginner" | "intermediate" | "advanced" | null;
  unit: SpeedUnit;
  trainingDays: string[];
  /** Weekdays with a heavy squat or deadlift. */
  heavyLowerDays?: string[];
  powerlifter?: boolean;
  meetWeeksOut?: number | null;
  /** Active injuries that walking loads: knee, ankle, achilles, foot, shin, hip, back. */
  jointLimits?: string[];
  /** What they've actually been doing (last 4 weeks of logged treadmill sessions). */
  history?: { speedMph: number | null; inclinePct: number | null; avgRpe: number | null; sessions: number } | null;
  dailySteps?: number | null;
  /** Longest session they have time for. */
  availableMinutes?: number | null;
  /** The treadmill's own top incline. */
  maxIncline?: number | null;
  /** Weekly minutes asked for (the decision engine), else the goal's. */
  weeklyMinutes?: number | null;
};

export type TreadmillPlan = {
  modality: "treadmill";
  title: string;
  unit: SpeedUnit;
  trainingDay: TreadmillSession | null;
  restDay: TreadmillSession | null;
  intensity: string;
  heartRate: { low: number; high: number } | null;
  weeklyMinutes: number;
  weeklyNetKcal: number | null;
  placement: string[];
  why: string[];
  caps: Caps;
};

type Caps = { maxIncline: number; maxSpeedMph: number; restMax: number; trainMax: number; trainInclineMax: number };

const round5 = (n: number) => Math.round(n / 5) * 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const norm = (d: string) => WEEK.find((w) => w.toLowerCase() === String(d ?? "").trim().toLowerCase()) ?? null;
const ordered = (days: string[]) => WEEK.filter((w) => days.some((d) => norm(d) === w));

/** Net energy (kcal a minute, above resting) of walking at a speed and grade: the ACSM walking equation. */
export function walkingNetKcalPerMin(speedMph: number, inclinePct: number, kg: number): number {
  const s = speedMph * M_PER_MIN_PER_MPH;
  const vo2Net = 0.1 * s + 1.8 * s * (inclinePct / 100);
  return (vo2Net * kg * 5) / 1000;
}

/** A session's net kcal, rounded to 10: an estimate, never a number to eat back. */
export function sessionNetKcal(s: Pick<TreadmillSession, "minutes" | "speedMph" | "inclinePct">, kg: number | null): number | null {
  if (!kg || kg <= 0) return null;
  return Math.round((walkingNetKcalPerMin(s.speedMph, s.inclinePct, kg) * s.minutes) / 10) * 10;
}

const CAREFUL_AREA = /knee|ankle|achilles|foot|feet|plantar|shin|hip|back|lumbar|si joint|calf/i;

/** Which of their injuries walking on an incline would aggravate. */
export function walkingLimits(injuries: Array<string | null | undefined>): string[] {
  return [...new Set(injuries.map((s) => String(s ?? "").trim()).filter((s) => s && CAREFUL_AREA.test(s)))];
}

function capsFor(x: TreadmillInput): Caps {
  const careful = (x.jointLimits?.length ?? 0) > 0 || (x.powerlifter && x.meetWeeksOut != null && x.meetWeeksOut <= 4);
  const equip = x.maxIncline != null && x.maxIncline > 0 ? x.maxIncline : INCLINE_CAP;
  const maxIncline = Math.min(equip, careful ? INCLINE_CAP_CAREFUL : INCLINE_CAP);
  const avail = x.availableMinutes && x.availableMinutes > 0 ? x.availableMinutes : REST_MINUTES_MAX;
  return {
    maxIncline,
    maxSpeedMph: (x.jointLimits?.length ?? 0) > 0 ? 3.2 : SPEED_MAX_MPH,
    restMax: Math.min(REST_MINUTES_MAX, Math.max(15, avail)),
    trainMax: Math.min(x.powerlifter ? TRAIN_MINUTES_MAX_PL : TRAIN_MINUTES_MAX, Math.max(10, avail)),
    trainInclineMax: Math.min(maxIncline, x.powerlifter ? TRAIN_INCLINE_MAX_PL : maxIncline),
  };
}

/** The day before each heavy lower day. */
function daysBeforeHeavy(heavy: string[]): Set<string> {
  const out = new Set<string>();
  for (const h of heavy) {
    const i = WEEK.findIndex((w) => w === norm(h));
    if (i >= 0) out.add(WEEK[(i + 6) % 7]);
  }
  return out;
}

/** Rest days to walk on: spread out, and for a powerlifter not the day before a heavy squat / deadlift day when there's a choice. */
export function pickRestDays(trainingDays: string[], count: number, heavyLowerDays: string[] = []): string[] {
  const train = new Set(ordered(trainingDays));
  const off = WEEK.filter((d) => !train.has(d));
  if (count <= 0 || !off.length) return [];
  if (count >= off.length) return [...off];
  const before = daysBeforeHeavy(heavyLowerDays);
  const pool = [...off].sort((a, b) => Number(before.has(a)) - Number(before.has(b)));
  // spread: take every k-th of the preferred pool, then fill
  const preferred = pool.filter((d) => !before.has(d));
  const pick: string[] = [];
  const src = preferred.length >= count ? preferred : pool;
  const step = src.length / count;
  for (let i = 0; i < count; i++) pick.push(src[Math.floor(i * step)]);
  return ordered([...new Set(pick)]).slice(0, count);
}

/**
 * The starting prescription. Their own recent settings win (what they can
 * already do comfortably), else a moderate walk adjusted for height,
 * bodyweight, conditioning and joints.
 */
export function prescribeTreadmill(x: TreadmillInput): TreadmillPlan {
  const caps = capsFor(x);
  const why: string[] = [];
  const h = x.history && x.history.sessions >= 3 ? x.history : null;
  const kg = x.bodyweightKg ?? null;
  const heavyBody = kg != null && (kg >= 120 || (x.heightCm ? kg / (x.heightCm / 100) ** 2 >= 35 : false));
  const lowActivity = x.dailySteps != null && x.dailySteps < 5000;

  // speed
  let speed = 3.0;
  if (h?.speedMph) {
    speed = h.speedMph;
    why.push(`Speed from their own recent sessions (${h.sessions} logged).`);
  } else {
    if (x.heightCm && x.heightCm >= 185) speed += 0.2;
    if (x.heightCm && x.heightCm < 160) speed -= 0.2;
    if (heavyBody) speed -= 0.2;
    if (lowActivity || x.level === "beginner") speed -= 0.2;
  }
  if ((x.jointLimits?.length ?? 0) > 0) speed = Math.min(speed, 3.0);
  speed = treadmillSpeedMph(clamp(speed, SPEED_MIN_MPH, caps.maxSpeedMph), x.unit);

  // incline
  let incline = 5;
  if (h?.inclinePct != null) {
    incline = h.inclinePct - (h.avgRpe != null && h.avgRpe >= 7 ? 1 : 0);
    why.push(`Incline from what they've been doing${h.avgRpe != null && h.avgRpe >= 7 ? ", a point lower since it's been rated hard" : ""}.`);
  } else if (heavyBody || lowActivity || x.level === "beginner") {
    incline = 3;
    why.push(heavyBody ? "Lower incline: at their bodyweight the walk already costs more energy." : "Lower incline to start: they're new to it, so it builds from here.");
  }
  if ((x.jointLimits?.length ?? 0) > 0) why.push(`Incline kept to ${caps.maxIncline}% for their ${x.jointLimits!.join(", ").toLowerCase()}.`);
  if (x.powerlifter && x.meetWeeksOut != null && x.meetWeeksOut <= 4) why.push(`Incline kept to ${caps.maxIncline}% with the meet ${x.meetWeeksOut} weeks out.`);
  incline = clamp(Math.round(incline), 0, caps.maxIncline);

  // dose
  const taper = !!x.powerlifter && x.meetWeeksOut != null && x.meetWeeksOut <= 2;
  let weekly = x.weeklyMinutes != null && x.weeklyMinutes >= 0 ? x.weeklyMinutes : WEEKLY_MINUTES[x.goal];
  if (x.weeklyMinutes == null && x.dailySteps != null && x.dailySteps >= 10000) {
    weekly = round5(weekly * 0.7);
    why.push(`Less cardio: they already average ${Math.round(x.dailySteps).toLocaleString("en-US")} steps a day.`);
  }
  if (taper) {
    weekly = Math.min(weekly, 40);
    incline = Math.min(incline, INCLINE_CAP_CAREFUL);
    why.push("Meet week or the one before: easy walks only, so the legs are fresh.");
  }

  const train = ordered(x.trainingDays);
  const heavy = ordered(x.heavyLowerDays ?? []);
  const trainEach = train.length && !taper ? (x.goal === "fat_loss" || x.goal === "contest" ? 15 : x.goal === "recomp" ? 10 : 0) : 0;
  const trainMinutes = Math.min(trainEach, caps.trainMax);
  const restWeekly = Math.max(0, weekly - trainMinutes * train.length);
  const offDays = WEEK.length - train.length;
  const maxRestSessions = Math.min(offDays, x.goal === "contest" ? 4 : 3);
  let restCount = restWeekly > 0 ? Math.min(maxRestSessions, Math.max(1, Math.ceil(restWeekly / 35))) : 0;
  let restMinutes = restCount ? clamp(round5(restWeekly / restCount), 20, caps.restMax) : 0;
  if (restCount && restMinutes * restCount < restWeekly - 5 && restCount < maxRestSessions) {
    restCount += 1;
    restMinutes = clamp(round5(restWeekly / restCount), 20, caps.restMax);
  }
  // no days off and nothing after lifting: put it after lifting
  let trainingDayMinutes = trainMinutes;
  if (!restCount && !trainingDayMinutes && train.length && weekly > 0) trainingDayMinutes = Math.min(caps.trainMax, Math.max(10, round5(weekly / train.length)));

  const trainingDay: TreadmillSession | null = trainingDayMinutes
    ? { minutes: trainingDayMinutes, speedMph: speed, inclinePct: Math.min(incline, caps.trainInclineMax), perWeek: train.length, weekdays: train }
    : null;
  const restDays = restCount ? pickRestDays(train, restCount, heavy) : [];
  const restDay: TreadmillSession | null = restDays.length ? { minutes: restMinutes, speedMph: speed, inclinePct: incline, perWeek: restDays.length, weekdays: restDays } : null;

  const placement: string[] = [];
  if (trainingDay) placement.push(`After lifting on training days (${trainingDay.minutes} min${x.powerlifter ? ", kept easy since it follows heavy days too" : ""}), never before.`);
  if (restDay) placement.push(`On ${restDay.weekdays.join(", ")}${heavy.length ? ", away from the day before heavy squat or deadlift days" : ""}.`);
  if (heavy.length && x.powerlifter) placement.push(`Heavy lower days (${heavy.join(", ")}): lift first, walk after, and skip it if the legs are cooked.`);

  const kgNet = (s: TreadmillSession | null) => (s ? (sessionNetKcal(s, kg) ?? 0) * s.perWeek : 0);
  const weeklyNetKcal = kg ? kgNet(trainingDay) + kgNet(restDay) : null;
  const heartRate = x.age && x.age > 12 && x.age < 90 ? zone2(x.age) : null;
  return {
    modality: "treadmill",
    title: incline >= 2 ? "Treadmill — Incline Walking" : "Treadmill — Walking",
    unit: x.unit,
    trainingDay,
    restDay,
    intensity: "Easy to moderate: RPE 3–4 out of 10, breathing harder but you can still talk in full sentences",
    heartRate,
    weeklyMinutes: (trainingDay ? trainingDay.minutes * trainingDay.perWeek : 0) + (restDay ? restDay.minutes * restDay.perWeek : 0),
    weeklyNetKcal,
    placement,
    why,
    caps,
  };
}

/** Easy aerobic work: 60–70% of an age-predicted max heart rate (208 − 0.7 × age, Tanaka 2001). An estimate. */
export function zone2(age: number): { low: number; high: number } {
  const max = 208 - 0.7 * age;
  return { low: Math.round(max * 0.6), high: Math.round(max * 0.7) };
}

/* ------------------------------------------------------------------------ */
/* Progression and regression                                                */

export type CardioVariable = "minutes" | "frequency" | "incline" | "speed" | "added" | "removed" | "none";
export type CardioStep = {
  variable: CardioVariable;
  session: "trainingDay" | "restDay" | null;
  from: number | null;
  to: number | null;
  /** Change in the week's net kcal (estimate). */
  weeklyNetKcal: number | null;
  why: string;
};

export type StepContext = {
  bodyweightKg: number | null;
  trainingDays: string[];
  heavyLowerDays?: string[];
  powerlifter?: boolean;
  meetWeeksOut?: number | null;
  jointLimits?: string[];
  maxIncline?: number | null;
  availableMinutes?: number | null;
  unit: SpeedUnit;
  /** False for a coach's bike, stairs or outdoor walk: only its time and frequency ever move. */
  treadmill?: boolean;
};

type Plan = { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null };

const weekKcal = (p: Plan, kg: number | null) =>
  kg ? (["trainingDay", "restDay"] as const).reduce((n, k) => n + (p[k] ? (sessionNetKcal(p[k]!, kg) ?? 0) * p[k]!.perWeek : 0), 0) : null;

/**
 * One controlled change, never several at once. Up: longer days-off walks,
 * then another one, then a longer walk after lifting, then incline, then
 * speed. Down: incline first (what costs the legs most), then the walk after
 * lifting, then the days-off walks, then one fewer.
 */
export function stepTreadmill(plan: Plan, direction: "up" | "down", ctx: StepContext): { plan: Plan; step: CardioStep } {
  const caps = capsFor({ goal: "fat_loss", bodyweightKg: ctx.bodyweightKg, unit: ctx.unit, trainingDays: ctx.trainingDays, powerlifter: ctx.powerlifter, meetWeeksOut: ctx.meetWeeksOut, jointLimits: ctx.jointLimits, maxIncline: ctx.maxIncline, availableMinutes: ctx.availableMinutes });
  const treadmill = ctx.treadmill !== false;
  const before = weekKcal(plan, ctx.bodyweightKg);
  const next: Plan = { trainingDay: plan.trainingDay ? { ...plan.trainingDay } : null, restDay: plan.restDay ? { ...plan.restDay, weekdays: [...plan.restDay.weekdays] } : null };
  const done = (variable: CardioVariable, session: CardioStep["session"], from: number | null, to: number | null, why: string) => {
    const after = weekKcal(next, ctx.bodyweightKg);
    return { plan: next, step: { variable, session, from, to, weeklyNetKcal: before != null && after != null ? after - before : null, why } };
  };
  const train = ordered(ctx.trainingDays);
  const nearMeet = !!ctx.powerlifter && ctx.meetWeeksOut != null && ctx.meetWeeksOut <= 6;

  if (direction === "up") {
    const r = next.restDay;
    if (r && r.minutes < caps.restMax) {
      const from = r.minutes;
      r.minutes = Math.min(caps.restMax, from + 5);
      return done("minutes", "restDay", from, r.minutes, `Days-off walks ${from} → ${r.minutes} min: more time is the cheapest change for recovery.`);
    }
    const off = WEEK.filter((d) => !train.includes(d));
    if (r && r.weekdays.length < Math.min(off.length, 4)) {
      const from = r.perWeek;
      const days = pickRestDays(train, from + 1, ctx.heavyLowerDays ?? []);
      r.weekdays = days;
      r.perWeek = days.length;
      if (r.perWeek > from) return done("frequency", "restDay", from, r.perWeek, `One more days-off walk (${from} → ${r.perWeek} a week).`);
    }
    if (!r && off.length) {
      const base = next.trainingDay ?? { minutes: 20, speedMph: 3.0, inclinePct: Math.min(5, caps.maxIncline), perWeek: 0, weekdays: [] };
      next.restDay = { minutes: 20, speedMph: base.speedMph, inclinePct: Math.min(base.inclinePct + 1, caps.maxIncline), perWeek: 1, weekdays: pickRestDays(train, 1, ctx.heavyLowerDays ?? []) };
      return done("added", "restDay", 0, 1, "A 20-min walk on a day off, rather than more after lifting.");
    }
    const t = next.trainingDay;
    if (t && t.minutes < caps.trainMax) {
      const from = t.minutes;
      t.minutes = Math.min(caps.trainMax, from + 5);
      return done("minutes", "trainingDay", from, t.minutes, `Walk after lifting ${from} → ${t.minutes} min.`);
    }
    if (treadmill && !nearMeet) {
      const s = next.restDay ?? next.trainingDay;
      const key = next.restDay ? "restDay" : "trainingDay";
      const cap = key === "restDay" ? caps.maxIncline : caps.trainInclineMax;
      if (s && s.inclinePct < cap) {
        const from = s.inclinePct;
        s.inclinePct = Math.min(cap, from + 1);
        return done("incline", key, from, s.inclinePct, `Incline ${from}% → ${s.inclinePct}% at the same time and speed.`);
      }
      if (s && s.speedMph < caps.maxSpeedMph - 0.05) {
        const from = s.speedMph;
        s.speedMph = treadmillSpeedMph(Math.min(caps.maxSpeedMph, from + 0.2), ctx.unit);
        return done("speed", key, from, s.speedMph, `Speed ${fmtSpeed(from, ctx.unit)} → ${fmtSpeed(s.speedMph, ctx.unit)}.`);
      }
    }
    return done("none", null, null, null, nearMeet ? "No more cardio this close to the meet: the legs come first." : "Cardio is at a sensible ceiling: more would cost training more than it helps. The next lever is nutrition.");
  }

  // down
  const steepest = [next.restDay ? ("restDay" as const) : null, next.trainingDay ? ("trainingDay" as const) : null]
    .filter((k): k is "restDay" | "trainingDay" => !!k)
    .sort((a, b) => next[b]!.inclinePct - next[a]!.inclinePct)[0];
  if (treadmill && steepest && next[steepest]!.inclinePct > 3) {
    const s = next[steepest]!;
    const from = s.inclinePct;
    s.inclinePct = Math.max(2, from - 2);
    return done("incline", steepest, from, s.inclinePct, `Incline ${from}% → ${s.inclinePct}%: same time, much less on the hips, calves and lower back.`);
  }
  const t = next.trainingDay;
  if (t && t.minutes > 10) {
    const from = t.minutes;
    t.minutes = Math.max(10, from - 5);
    return done("minutes", "trainingDay", from, t.minutes, `Walk after lifting ${from} → ${t.minutes} min.`);
  }
  const r = next.restDay;
  if (r && r.minutes > 20) {
    const from = r.minutes;
    r.minutes = Math.max(20, from - 5);
    return done("minutes", "restDay", from, r.minutes, `Days-off walks ${from} → ${r.minutes} min.`);
  }
  if (r && r.perWeek > 1) {
    const from = r.perWeek;
    r.weekdays = pickRestDays(train, from - 1, ctx.heavyLowerDays ?? []);
    r.perWeek = r.weekdays.length;
    return done("frequency", "restDay", from, r.perWeek, `One fewer days-off walk (${from} → ${r.perWeek} a week).`);
  }
  if (t) {
    next.trainingDay = null;
    return done("removed", "trainingDay", t.minutes, 0, "No walk after lifting: daily steps cover it.");
  }
  return done("none", null, null, null, "Cardio is already minimal.");
}

/* ------------------------------------------------------------------------ */
/* Their existing plan                                                       */

export type ExistingCardio = {
  day_type: string | null;
  cardio_type: string | null;
  custom_type?: string | null;
  duration_minutes: number | null;
  frequency_per_week?: number | null;
  scheduled_weekdays?: string[] | null;
  incline?: number | string | null;
  speed_min_mph?: number | string | null;
  speed_max_mph?: number | string | null;
  source?: string | null;
};

/** A treadmill session or something else (a bike, stairs, outdoor walking, rowing), by its type. */
export function isTreadmill(type: string | null | undefined): boolean {
  const t = String(type ?? "").toLowerCase();
  if (!t.trim()) return false;
  if (/outdoor|bike|cycl|stair|ellip|row|sled|swim|run(?!ning\s*machine)/.test(t)) return /treadmill/.test(t);
  return /treadmill|incline walk|walk/.test(t);
}

/**
 * Which modality to plan in: a plan the coach already chose that isn't a
 * treadmill stays what it is; anything new is a treadmill.
 */
export function plannedModality(existing: ExistingCardio[]): { modality: "treadmill" | "other"; keep: string | null } {
  const coachSet = existing.find((e) => (e.duration_minutes ?? 0) > 0 && e.source !== "program_rows" && e.cardio_type && !isTreadmill(e.custom_type || e.cardio_type));
  return coachSet ? { modality: "other", keep: (coachSet.custom_type || coachSet.cardio_type) as string } : { modality: "treadmill", keep: null };
}

const kindOf = (dayType: string | null | undefined): "training" | "rest" | "other" => {
  const d = String(dayType ?? "").toLowerCase();
  if (/non.?training|rest|off/.test(d)) return "rest";
  if (/training|high/.test(d)) return "training";
  return "other";
};

/** Their current plan as treadmill sessions (speed in mph, the middle of its range). */
export function sessionsFromExisting(existing: ExistingCardio[]): Plan {
  const pick = (k: "training" | "rest") => existing.find((e) => kindOf(e.day_type) === k && (e.duration_minutes ?? 0) > 0) ?? null;
  const toSession = (e: ExistingCardio | null): TreadmillSession | null => {
    if (!e) return null;
    const lo = Number(e.speed_min_mph);
    const hi = Number(e.speed_max_mph);
    const speed = Number.isFinite(lo) && lo > 0 ? (Number.isFinite(hi) && hi > 0 ? (lo + hi) / 2 : lo) : 3.0;
    const inc = Number(e.incline);
    const days = (e.scheduled_weekdays ?? []).filter(Boolean);
    return { minutes: Math.round(e.duration_minutes as number), speedMph: round(speed, 1), inclinePct: Number.isFinite(inc) ? inc : 0, perWeek: e.frequency_per_week ?? days.length ?? 0, weekdays: days };
  };
  return { trainingDay: toSession(pick("training")), restDay: toSession(pick("rest")) };
}

/** "25 min · 3.0 mph · 6% incline" */
export function sessionLine(s: TreadmillSession, unit: SpeedUnit, treadmill = true): string {
  return treadmill ? `${s.minutes} min · ${fmtSpeed(s.speedMph, unit)} · ${s.inclinePct}% incline` : `${s.minutes} min`;
}
