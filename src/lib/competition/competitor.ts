/**
 * A competitor read from their record (pure, tested in competition-engines.test.ts):
 * what they've done, where they're heading, how they attempt, and a projected
 * range for the meet. Their current projected ability decides how much of a
 * threat they are, never their lifetime best alone: a 640 kg total from 2019
 * by someone who's totalled 560 since is a 560-ish lifter today.
 *
 * Training seen outside a meet (a post, a video, the coach's note) can only
 * widen the high end, and only a recent competition-standard single or double
 * that's heavier than they've made on a platform: gym lifts are selectively
 * published and often a variation, so they never move the expected number on
 * their own.
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
  /** observed training that changed the high end */
  observationsUsed: Observation[];
  /** months since their last full-power meet */
  monthsSinceMeet: number | null;
};

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

export function readCompetitor(input: {
  meets: MeetRecord[];
  today: string;
  meetDate: string;
  observations?: Observation[];
  increment?: number;
}): CompetitorRead {
  const step = input.increment ?? 2.5;
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
  const basis: string[] = [];

  let projection: CompetitorRead["projection"] = null;
  let confidence: Confidence = "low";
  if (recent && best) {
    const stale = (monthsSince ?? 99) > 18;
    // start from their recent level; a stale recent meet leans on the best a little
    const base = stale ? Math.max(recent.total!, best.total! * 0.97) : recent.total!;
    const yearsAhead = Math.max(0, daysBetween(recent.date, input.meetDate) / 365.25);
    const trend = slope ?? 0;
    const capUp = base * 0.06;
    const capDown = base * 0.05;
    // half the recent trend continues, capped: lifters rarely keep a steep early-career slope
    const gain = Math.max(-capDown, Math.min(capUp, trend * yearsAhead * 0.5));
    let expected = base + gain;
    let high = Math.max(best.total!, base + Math.max(0, trend) * yearsAhead) * 1.02;
    high = Math.min(high, base * 1.1);
    let conservative = Math.min(base, expected) * 0.97;
    basis.push(`Last total ${recent.total} kg (${recent.date})`);
    if (best.date !== recent.date) basis.push(`Best total ${best.total} kg (${best.date})`);
    if (slope != null) basis.push(`Recent trend ${slope > 0 ? "+" : ""}${slope} kg a year`);
    if (stale) basis.push(`No meet in ${monthsSince} months`);

    // observed training: competition-standard, recent, heavier than they've made
    const used: Observation[] = [];
    for (const o of input.observations ?? []) {
      if (!o.lift || o.standard !== "competition" || o.reps > 2 || o.confidence === "low") continue;
      if (daysBetween(o.date, input.today) > 84) continue;
      const made = bests[o.lift];
      const implied = o.reps === 2 ? o.loadKg * 1.035 : o.loadKg;
      if (made != null && implied > made) {
        used.push(o);
        high += implied - made;
        basis.push(
          `Reported ${o.exercise} ${o.loadKg} kg × ${o.reps} (${o.date}) is over their meet best`,
        );
      }
    }
    expected = Math.max(expected, conservative);
    high = Math.max(high, expected);
    const lifts = Object.fromEntries(
      LIFTS.map((l) => {
        const share = recent.total && lastSplit[l] ? lastSplit[l]! / recent.total : null;
        if (share == null) return [l, null];
        return [
          l,
          {
            conservative: roundTo(conservative * share, step),
            expected: roundTo(expected * share, step),
            high: roundTo(high * share, step),
          },
        ];
      }),
    ) as Record<Lift, Range | null>;
    projection = {
      conservative: roundTo(conservative, step),
      expected: roundTo(expected, step),
      high: roundTo(high, step),
      lifts,
    };
    confidence =
      (monthsSince ?? 99) <= 9 && withTotal.length >= 3
        ? "high"
        : (monthsSince ?? 99) <= 18
          ? "medium"
          : "low";
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
      stats: attemptStats(fp),
      projection,
      confidence,
      basis,
      observationsUsed: used,
      monthsSinceMeet: monthsSince,
    };
  }

  // no meet total: a manually entered competitor with only observations, or a first-timer
  const obs = (input.observations ?? []).filter(
    (o) =>
      o.lift &&
      o.standard === "competition" &&
      o.reps <= 3 &&
      daysBetween(o.date, input.today) <= 120,
  );
  if (obs.length) {
    const top = Object.fromEntries(
      LIFTS.map((l) => [
        l,
        obs
          .filter((o) => o.lift === l)
          .reduce<number | null>((b, o) => {
            const v = o.reps === 1 ? o.loadKg : o.loadKg * (1 + o.reps / 30);
            return b == null || v > b ? v : b;
          }, null),
      ]),
    ) as Record<Lift, number | null>;
    if (LIFTS.every((l) => top[l] != null)) {
      const t = LIFTS.reduce((s, l) => s + top[l]!, 0);
      projection = {
        conservative: roundTo(t * 0.92, step),
        expected: roundTo(t * 0.97, step),
        high: roundTo(t * 1.02, step),
        lifts: Object.fromEntries(
          LIFTS.map((l) => [
            l,
            {
              conservative: roundTo(top[l]! * 0.92, step),
              expected: roundTo(top[l]! * 0.97, step),
              high: roundTo(top[l]! * 1.02, step),
            },
          ]),
        ) as Record<Lift, Range>,
      };
      basis.push("No meet on record: read from reported training only");
    }
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
    stats: attemptStats(fp),
    projection,
    confidence: "low",
    basis,
    observationsUsed: obs,
    monthsSinceMeet: null,
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
