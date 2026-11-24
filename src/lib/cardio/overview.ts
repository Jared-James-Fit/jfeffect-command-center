/**
 * The Cardio tab's overview numbers (Nov 23 2026): what the plan asks for a
 * week, what was done, how much of it, how hard, and whether the volume is
 * moving; the week by week series behind the charts; and the builder's
 * templates and weekly-duration scaling. Pure and tested (cardio-overview.test.ts).
 * Prescribed is from the plan's dated rows (what was really in force each
 * week); completed is what was logged. Estimates are never mixed in.
 */
import { buildWeeks, isCompletedCardio, type CardioCompletionRow, type CardioTargetRow } from "@/lib/analytics/cardio-adherence";
import { addDays } from "@/lib/weight-management/units";
import { CARDIO_WEEKDAYS } from "@/lib/cardio-prescription";
import { newSession, planTotals, weekdaysFor, type CardioPlan, type CardioSession, type PlanContext } from "@/lib/cardio/plan";

const DAY = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Monday on or before a date. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
}

export type CardioKpis = {
  prescribedMinutes: number;
  prescribedSessions: number;
  /** Completed minutes a week, the last 4 full weeks. */
  completedMinutes: number | null;
  completedSessions: number | null;
  /** Sessions done of those prescribed, the last 4 full weeks (null when nothing was prescribed). */
  completionPct: number | null;
  /** Average logged RPE, the last 4 full weeks. */
  avgRpe: number | null;
  /** The plan's target effort (minutes-weighted). */
  targetRpe: number | null;
  /** Completed minutes, the last 4 full weeks against the 4 before, %. */
  volumeChangePct: number | null;
  /** The last 4 full weeks: Monday of the first, Sunday of the last. */
  window: { from: string; to: string };
};

export function cardioKpis(x: { today: string; rows: CardioTargetRow[]; completions: CardioCompletionRow[]; live: CardioPlan; ctx: PlanContext }): CardioKpis {
  const thisMonday = mondayOf(x.today);
  const to = addDays(thisMonday, -1);
  const from = addDays(thisMonday, -28);
  const weeks = buildWeeks(x.rows, x.completions, from, to);
  const prior = buildWeeks(x.rows, x.completions, addDays(from, -28), addDays(from, -1));
  const sum = (ws: typeof weeks, k: "completedMinutes" | "completedSessions" | "prescribedSessions") => ws.reduce((a, w) => a + w[k], 0);
  const totals = planTotals(x.live, x.ctx);
  const presc = sum(weeks, "prescribedSessions");
  const done = sum(weeks, "completedSessions");
  const doneMin = sum(weeks, "completedMinutes");
  const priorMin = sum(prior, "completedMinutes");
  const rpes = x.completions
    .filter((c) => c.completed_date >= from && c.completed_date <= to && isCompletedCardio(c) && c.rpe != null)
    .map((c) => Number(c.rpe))
    .filter((n) => n > 0 && n <= 10);
  const anyLogged = x.completions.some((c) => c.completed_date >= from && c.completed_date <= to);
  return {
    prescribedMinutes: totals.minutes,
    prescribedSessions: totals.sessions,
    completedMinutes: anyLogged || presc ? Math.round(doneMin / 4) : null,
    completedSessions: anyLogged || presc ? r1(done / 4) : null,
    completionPct: presc > 0 ? Math.min(100, Math.round((done / presc) * 100)) : null,
    avgRpe: rpes.length >= 2 ? r1(avg(rpes)!) : null,
    targetRpe: totals.avgRpe,
    volumeChangePct: priorMin >= 30 ? Math.round(((doneMin - priorMin) / priorMin) * 100) : null,
    window: { from, to },
  };
}

export type WeekPoint = { start: string; label: string; prescribed: number; completed: number; adherence: number | null; bodyweightKg: number | null };

/** The last N full weeks (Monday to Sunday) plus this one so far: prescribed and completed minutes, and the week's average bodyweight. */
export function weeklySeries(x: { today: string; rows: CardioTargetRow[]; completions: CardioCompletionRow[]; weighIns: Array<{ date: string; kg: number }>; weeks?: number }): WeekPoint[] {
  const n = x.weeks ?? 12;
  const start = addDays(mondayOf(x.today), -7 * (n - 1));
  const end = addDays(mondayOf(x.today), 6);
  return buildWeeks(x.rows, x.completions, start, end).map((w) => {
    const bw = x.weighIns.filter((p) => p.date >= w.start && p.date <= w.end).map((p) => p.kg);
    const d = new Date(`${w.start}T00:00:00Z`);
    return {
      start: w.start,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      prescribed: w.prescribedMinutes,
      completed: w.completedMinutes,
      adherence: w.adherence,
      bodyweightKg: bw.length ? Math.round((avg(bw)! ) * 10) / 10 : null,
    };
  });
}

export type WeekdayPoint = { day: string; short: string; planned: number; doneAvg: number };

/** Each weekday: the plan's minutes, and the minutes actually done on it (average over the last 4 weeks). */
export function weekdayDistribution(x: { today: string; live: CardioPlan; ctx: PlanContext; completions: CardioCompletionRow[] }): WeekdayPoint[] {
  const from = addDays(mondayOf(x.today), -28);
  const to = addDays(mondayOf(x.today), -1);
  return CARDIO_WEEKDAYS.map((day, i) => {
    const planned = x.live.sessions.filter((s) => s.enabled && weekdaysFor(s.days, s.weekdays, x.ctx).includes(day)).reduce((a, s) => a + s.minutes, 0);
    const done = x.completions
      .filter((c) => c.completed_date >= from && c.completed_date <= to && isCompletedCardio(c) && (new Date(`${c.completed_date}T00:00:00Z`).getUTCDay() + 6) % 7 === i)
      .reduce((a, c) => a + (Number(c.duration_minutes) || 0), 0);
    return { day, short: day.slice(0, 3), planned, doneAvg: Math.round(done / 4) };
  });
}

/* ------------------------------------------------------------------ */
/* Templates and weekly duration                                       */

export type CardioTemplate = { key: string; label: string; detail: string; sessions: (ctx: PlanContext) => CardioSession[] };

export const CARDIO_TEMPLATES: CardioTemplate[] = [
  {
    key: "days_off_walks",
    label: "Easy incline walks on days off",
    detail: "30 min, 3.0 mph, 6%, RPE 3–4",
    sessions: (ctx) => [{ ...newSession("treadmill_incline", "non_training", ctx), minutes: 30, rpeMin: 3, rpeMax: 4, instructions: "Easy: you can talk in full sentences." }],
  },
  {
    key: "after_lifting",
    label: "Short walk after lifting",
    detail: "10 min after every workout, 3% incline",
    sessions: (ctx) => [{ ...newSession("treadmill_incline", "training", ctx), minutes: 10, incline: 3, rpeMin: 3, rpeMax: 3, timing: "after_lifting", instructions: "Right after lifting, easy pace." }],
  },
  {
    key: "split_walks",
    label: "Walks through the day",
    detail: "30 min a day, split however suits them",
    sessions: (ctx) => [
      {
        ...newSession("outdoor_walk", "daily", ctx),
        minutes: 30,
        rpeMin: 3,
        rpeMax: 3,
        instructions: "Split it if that's easier: three 10-minute walks through the day (after meals works well) all count.",
      },
    ],
  },
  {
    key: "bike_low_impact",
    label: "Low-impact bike for lifters",
    detail: "25 min on days off, RPE 4–5",
    sessions: (ctx) => [{ ...newSession("bike", "non_training", ctx), minutes: 25, rpeMin: 4, rpeMax: 5, instructions: "Steady pace, easy on the legs." }],
  },
  {
    key: "zone2_base",
    label: "Zone 2 base",
    detail: "40 min on days off, conversational",
    sessions: (ctx) => [{ ...newSession("treadmill_incline", "non_training", ctx), minutes: 40, rpeMin: 3, rpeMax: 4, hrZone: "Zone 2", instructions: "Conversational pace the whole way." }],
  },
  {
    key: "conditioning_weekly",
    label: "Conditioning once a week",
    detail: "20 min intervals, away from heavy legs",
    sessions: (ctx) => {
      const off = CARDIO_WEEKDAYS.filter((d) => !ctx.trainingDays.includes(d));
      return [
        {
          ...newSession("conditioning", "weekdays", ctx),
          name: "Intervals",
          weekdays: off.length ? [off[off.length - 1]] : ["Saturday"],
          minutes: 20,
          rpeMin: 6,
          rpeMax: 8,
          timing: "separate",
          instructions: "Warm up 5 minutes, then hard 30 s / easy 90 s. Stop if your form breaks down.",
        },
      ];
    },
  },
];

/** Every session's minutes scaled so the week totals about `target` (5-minute steps, never under 5). */
export function scaleToWeekly(plan: CardioPlan, ctx: PlanContext, target: number): CardioPlan {
  const now = planTotals(plan, ctx).minutes;
  if (!(now > 0) || !(target > 0)) return plan;
  const f = target / now;
  return {
    sessions: plan.sessions.map((s) => (s.enabled ? { ...s, minutes: Math.max(5, Math.round((s.minutes * f) / 5) * 5) } : s)),
  };
}
