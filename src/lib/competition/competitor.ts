/**
 * A competitor read from their record (pure, tested in competition-engines.test.ts
 * and competition-competitor-training.test.ts): what they've done, where
 * they're heading, how they attempt, and a projected range for the meet.
 * Their current projected ability decides how much of a threat they are,
 * never their lifetime best alone: a 640 kg total from 2019 by someone who's
 * totalled 560 since is a 560-ish lifter today.
 *
 * The projection starts from their recent meets (the trend half carried on,
 * capped), then each lift is adjusted for what's known to differ at this meet
 * and what their training says:
 *  - equipment: knee wraps on their record and a classic (sleeves) meet
 *    takes the squat down;
 *  - weight class: cutting to a lighter class than they've been lifting at
 *    costs strength (bodyweight ratio to the half power, at most 10%), and a
 *    move up widens the high end;
 *  - training seen outside a meet: weighed by recency, specificity, rep
 *    range, effort, source and their own training-to-platform history
 *    (competitor-training.ts), moving the expected up or down by how
 *    consistent the pattern is. One posted PR barely moves it; a run of
 *    competition-standard work over weeks moves it a lot;
 *  - consistency: lifters who don't always total keep a lower conservative.
 */
import {
  attemptStats,
  fullPowerMeets,
  liftAt,
  totalSlopePerYear,
  type AttemptStats,
} from "./meet-stats";
import { daysBetween } from "./milestones";
import { roundTo } from "./rules";
import type { Confidence, Lift, MeetRecord, Observation, Range } from "./types";
import { ownConversionFor, trainingSignal, type TrainingSignal } from "./competitor-training";

export type CompetitorRead = {
  meets: number;
  bestTotal: { kg: number; date: string; meet: string | null } | null;
  recentTotal: {
    kg: number;
    date: string;
    meet: string | null;
    weightClass: string | null;
    bodyweight: number | null;
  } | null;
  /** kg a year over their last few meets (null with fewer than two) */
  trendPerYear: number | null;
  /** meets a year over the last two years */
  perYear: number;
  bests: Record<Lift, number | null>;
  /** their last full-power meet's lifts, the split a projection is shared out by */
  lastSplit: Record<Lift, number | null>;
  weightClasses: string[];
  stats: AttemptStats;
  projection: (Range & { lifts: Record<Lift, Range | null> }) | null;
  confidence: Confidence;
  /** short, factual reasons for the projection */
  basis: string[];
  /** observed training that moved the projection */
  observationsUsed: Observation[];
  /** what training says per lift, and how much of it went into the expected */
  training: Partial<Record<Lift, TrainingSignal>>;
  /** months since their last full-power meet */
  monthsSinceMeet: number | null;
  /** their last four full-power meets (the evidence Cleo cites) */
  recentMeets: MeetRecord[];
};

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const BY_RANK: Confidence[] = ["low", "medium", "high"];
const step = (c: Confidence, d: number): Confidence =>
  BY_RANK[Math.max(0, Math.min(2, RANK[c] + d))];
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** A lifter with a meet this recently is still competing: their trend is credited. */
export const ACTIVE_MONTHS = 9;
/** A trend is never carried further than this. */
export const TREND_MAX_YEARS = 1;

export function readCompetitor(input: {
  meets: MeetRecord[];
  today: string;
  meetDate: string;
  observations?: Observation[];
  increment?: number;
  /** the meet's weight-class limit (kg), when known */
  meetClassLimitKg?: number | null;
  /** a classic (sleeves only) meet: an IPF affiliate */
  classic?: boolean;
}): CompetitorRead {
  const inc = input.increment ?? 2.5;
  const observations = input.observations ?? [];
  const fp = fullPowerMeets(input.meets).filter((m) => m.date <= input.today);
  const withTotal = fp.filter((m) => (m.total ?? 0) > 0);
  const best = withTotal.reduce<MeetRecord | null>(
    (b, m) => (!b || m.total! > b.total! ? m : b),
    null,
  );
  const recent = withTotal[0] ?? null;
  const twoYearsAgo = `${Number(input.today.slice(0, 4)) - 2}${input.today.slice(4)}`;
  const lastTwoYears = fp.filter((m) => m.date >= twoYearsAgo).length;
  const slope = totalSlopePerYear(withTotal.slice(0, 4));
  const bests = Object.fromEntries(
    LIFTS.map((l) => [
      l,
      fp.reduce<number | null>((b, m) => {
        const v = liftAt(m, l);
        return v != null && (b == null || v > b) ? v : b;
      }, null),
    ]),
  ) as Record<Lift, number | null>;
  const lastSplit = Object.fromEntries(
    LIFTS.map((l) => [l, recent ? liftAt(recent, l) : null]),
  ) as Record<Lift, number | null>;
  const monthsSince = recent ? Math.round(daysBetween(recent.date, input.today) / 30.4) : null;
  const stats = attemptStats(fp);
  const basis: string[] = [];
  const training: Partial<Record<Lift, TrainingSignal>> = {};
  const used: Observation[] = [];
  const signalFor = (l: Lift) => {
    const own = ownConversionFor(
      l,
      observations,
      fp.map((m) => ({ date: m.date, lift: liftAt(m, l) })),
    );
    const s = trainingSignal({ lift: l, observations, today: input.today, ownConversion: own });
    if (s) {
      training[l] = s;
      for (const o of s.used) if (!used.includes(o)) used.push(o);
    }
    return s;
  };

  let projection: CompetitorRead["projection"] = null;
  let confidence: Confidence = "low";
  if (recent && best) {
    const stale = (monthsSince ?? 99) > 18;
    // start from their recent level; a stale recent meet leans on the best a little
    const base = stale ? Math.max(recent.total!, best.total! * 0.97) : recent.total!;
    // a trend is carried for a year at most: further out it's a guess, not a trend
    const yearsAhead = Math.min(
      TREND_MAX_YEARS,
      Math.max(0, daysBetween(recent.date, input.meetDate) / 365.25),
    );
    const trend = slope ?? 0;
    // progress is credited only to someone still competing: with no meet in
    // ACTIVE_MONTHS nothing confirms they kept climbing (injured, retired,
    // a break), so the expected stays at their last level and only the high
    // scenario keeps the chance they did
    const active = (monthsSince ?? 99) <= ACTIVE_MONTHS;
    const up = active ? Math.max(0, trend) : 0;
    // half the recent trend continues, capped: lifters rarely keep a steep early-career slope
    const gain = Math.max(
      -base * 0.05,
      Math.min(base * 0.06, (trend < 0 ? trend : up) * yearsAhead * 0.5),
    );
    const expTotal = base + gain;
    const highTotal = Math.min(
      Math.max(best.total!, base + Math.max(0, trend) * yearsAhead) * 1.02,
      base * 1.1,
    );
    const consTotal = Math.min(base, expTotal) * 0.97;
    basis.push(`Last total ${recent.total} kg (${recent.date})`);
    if (best.date !== recent.date) basis.push(`Best total ${best.total} kg (${best.date})`);
    if (slope != null) basis.push(`Recent trend ${slope > 0 ? "+" : ""}${slope} kg a year`);
    if (stale) basis.push(`No meet in ${monthsSince} months`);
    else if (!active && trend > 0)
      basis.push(
        `No meet in ${monthsSince} months: their trend isn't carried on without a meet to confirm it`,
      );
    confidence =
      (monthsSince ?? 99) <= 9 && withTotal.length >= 3
        ? "high"
        : (monthsSince ?? 99) <= 18
          ? "medium"
          : "low";

    // the meet-based range per lift, shared out by their last split
    const split = Object.fromEntries(
      LIFTS.map((l) => {
        const v = lastSplit[l] ?? bests[l];
        const sum = LIFTS.reduce((s, x) => s + (lastSplit[x] ?? bests[x] ?? 0), 0);
        return [l, v && sum ? v / sum : null];
      }),
    ) as Record<Lift, number | null>;
    const lifts = {} as Record<Lift, { c: number; e: number; h: number } | null>;
    for (const l of LIFTS)
      lifts[l] = split[l]
        ? { c: consTotal * split[l]!, e: expTotal * split[l]!, h: highTotal * split[l]! }
        : null;

    // equipment: wraps on record, a classic meet
    if (input.classic && /wraps/i.test(String(recent.equipment ?? "")) && lifts.squat) {
      for (const k of ["c", "e", "h"] as const) lifts.squat[k] *= 0.93;
      basis.push("Their record is in knee wraps; this meet is sleeves only: squat taken down 7%");
      confidence = step(confidence, -1);
    }
    // weight class: cutting below what they've lifted at, or moving up
    const lim = input.meetClassLimitKg ?? null;
    const bw = recent.bodyweight ?? null;
    if (lim && bw) {
      if (bw > lim + 0.5) {
        const f = Math.max(0.9, Math.min(1, Math.pow(lim / bw, 0.5)));
        for (const l of LIFTS)
          if (lifts[l]) for (const k of ["c", "e", "h"] as const) lifts[l]![k] *= f;
        basis.push(
          `Last lifted at ${bw} kg; making ${lim} kg costs strength: about ${pct(1 - f)} off`,
        );
        confidence = step(confidence, -1);
      } else if (bw < lim * 0.92) {
        for (const l of LIFTS) if (lifts[l]) lifts[l]!.h *= 1.03;
        basis.push(`Last lifted at ${bw} kg, well under ${lim} kg: room to grow into the class`);
      }
    }
    // training seen outside a meet
    for (const l of LIFTS) {
      const r = lifts[l];
      if (!r) continue;
      const s = signalFor(l);
      if (!s) continue;
      const gap = s.estimateKg - r.e;
      const move = Math.max(-r.e * 0.12, Math.min(r.e * 0.12, gap * s.weight));
      r.e += move;
      if (gap > 0) {
        // the high end takes more of the gap than the expected does
        r.h = Math.max(r.h, r.e + Math.max(0, gap - move) * Math.min(1, s.weight + 0.5));
      } else if (s.weight >= 0.25) {
        r.c = Math.min(r.c, r.e * 0.97);
        r.h = Math.max(r.e, Math.min(r.h, r.e * 1.04));
      }
      if (Math.abs(move) >= inc / 2)
        basis.push(
          `${l[0].toUpperCase()}${l.slice(1)}: training points to ${s.estimateKg} kg; ${Math.round(s.weight * 100)}% of the gap taken (${s.exposures} day${s.exposures === 1 ? "" : "s"})`,
        );
      else if (gap > inc)
        basis.push(
          `${l[0].toUpperCase()}${l.slice(1)}: a training lift over their meet level widens the high end`,
        );
      if (s.weight >= 0.3 && stale) confidence = step(confidence, 1);
    }
    // consistency: lifters who don't always total
    if (stats.meets >= 3 && stats.bombOuts / stats.meets >= 0.2) {
      for (const l of LIFTS) if (lifts[l]) lifts[l]!.c *= 0.96;
      basis.push(`No total at ${stats.bombOuts} of ${stats.meets} meets: conservative lowered`);
    }
    for (const l of LIFTS) {
      const r = lifts[l];
      if (!r) continue;
      r.e = Math.max(r.e, r.c);
      r.h = Math.max(r.h, r.e);
    }
    const ranges = Object.fromEntries(
      LIFTS.map((l) => [
        l,
        lifts[l]
          ? {
              conservative: roundTo(lifts[l]!.c, inc),
              expected: roundTo(lifts[l]!.e, inc),
              high: roundTo(lifts[l]!.h, inc),
            }
          : null,
      ]),
    ) as Record<Lift, Range | null>;
    const all = LIFTS.every((l) => ranges[l]);
    const meetOnly: Range = { conservative: consTotal, expected: expTotal, high: highTotal };
    const sum = (k: keyof Range) =>
      all ? LIFTS.reduce((s, l) => s + ranges[l]![k], 0) : roundTo(meetOnly[k], inc);
    projection = {
      conservative: sum("conservative"),
      expected: sum("expected"),
      high: sum("high"),
      lifts: ranges,
    };
    return {
      meets: fp.length,
      bestTotal: { kg: best.total!, date: best.date, meet: best.name },
      recentTotal: {
        kg: recent.total!,
        date: recent.date,
        meet: recent.name,
        weightClass: recent.weightClass,
        bodyweight: recent.bodyweight,
      },
      trendPerYear: slope,
      perYear: Math.round((lastTwoYears / 2) * 10) / 10,
      bests,
      lastSplit,
      weightClasses: [
        ...new Set(
          fp
            .slice(0, 4)
            .map((m) => m.weightClass)
            .filter((x): x is string => !!x),
        ),
      ],
      stats,
      projection,
      confidence,
      basis,
      observationsUsed: used,
      training,
      monthsSinceMeet: monthsSince,
      recentMeets: fp.slice(0, 4),
    };
  }

  // no meet total: a first-timer or a lifter known only from training
  const sig = Object.fromEntries(LIFTS.map((l) => [l, signalFor(l)])) as Record<
    Lift,
    TrainingSignal | null
  >;
  if (LIFTS.every((l) => sig[l])) {
    const lifts = Object.fromEntries(
      LIFTS.map((l) => {
        const e = sig[l]!.estimateKg;
        return [
          l,
          {
            conservative: roundTo(e * 0.92, inc),
            expected: roundTo(e * 0.97, inc),
            high: roundTo(e * 1.02, inc),
          },
        ];
      }),
    ) as Record<Lift, Range>;
    projection = {
      conservative: LIFTS.reduce((s, l) => s + lifts[l].conservative, 0),
      expected: LIFTS.reduce((s, l) => s + lifts[l].expected, 0),
      high: LIFTS.reduce((s, l) => s + lifts[l].high, 0),
      lifts,
    };
    basis.push("No meet on record: read from training only, a first meet runs below training");
  } else basis.push("No meet on record");
  return {
    meets: fp.length,
    bestTotal: null,
    recentTotal: null,
    trendPerYear: null,
    perYear: 0,
    bests,
    lastSplit,
    weightClasses: [],
    stats,
    projection,
    confidence: "low",
    basis,
    observationsUsed: used,
    training,
    monthsSinceMeet: null,
    recentMeets: fp.slice(0, 4),
  };
}

/** "Takes thirds ~4% over the second and makes 40% of them" etc.: patterns in plain words, never motives. */
export function attemptPatternWords(s: AttemptStats): string[] {
  if (s.meetsWithAttempts < 2) return [];
  const out: string[] = [];
  if (s.openerPct.all != null)
    out.push(`Opens around ${Math.round(s.openerPct.all * 100)}% of what they make on the day`);
  if (s.success[2] != null) out.push(`Makes ${Math.round(s.success[2] * 100)}% of third attempts`);
  if (s.jumpPct.third != null)
    out.push(`Third attempts a median ${Math.round(s.jumpPct.third * 1000) / 10}% over the second`);
  const worst = (Object.entries(s.missesByLift) as [Lift, number][]).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 2) out.push(`Most misses on the ${worst[0]} (${worst[1]})`);
  if (s.bombOuts) out.push(`No total at ${s.bombOuts} of ${s.meets} meets`);
  if (s.leavesWeight)
    out.push("Nearly every third made with a small jump: may leave weight on the platform");
  return out;
}
