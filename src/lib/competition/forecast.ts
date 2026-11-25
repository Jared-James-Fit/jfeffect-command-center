/**
 * The athlete's meet forecast (pure, tested in competition-engines.test.ts):
 * conservative, expected and high for each lift and the total, with what each
 * rests on. Never a probability.
 *
 * It starts from the analytics' own strength line (lift-strength.ts: the best
 * hard set in the last six weeks, lighter sets only ever raising it, held
 * rather than dropped through a deload or a taper), so one great or awful
 * session never moves it, and accumulated fatigue (lighter recent sessions
 * under a held line) is never read as strength lost. Then, per lift:
 *  - conversion: how this athlete's past meets compared with their training
 *    line three weeks before them (median, 0.92 to 1.08). With no meets on
 *    record it's 1.0 and said to be assumed.
 *  - progress to the meet: half the line's recent weekly rise continues,
 *    capped at 2.5% (the high scenario takes all of it, capped at 5%). A
 *    falling or flat line adds nothing.
 *  - spread: how much the evidence can be trusted (recent hard sessions,
 *    the line's state, meets to calibrate against) sets how wide the
 *    conservative and high scenarios sit.
 *  - recent form: today's line is what training says now, and that's what
 *    the conversion was measured against only three weeks out. Further out
 *    (an off-season volume block, a bench last trained hard two months ago)
 *    it isn't the meet yet, so their recent meets in the class they're
 *    entering carry more of the expected the further away the meet is
 *    (`formShare`: none inside three weeks, three quarters from twelve), by
 *    how many of those meets there are. Where training and form disagree
 *    the range widens to hold both.
 *  - concerns: pain on a lift or poor recovery lowers that lift's
 *    conservative scenario and is said, never hidden in the numbers.
 */
import { daysBetween } from "./milestones";
import { floorTo, roundTo } from "./rules";
import type { Confidence, Lift, MeetRecord, Range } from "./types";
import { liftAt } from "./meet-stats";

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

export type LiftEvidence = {
  lift: Lift;
  /** the strength line today, kg */
  nowKg: number | null;
  state: "measured" | "raised" | "held" | "stale" | "floor" | null;
  /** what the line rests on, in words ("180 kg × 3 @ 8 on Nov 18") */
  basis: string | null;
  basisDay: string | null;
  /** hard-set sessions in the last six weeks */
  hardSessions6w: number;
  /** the line's change per week over the last eight, as a share (0.005 = +0.5%) */
  trendPerWeek: number | null;
  /** the line's state over the last eight weeks: rising, flat, falling */
  direction: "up" | "flat" | "down" | "unclear";
};

export type ConversionPoint = {
  lift: Lift;
  meetDate: string;
  meetKg: number;
  trainingKg: number;
  /** the class that meet was lifted in: a cut is part of what the conversion measures */
  weightClass?: string | null;
};

export type Concern = {
  lift: Lift | null;
  severity: "watch" | "concern" | "serious";
  text: string;
};

export type LiftForecast = {
  lift: Lift;
  range: Range;
  confidence: Confidence;
  source: "training" | "meet";
  /** platform ÷ training from their own meets, and how many it's from */
  conversion: { ratio: number; meets: number; assumed: boolean };
  basis: string[];
};

export type Forecast = {
  lifts: Record<Lift, LiftForecast | null>;
  total: Range | null;
  confidence: Confidence;
  factors: string[];
  limitations: string[];
  bestMeetTotal: { kg: number; date: string } | null;
  /** expected total against their best meet total */
  vsBest: number | null;
};

const SPREAD: Record<Confidence, { down: number; up: number }> = {
  high: { down: 0.03, up: 0.025 },
  medium: { down: 0.045, up: 0.035 },
  low: { down: 0.07, up: 0.05 },
};
const CONCERN_CUT: Record<Concern["severity"], number> = {
  watch: 0,
  concern: 0.015,
  serious: 0.03,
};

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const lowest = (cs: Confidence[]): Confidence =>
  cs.reduce((a, c) => (RANK[c] < RANK[a] ? c : a), "high" as Confidence);
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Inside this many days the line is read as the conversion was measured: three weeks out. */
export const FORM_FROM_DAYS = 21;
/** By this many days out recent platform form carries its full share. */
export const FORM_FULL_DAYS = 84;
export const FORM_MAX_SHARE = 0.75;
/** Meets count as recent form for a year. */
export const FORM_WINDOW_DAYS = 365;

/** The share of the expected that recent meet form carries at this distance from the meet. */
export function formShare(daysOut: number, meets: number): number {
  if (daysOut <= FORM_FROM_DAYS || meets <= 0) return 0;
  const byTime = Math.min(
    FORM_MAX_SHARE,
    ((daysOut - FORM_FROM_DAYS) / (FORM_FULL_DAYS - FORM_FROM_DAYS)) * FORM_MAX_SHARE,
  );
  return byTime * (meets >= 3 ? 1 : meets === 2 ? 0.85 : 0.6);
}

const classKey = (c: string | null | undefined) =>
  String(c ?? "")
    .trim()
    .toLowerCase()
    .replace(/kg$/, "")
    .replace(/\.0+(?=\+?$)/, "");

/**
 * Their recent platform form for a lift: the median of what they made at
 * their last (up to three) full-power meets within a year, in the class
 * they're entering when it's known (their form at another bodyweight isn't
 * this meet's).
 */
export function recentForm(
  meets: MeetRecord[],
  lift: Lift,
  today: string,
  weightClass?: string | null,
): { kg: number; meets: MeetRecord[] } | null {
  const want = classKey(weightClass);
  const pool = meets
    .filter(
      (m) =>
        (m.event ?? "SBD").toUpperCase() === "SBD" &&
        (m.total ?? 0) > 0 &&
        m.date <= today &&
        daysBetween(m.date, today) <= FORM_WINDOW_DAYS &&
        (!want || classKey(m.weightClass) === want) &&
        liftAt(m, lift) != null,
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  if (!pool.length) return null;
  return { kg: median(pool.map((m) => liftAt(m, lift)!)), meets: pool };
}

export type PastCut = {
  meetDate: string;
  weightClass: string | null;
  /** their weigh-in at that meet */
  weighInKg: number;
  /** their bodyweight average this many days before that meet (as far out as today is) */
  sameDistanceKg: number | null;
  /** and four weeks before it */
  fourWeeksKg: number | null;
};

/**
 * How far from the class they were in past preps: their bodyweight at the
 * same distance before each meet (and four weeks before) against the weigh-in
 * they made, from their own weigh-ins (pure). A cut this athlete has made
 * before is evidence; one twice the size isn't the same cut.
 */
export function pastCuts(
  logs: Array<{ day: string; kg: number }>,
  meets: MeetRecord[],
  daysOut: number,
  today: string,
): PastCut[] {
  const avgAround = (day: string, half: number) => {
    const xs = logs.filter((l) => Math.abs(daysBetween(day, l.day)) <= half).map((l) => l.kg);
    return xs.length >= 2
      ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
      : null;
  };
  const back = (date: string, days: number) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  return meets
    .filter((m) => (m.bodyweight ?? 0) > 0 && m.date <= today && daysBetween(m.date, today) <= 730)
    .slice(0, 6)
    .map((m) => ({
      meetDate: m.date,
      weightClass: m.weightClass,
      weighInKg: m.bodyweight!,
      sameDistanceKg: daysOut > 7 ? avgAround(back(m.date, daysOut), 7) : null,
      fourWeeksKg: avgAround(back(m.date, 28), 4),
    }))
    .filter((c) => c.sameDistanceKg != null || c.fourWeeksKg != null);
}

/**
 * How their meets compared with their training three weeks before, for this
 * lift. A cut to make a class is part of what it measures (training at 70 kg,
 * lifting at 65.4), so when the class being entered is known only meets in
 * that class count: a lifter moving up a class makes no cut, and the cut's
 * cost must not come with them. With none in the class it's 1.0, said.
 */
export function conversionFor(
  lift: Lift,
  points: ConversionPoint[],
  weightClass?: string | null,
): LiftForecast["conversion"] & { otherClass?: boolean } {
  const want = classKey(weightClass);
  const usable = points.filter((p) => p.lift === lift && p.trainingKg > 0 && p.meetKg > 0);
  const inClass = want
    ? usable.filter((p) => !p.weightClass || classKey(p.weightClass) === want)
    : usable;
  const r = inClass.map((p) => p.meetKg / p.trainingKg);
  if (!r.length) return { ratio: 1, meets: 0, assumed: true, otherClass: usable.length > 0 };
  return {
    ratio: Math.round(Math.min(1.08, Math.max(0.92, median(r))) * 1000) / 1000,
    meets: r.length,
    assumed: false,
  };
}

export function forecastMeet(input: {
  today: string;
  meetDate: string;
  lifts: Record<Lift, LiftEvidence>;
  meets: MeetRecord[];
  conversion: ConversionPoint[];
  concerns: Concern[];
  increment?: number;
  /** the class they're entering, so recent form is read at that class */
  weightClass?: string | null;
}): Forecast {
  const step = input.increment ?? 2.5;
  const daysOut = Math.max(0, daysBetween(input.today, input.meetDate));
  const weeks = daysOut / 7;
  const factors: string[] = [];
  const limitations: string[] = [];
  const recentMeet = input.meets.find(
    (m) =>
      (m.event ?? "SBD").toUpperCase() === "SBD" &&
      (m.total ?? 0) > 0 &&
      daysBetween(m.date, input.today) <= 548,
  );
  const bestMeet = input.meets.reduce<MeetRecord | null>(
    (b, m) =>
      (m.total ?? 0) > (b?.total ?? 0) && (m.event ?? "SBD").toUpperCase() === "SBD" ? m : b,
    null,
  );

  const out = {} as Record<Lift, LiftForecast | null>;
  for (const lift of LIFTS) {
    const ev = input.lifts[lift];
    const conv = conversionFor(lift, input.conversion, input.weightClass);
    const basis: string[] = [];
    let now: number | null = null;
    let source: LiftForecast["source"] = "training";
    let conf: Confidence = "low";
    const fresh = ev?.basisDay ? daysBetween(ev.basisDay, input.today) : 999;
    if (ev?.nowKg && ev.nowKg > 0 && ev.state !== "floor") {
      now = ev.nowKg;
      if (
        (ev.state === "measured" || ev.state === "raised") &&
        fresh <= 21 &&
        ev.hardSessions6w >= 3
      )
        conf = "high";
      else if (ev.state !== "stale" && fresh <= 42 && ev.hardSessions6w >= 1) conf = "medium";
      if (ev.basis) basis.push(`Training: ${ev.basis}`);
      if (ev.state === "held") basis.push("No hard set lately: the line is held, not lowered");
      if (ev.state === "stale") basis.push("The line is stale: no hard set in 8 weeks");
    } else if (recentMeet && liftAt(recentMeet, lift)) {
      now = liftAt(recentMeet, lift)!;
      source = "meet";
      basis.push(`No usable training estimate: their ${recentMeet.date} meet (${now} kg)`);
    }
    if (now == null) {
      out[lift] = null;
      limitations.push(`No ${lift} estimate: nothing logged hard enough and no meet in 18 months`);
      continue;
    }
    // calibration from their own meets lifts the confidence one step at most
    if (source === "training" && conv.meets >= 2 && conf === "medium" && ev.hardSessions6w >= 2)
      conf = "high";
    const ratio = source === "meet" ? 1 : conv.ratio;
    if (source === "training")
      basis.push(
        conv.assumed
          ? (conv as { otherClass?: boolean }).otherClass
            ? `Platform conversion assumed 1.0: their meets to calibrate against were in another class (a different cut)`
            : "Platform conversion assumed 1.0 (no past meets to calibrate)"
          : `Platform conversion ${conv.ratio} from ${conv.meets} meet${conv.meets === 1 ? "" : "s"}`,
      );
    let gainExp = 0;
    let gainHigh = 0;
    if (
      source === "training" &&
      ev.trendPerWeek != null &&
      ev.trendPerWeek > 0 &&
      ev.direction === "up" &&
      weeks >= 2
    ) {
      gainExp = Math.min(ev.trendPerWeek * weeks * 0.5, 0.025);
      gainHigh = Math.min(ev.trendPerWeek * weeks, 0.05);
      basis.push(`Rising ${pct(ev.trendPerWeek)} a week: expected adds ${pct(gainExp)}`);
    }
    if (source === "training" && ev.direction === "down")
      basis.push("The line has been falling: nothing added for progress");
    const cut = input.concerns
      .filter((c) => c.lift === lift || c.lift == null)
      .reduce((s, c) => s + CONCERN_CUT[c.severity] * (c.lift == null ? 0.67 : 1), 0);
    if (cut > 0) basis.push(`Conservative lowered ${pct(cut)} for concerns on file`);
    const trainingMid = now * ratio;
    const form =
      source === "training" ? recentForm(input.meets, lift, input.today, input.weightClass) : null;
    const share = form ? formShare(daysOut, form.meets.length) : 0;
    if (form && share > 0) {
      const since = form.meets[form.meets.length - 1].date;
      basis.push(
        `Recent form${input.weightClass ? ` at ${input.weightClass} kg` : ""}: ${form.kg} kg (${form.meets.length === 1 ? `their ${since} meet` : `median of ${form.meets.length} meets since ${since}`})`,
      );
      basis.push(
        `${Math.round(weeks)} weeks out: recent meets carry ${pct(share)} of the expected, today's training ${pct(1 - share)}`,
      );
      // form from a full prep beside a line that isn't peaked: said, so nobody reads one as the other
      if (conf === "low" && share >= 0.5 && form.meets.length >= 2) conf = "medium";
    }
    const spread = SPREAD[conf];
    const expMid = trainingMid * (1 + gainExp) * (1 - share) + (form?.kg ?? 0) * share;
    const lowMid = share > 0 ? Math.min(trainingMid, expMid) : trainingMid;
    // with no form in it the high is exactly what it always was
    const high =
      share > 0
        ? Math.max(trainingMid * (1 + gainHigh), form!.kg, expMid) * (1 + spread.up)
        : trainingMid * (1 + gainHigh + spread.up);
    const range: Range = {
      conservative: floorTo(lowMid * (1 - spread.down - Math.min(cut, 0.06)), step),
      expected: roundTo(expMid, step),
      high: roundTo(high, step),
    };
    range.expected = Math.max(range.expected, range.conservative);
    range.high = Math.max(range.high, range.expected + step);
    out[lift] = { lift, range, confidence: conf, source, conversion: conv, basis };
  }

  const all = LIFTS.map((l) => out[l]);
  const total = all.every(Boolean)
    ? {
        conservative: all.reduce((s, f) => s + f!.range.conservative, 0),
        expected: all.reduce((s, f) => s + f!.range.expected, 0),
        high: all.reduce((s, f) => s + f!.range.high, 0),
      }
    : null;
  const confidence = lowest(all.map((f) => f?.confidence ?? "low"));
  if (all.some((f) => f?.conversion.assumed && f.source === "training"))
    limitations.push(
      "No past meets to calibrate training against the platform: conversion assumed 1.0",
    );
  if (all.some((f) => f?.source === "meet"))
    limitations.push("At least one lift is read from an old meet, not current training");
  for (const c of input.concerns) if (c.severity !== "watch") factors.push(c.text);
  if (weeks > 12)
    limitations.push(
      `${Math.round(weeks)} weeks out: a lot can change, so the range is a starting point`,
    );
  return {
    lifts: out,
    total,
    confidence,
    factors,
    limitations,
    bestMeetTotal: bestMeet?.total ? { kg: bestMeet.total, date: bestMeet.date } : null,
    vsBest:
      total && bestMeet?.total ? Math.round((total.expected - bestMeet.total) * 10) / 10 : null,
  };
}
