/**
 * Squat, bench and deadlift workload over time, one metric at a time (pure,
 * tested in analytics-redesign.test.ts). One chart reads this: a metric
 * picker, a lift filter (one lift or all three), competition lift, barbell
 * variations or both, and the grain (day, week, month, block).
 *
 * Definitions, said the same on screen:
 *  - Working sets only (warm-ups live in their own table and never count).
 *  - A variation is a BARBELL variation of the lift (`rangeLift`: never a
 *    dumbbell, machine or belt-squat lift), so a load means the same thing
 *    across the chart and tonnage follows one convention: the weight on the
 *    bar × reps.
 *  - Sums (sets, reps, tonnage) stack by lift. Averages (working weight, %
 *    of estimated max, RPE) are per lift and never averaged across lifts: a
 *    "combined average weight" of a squat and a bench means nothing.
 *  - Relative intensity is the set's load as a % of the competition lift's
 *    estimated strength on that day (lift-strength.ts' line), labelled as an
 *    estimate, never a tested max or a training max.
 *  - Average RPE reads rated sets only and says how many.
 *  - Prescribed sets (the outline) are the sets written for these lifts on
 *    workouts dated in the range.
 *  - Tonnage is weight moved, never stimulus or fatigue.
 */
import { rangeLift } from "@/lib/workouts/pick-range";
import { envelopeAt, type EnvelopePoint } from "@/lib/analytics/strength-estimate";
import {
  isCompetition,
  liftOf,
  LIFTS,
  type Lift,
  type LoadSet,
  type PlanRow,
} from "@/lib/analytics/training-load";

export type WorkloadMetric = "sets" | "reps" | "tonnage" | "avgLoad" | "relIntensity" | "avgRpe";
export const WORKLOAD_METRICS: Array<{
  key: WorkloadMetric;
  label: string;
  short: string;
  kind: "sum" | "avg";
}> = [
  { key: "sets", label: "Working sets", short: "Sets", kind: "sum" },
  { key: "reps", label: "Total reps", short: "Reps", kind: "sum" },
  { key: "tonnage", label: "Tonnage", short: "Tonnage", kind: "sum" },
  { key: "avgLoad", label: "Average working weight", short: "Avg weight", kind: "avg" },
  { key: "relIntensity", label: "% of estimated max", short: "% of max", kind: "avg" },
  { key: "avgRpe", label: "Average RPE", short: "RPE", kind: "avg" },
];

export type WorkloadScope = "comp" | "variations" | "both";
export type WorkloadGrain = "day" | "week" | "month" | "block";

export type WorkloadBucket = {
  key: string;
  label: string;
  start: string;
  end: string;
  /** the bucket holds today (not over) */
  current: boolean;
  /** value per lift; null when there's nothing to average */
  values: Record<Lift, number | null>;
  /** how many sets each value reads (an average says how many) */
  n: Record<Lift, number>;
  /** prescribed working sets per lift (sets metric only), null with no plan */
  prescribed: Record<Lift, number> | null;
  /** a block's type label when the grain is block */
  blockName?: string;
};

const DAY = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monday(day: string): string {
  const t = dayMs(day);
  return dayStr(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
}

/** The grain a span reads best at: days for a few weeks, weeks to half a year, then months. */
export function defaultGrain(start: string, end: string): WorkloadGrain {
  const span = (dayMs(end) - dayMs(start)) / DAY;
  if (span <= 21) return "day";
  if (span <= 190) return "week";
  return "month";
}

export function grainsFor(start: string, end: string, hasBlocks: boolean): WorkloadGrain[] {
  const span = (dayMs(end) - dayMs(start)) / DAY;
  const out: WorkloadGrain[] = [];
  if (span <= 56) out.push("day");
  out.push("week");
  if (span > 56) out.push("month");
  if (hasBlocks) out.push("block");
  return out;
}

/** Which of the lift's sets a scope keeps. */
export function inScope(
  s: Pick<
    LoadSet,
    "isCompetitionLift" | "competitionLiftType" | "exercise" | "rowFamily" | "exerciseFamily"
  >,
  scope: WorkloadScope,
): Lift | null {
  const lift = liftOf(s);
  if (!lift) return null;
  const comp = isCompetition(s);
  if (!comp && !rangeLift(lift, s.exercise)) return null;
  if (scope === "comp" && !comp) return null;
  if (scope === "variations" && comp) return null;
  return lift;
}

type BlockRange = { id: string; name: string; start: string; end: string };

function bucketOf(
  day: string,
  grain: WorkloadGrain,
  blocks: BlockRange[],
): { key: string; label: string; start: string; end: string; blockName?: string } | null {
  if (grain === "day") {
    const d = new Date(dayMs(day));
    return { key: day, label: `${M[d.getUTCMonth()]} ${d.getUTCDate()}`, start: day, end: day };
  }
  if (grain === "week") {
    const m = monday(day);
    const d = new Date(dayMs(m));
    return {
      key: m,
      label: `${M[d.getUTCMonth()]} ${d.getUTCDate()}`,
      start: m,
      end: dayStr(dayMs(m) + 6 * DAY),
    };
  }
  if (grain === "month") {
    const key = `${day.slice(0, 7)}-01`;
    const d = new Date(dayMs(key));
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return {
      key,
      label: `${M[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : ""}`,
      start: key,
      end: dayStr(next.getTime() - DAY),
    };
  }
  const b = blocks.find((x) => day >= x.start && day <= x.end);
  return b ? { key: b.id, label: b.name, start: b.start, end: b.end, blockName: b.name } : null;
}

export function buildWorkload(input: {
  sets: LoadSet[];
  plan?: PlanRow[];
  metric: WorkloadMetric;
  scope: WorkloadScope;
  grain: WorkloadGrain;
  start: string;
  end: string;
  today: string;
  /** each competition lift's estimated-strength line, lb (for % of max) */
  envelopes?: Partial<Record<Lift, EnvelopePoint[]>>;
  blocks?: BlockRange[];
}): WorkloadBucket[] {
  const { metric, scope, grain, start, end, today } = input;
  const blocks = (input.blocks ?? [])
    .filter((b) => b.start && b.end)
    .sort((a, b) => a.start.localeCompare(b.start));
  const buckets = new Map<string, WorkloadBucket & { acc: Record<Lift, number[]> }>();
  const ensure = (day: string) => {
    const b = bucketOf(day, grain, blocks);
    if (!b) return null;
    let cur = buckets.get(b.key);
    if (!cur) {
      cur = {
        ...b,
        current: today >= b.start && today <= b.end,
        values: { squat: null, bench: null, deadlift: null },
        n: { squat: 0, bench: 0, deadlift: 0 },
        prescribed: null,
        acc: { squat: [], bench: [], deadlift: [] },
      };
      buckets.set(b.key, cur);
    }
    return cur;
  };
  // every bucket in the range shows, empty or not (a week off is a gap, never skipped)
  if (grain !== "block") {
    for (let t = dayMs(start); t <= dayMs(end); t += DAY) ensure(dayStr(t));
  } else {
    for (const b of blocks) if (b.end >= start && b.start <= end) ensure(b.start);
  }
  for (const s of input.sets ?? []) {
    if (!s?.day || s.day < start || s.day > end || !(s.reps > 0)) continue;
    const lift = inScope(s, scope);
    if (!lift) continue;
    const b = ensure(s.day);
    if (!b) continue;
    const loadLb = s.loadKg * 2.2046226;
    let v: number | null = null;
    switch (metric) {
      case "sets":
        v = 1;
        break;
      case "reps":
        v = s.reps;
        break;
      case "tonnage":
        v = loadLb * s.reps;
        break;
      case "avgLoad":
        v = loadLb > 0 ? loadLb : null;
        break;
      case "relIntensity": {
        const env = input.envelopes?.[lift];
        const at = env ? envelopeAt(env, s.day) : null;
        v = loadLb > 0 && at && at.value > 0 ? (loadLb / at.value) * 100 : null;
        break;
      }
      case "avgRpe": {
        const e =
          s.rpe != null && s.rpe > 0
            ? Math.min(10, s.rpe)
            : s.rir != null && s.rir >= 0
              ? 10 - s.rir
              : null;
        v = e;
        break;
      }
    }
    if (v == null) continue;
    b.acc[lift].push(v);
  }
  const sum = WORKLOAD_METRICS.find((m) => m.key === metric)!.kind === "sum";
  // prescribed sets per lift and bucket
  if (metric === "sets" && input.plan?.length) {
    for (const p of input.plan) {
      if (!p.day || p.day < start || p.day > end || p.isTime) continue;
      const lift = inScope(p, scope);
      if (!lift) continue;
      const b = ensure(p.day);
      if (!b) continue;
      b.prescribed = b.prescribed ?? { squat: 0, bench: 0, deadlift: 0 };
      b.prescribed[lift] += Math.max(0, Number(p.sets) || 0);
    }
  }
  const out: WorkloadBucket[] = [];
  for (const b of [...buckets.values()].sort((x, y) => x.start.localeCompare(y.start))) {
    for (const l of LIFTS) {
      const xs = b.acc[l];
      b.n[l] = xs.length;
      if (!xs.length) b.values[l] = sum ? 0 : null;
      else {
        const total = xs.reduce((a, x) => a + x, 0);
        b.values[l] = Math.round((sum ? total : total / xs.length) * 10) / 10;
      }
    }
    const { acc: _acc, ...rest } = b;
    out.push(rest);
  }
  return out;
}

export type LiftShift = { lift: Lift; from: number; to: number; pct: number | null };

/**
 * How each lift moved across the buckets that are over: the average of the
 * last third against the first third (a sum per bucket, an average weighted
 * by sets), so one odd week never decides it. Null with under 3 buckets.
 */
export function workloadShifts(buckets: WorkloadBucket[], lifts: Lift[] = LIFTS): LiftShift[] {
  const done = buckets.filter((b) => !b.current);
  if (done.length < 3) return [];
  const third = Math.max(1, Math.floor(done.length / 3));
  const avg = (bs: WorkloadBucket[], l: Lift) => {
    const vals = bs.map((b) => b.values[l]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
  };
  const out: LiftShift[] = [];
  for (const l of lifts) {
    const a = avg(done.slice(0, third), l);
    const b = avg(done.slice(-third), l);
    if (a == null || b == null || (a === 0 && b === 0)) continue;
    out.push({
      lift: l,
      from: Math.round(a * 10) / 10,
      to: Math.round(b * 10) / 10,
      pct: a > 0 ? Math.round(((b - a) / a) * 100) : null,
    });
  }
  return out;
}

/**
 * The last `n` finished buckets against the `n` before (Cleo's "the last
 * three weeks"), each lift's average per bucket. Empty without 2n finished.
 */
export function splitShift(buckets: WorkloadBucket[], lifts: Lift[] = LIFTS, n = 3): LiftShift[] {
  const done = buckets.filter((b) => !b.current);
  if (done.length < n * 2) return [];
  const a = done.slice(-2 * n, -n);
  const b = done.slice(-n);
  const out: LiftShift[] = [];
  for (const l of lifts) {
    const av = (bs: WorkloadBucket[]) => {
      const v = bs.map((x) => x.values[l]).filter((x): x is number => x != null);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };
    const from = av(a);
    const to = av(b);
    if (from == null || to == null || (from === 0 && to === 0)) continue;
    out.push({
      lift: l,
      from: Math.round(from * 10) / 10,
      to: Math.round(to * 10) / 10,
      pct: from > 0 ? Math.round(((to - from) / from) * 100) : null,
    });
  }
  return out;
}
