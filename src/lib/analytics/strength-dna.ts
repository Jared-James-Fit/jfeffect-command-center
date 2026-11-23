/**
 * Strength DNA: what an SBD total is made of (pure, deterministic, tested).
 *
 * Three totals, never mixed into each other:
 *  - MEET: what was lifted on the platform that day (each meet its own
 *    total, its own bodyweight and GL points from the IPF formula).
 *  - BEST LIFTS: each competition lift's heaviest single actually lifted (a
 *    meet, a tested 1RM on file, or a single logged in training), each with
 *    its own day. Their sum is a "best lifts" total, said to be from
 *    different days whenever it is, and it never gets a bodyweight or GL.
 *  - ESTIMATED NOW: each lift's best estimate from a hard set in the last
 *    CURRENT_DAYS (strength-read's comparable rule). Only when all three
 *    lifts have one; an old estimate is never added to a current one.
 * A meet total is never put beside a training estimate as if it were one
 * number: they're separate sources, each said for what it is.
 *
 * The split is each lift's share of its own total. It's compared with
 * (a) a typical raw lifter of the athlete's sex (strength-split.ts, its
 * sources there) and (b) the athlete's own history of the same kind of total
 * (other meets; earlier months' estimates). A share counts as leaning only
 * past LEAN_POINTS (2 percentage points), and every line is descriptive: a
 * share of a total can't say which lift to train.
 * Every load is lb (getClientResults' unit); the screen converts.
 */
import { glPoints } from "@/lib/gl-points";
import { LEAN_POINTS, TYPICAL_SPLIT } from "@/lib/strength-split";
import {
  COMP_LIFTS,
  COMP_LIFT_LABEL,
  CURRENT_DAYS,
  compLiftOfResult,
  type CompLift,
  type MeetResult,
  type StrengthPoint,
} from "@/lib/analytics/competition-strength";
import type { MaxOnFile } from "@/lib/analytics/analytics-areas";
import { LB_PER_KG } from "@/lib/analytics/units";

export type DnaKind = "meet" | "best" | "estimate";
export const DNA_KIND_LABEL: Record<DnaKind, string> = {
  meet: "Meet",
  best: "Best lifts",
  estimate: "Estimated now",
};

export type DnaSex = "male" | "female";

/** One lift inside a total: what it is, where it's from, its share. */
export type DnaPart = {
  lift: CompLift;
  lb: number;
  share: number;
  /** the day it was lifted / estimated (yyyy-mm-dd) */
  day: string | null;
  /** where it's from, in words: "Commonwealth Championships", "Tested 1RM", "Training single", "From 405 × 3 @ RPE 8" */
  from: string;
  source: "meet" | "tested" | "training" | "estimate";
  /** an estimate's set (load in lb) */
  set?: { load: number; reps: number; effort: number };
};

export type DnaTotal = {
  kind: DnaKind;
  key: string;
  /** "Commonwealth Championships", "Best lifts", "Estimated now" */
  label: string;
  /** the meet's day; for best lifts / estimates the latest part's day */
  day: string | null;
  parts: Record<CompLift, DnaPart>;
  totalLb: number;
  /** all three parts from one day (a meet, always) */
  sameDay: boolean;
  /** bodyweight that day (a meet's own; the week's weigh-ins for an estimate); null for best lifts */
  bodyweightLb: number | null;
  /** IPF GL points (classic): a meet's from its bodyweight; an estimate's labelled one */
  gl: { value: number; estimate: boolean } | null;
};

const DAY = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const round1 = (n: number) => Math.round(n * 10) / 10;

function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function withShares(parts: Record<CompLift, Omit<DnaPart, "share">>): {
  parts: Record<CompLift, DnaPart>;
  total: number;
} {
  const total = COMP_LIFTS.reduce((a, l) => a + parts[l].lb, 0);
  const out = {} as Record<CompLift, DnaPart>;
  for (const l of COMP_LIFTS) out[l] = { ...parts[l], share: total > 0 ? parts[l].lb / total : 0 };
  return { parts: out, total };
}

function glFor(
  totalLb: number,
  bwLb: number | null,
  sex: DnaSex | null,
  estimate: boolean,
): DnaTotal["gl"] {
  if (!bwLb || !sex) return null;
  const v = glPoints(totalLb / LB_PER_KG, bwLb / LB_PER_KG, sex === "male" ? "M" : "F");
  return v == null ? null : { value: Math.round(v * 10) / 10, estimate };
}

/** Each meet as its own total, newest first. */
export function meetTotals(meets: MeetResult[], sex: DnaSex | null): DnaTotal[] {
  return meets.map((m) => {
    const name = m.name ?? "Meet";
    const { parts, total } = withShares({
      squat: { lift: "squat", lb: m.lifts.squat, day: m.date, from: name, source: "meet" },
      bench: { lift: "bench", lb: m.lifts.bench, day: m.date, from: name, source: "meet" },
      deadlift: { lift: "deadlift", lb: m.lifts.deadlift, day: m.date, from: name, source: "meet" },
    });
    return {
      kind: "meet" as const,
      key: `meet:${m.date}`,
      label: name,
      day: m.date,
      parts,
      totalLb: total,
      sameDay: true,
      bodyweightLb: m.bodyweightLb,
      gl: glFor(total, m.bodyweightLb, sex, false),
    };
  });
}

/** The heaviest single logged in training per competition lift (a set of 1 that was done), with its day. */
export function trainingSingles(
  results: any[],
): Partial<Record<CompLift, { lb: number; day: string }>> {
  const out: Partial<Record<CompLift, { lb: number; day: string }>> = {};
  for (const r of results ?? []) {
    const lift = compLiftOfResult(r);
    if (!lift || !r?.date || Number(r.reps) !== 1 || r.counts_load === false) continue;
    const lb = Number(r.load) || 0;
    if (!(lb > 0)) continue;
    const cur = out[lift];
    if (!cur || lb > cur.lb) out[lift] = { lb, day: localDay(r.date) };
  }
  return out;
}

/**
 * Each lift's heaviest single actually lifted (meet, tested 1RM on file, or a
 * training single). Null unless all three have one.
 */
export function bestLiftsTotal(input: {
  meets: MeetResult[];
  maxes?: MaxOnFile[];
  singles?: Partial<Record<CompLift, { lb: number; day: string }>>;
  today: string;
}): DnaTotal | null {
  const parts = {} as Record<CompLift, Omit<DnaPart, "share">>;
  for (const lift of COMP_LIFTS) {
    const cands: Array<Omit<DnaPart, "share">> = [];
    for (const m of input.meets) {
      if (m.date <= input.today)
        cands.push({
          lift,
          lb: m.lifts[lift],
          day: m.date,
          from: m.name ?? "Meet",
          source: "meet",
        });
    }
    for (const t of input.maxes ?? []) {
      if (t.lift === lift && t.kind === "tested" && t.lb > 0)
        cands.push({ lift, lb: t.lb, day: t.date, from: "Tested 1RM", source: "tested" });
    }
    const s = input.singles?.[lift];
    if (s && s.day <= input.today)
      cands.push({ lift, lb: s.lb, day: s.day, from: "Training single", source: "training" });
    // heaviest; a tie goes to the platform, then the earlier day (when it was first lifted)
    const rank = { meet: 0, tested: 1, training: 2, estimate: 3 } as const;
    const best = cands.sort(
      (a, b) =>
        b.lb - a.lb ||
        rank[a.source] - rank[b.source] ||
        String(a.day ?? "").localeCompare(String(b.day ?? "")),
    )[0];
    if (!best) return null;
    parts[lift] = best;
  }
  const { parts: withShare, total } = withShares(parts);
  const days = COMP_LIFTS.map((l) => withShare[l].day).filter((d): d is string => !!d);
  const sameDay = days.length === 3 && new Set(days).size === 1;
  return {
    kind: "best",
    key: "best",
    label: "Best lifts",
    day: days.sort().at(-1) ?? null,
    parts: withShare,
    totalLb: total,
    sameDay,
    bodyweightLb: null,
    gl: null,
  };
}

/** Average weigh-in over the 7 days up to a day (lb), else the last within 14 days, else null. */
export function bodyweightAt(
  day: string,
  weighIns: Array<{ day: string; lb: number }>,
): number | null {
  const t = dayMs(day);
  const near = weighIns.filter((w) => {
    const d = (t - dayMs(w.day)) / DAY;
    return d >= 0 && d <= 6;
  });
  if (near.length) return near.reduce((a, w) => a + w.lb, 0) / near.length;
  const prior = weighIns.filter((w) => w.day <= day).sort((a, b) => a.day.localeCompare(b.day));
  const last = prior.at(-1);
  return last && (t - dayMs(last.day)) / DAY <= 14 ? last.lb : null;
}

/**
 * The estimated total at a day: each lift's best comparable estimate in the
 * CURRENT_DAYS up to it. Null unless all three have one.
 */
export function estimateTotalAt(input: {
  points: StrengthPoint[];
  day: string;
  weighIns?: Array<{ day: string; lb: number }>;
  sex: DnaSex | null;
  key?: string;
  label?: string;
}): DnaTotal | null {
  const t = dayMs(input.day);
  const parts = {} as Record<CompLift, Omit<DnaPart, "share">>;
  for (const lift of COMP_LIFTS) {
    const window = input.points.filter(
      (p) => p.lift === lift && p.day <= input.day && (t - dayMs(p.day)) / DAY <= CURRENT_DAYS,
    );
    const best = window.reduce<StrengthPoint | null>(
      (a, p) => (!a || p.e1rm > a.e1rm ? p : a),
      null,
    );
    if (!best) return null;
    parts[lift] = {
      lift,
      lb: best.e1rm,
      day: best.day,
      from: "Estimated from a hard set",
      source: "estimate",
      set: best.set,
    };
  }
  const { parts: withShare, total } = withShares(parts);
  const latest = COMP_LIFTS.map((l) => withShare[l].day!)
    .sort()
    .at(-1)!;
  const bw = input.weighIns?.length ? bodyweightAt(latest, input.weighIns) : null;
  return {
    kind: "estimate",
    key: input.key ?? "estimate",
    label: input.label ?? "Estimated now",
    day: latest,
    parts: withShare,
    totalLb: total,
    sameDay: new Set(COMP_LIFTS.map((l) => withShare[l].day)).size === 1,
    bodyweightLb: bw != null ? round1(bw) : null,
    gl: glFor(total, bw, input.sex, true),
  };
}

/**
 * The estimated total at the end of each month that has one (all three lifts
 * with a hard set in the 6 weeks before), oldest first: how the split has
 * moved in training.
 */
export function monthlyEstimateTotals(input: {
  points: StrengthPoint[];
  today: string;
  weighIns?: Array<{ day: string; lb: number }>;
  sex: DnaSex | null;
}): DnaTotal[] {
  if (!input.points.length) return [];
  const first = input.points[0].day.slice(0, 7);
  const out: DnaTotal[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ty, tm] = input.today.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const day = lastDay < input.today ? lastDay : input.today;
    const monthKey = `${y}-${String(m).padStart(2, "0")}`;
    const tot = estimateTotalAt({
      points: input.points,
      day,
      weighIns: input.weighIns,
      sex: input.sex,
      key: `est:${monthKey}`,
      label: monthKey,
    });
    // a month only counts when one of its own sessions is in it (never last month's carried over)
    if (tot && COMP_LIFTS.some((l) => tot.parts[l].day?.startsWith(monthKey))) out.push(tot);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ── the read ─────────────────────────────────────────────────────────────

export type ShareLine = {
  lift: CompLift;
  /** percentage points from the reference, rounded to a tenth */
  points: number;
  leans: "over" | "under" | null;
};

export type DnaRead = {
  /** against a typical raw lifter of their sex (null without a sex on file) */
  typical: { sex: DnaSex; lines: ShareLine[] } | null;
  /** against their own other totals of the same kind (null with none) */
  own: { label: string; count: number; mean: Record<CompLift, number>; lines: ShareLine[] } | null;
  /** against the previous total of the same kind (null with none) */
  previous: {
    total: DnaTotal;
    totalLb: number;
    lifts: Record<CompLift, number>;
    sharePoints: Record<CompLift, number>;
    days: number;
  } | null;
  /** bench ÷ squat and deadlift ÷ squat, with a typical lifter's beside them */
  ratios: Array<{
    key: "bench_squat" | "dead_squat";
    label: string;
    value: number;
    typical: number | null;
  }>;
  /** total ÷ bodyweight (only with a bodyweight that day) */
  timesBodyweight: number | null;
  /** short, descriptive lines, the most useful first (at most 3) */
  notes: string[];
};

const pts = (a: number, b: number) => Math.round((a - b) * 1000) / 10;
const leanOf = (p: number): ShareLine["leans"] =>
  p >= LEAN_POINTS ? "over" : p <= -LEAN_POINTS ? "under" : null;
const pctWord = (share: number) => `${(Math.round(share * 1000) / 10).toFixed(1)}%`;

/**
 * What a total's split says, against a typical lifter and against their own
 * history. `history` is every other total of the same kind (any order).
 */
export function readDna(
  total: DnaTotal,
  sex: DnaSex | null,
  history: DnaTotal[],
  opts: { delta?: (lb: number) => string } = {},
): DnaRead {
  const delta =
    opts.delta ?? ((lb: number) => `${lb > 0 ? "+" : "−"}${Math.round(Math.abs(lb))} lb`);
  const typical = sex
    ? {
        sex,
        lines: COMP_LIFTS.map((lift) => {
          const p = pts(total.parts[lift].share, TYPICAL_SPLIT[sex][lift]);
          return { lift, points: p, leans: leanOf(p) };
        }),
      }
    : null;
  const others = history.filter((h) => h.key !== total.key && h.kind === total.kind);
  let own: DnaRead["own"] = null;
  if (others.length) {
    const mean = {} as Record<CompLift, number>;
    for (const lift of COMP_LIFTS)
      mean[lift] = others.reduce((a, h) => a + h.parts[lift].share, 0) / others.length;
    own = {
      label:
        total.kind === "meet"
          ? others.length === 1
            ? "your other meet"
            : `your other ${others.length} meets`
          : `your earlier months`,
      count: others.length,
      mean,
      lines: COMP_LIFTS.map((lift) => {
        const p = pts(total.parts[lift].share, mean[lift]);
        return { lift, points: p, leans: leanOf(p) };
      }),
    };
  }
  const before = others
    .filter((h) => h.day && total.day && h.day < total.day)
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))[0];
  const previous: DnaRead["previous"] = before
    ? {
        total: before,
        totalLb: total.totalLb - before.totalLb,
        lifts: Object.fromEntries(
          COMP_LIFTS.map((l) => [l, total.parts[l].lb - before.parts[l].lb]),
        ) as Record<CompLift, number>,
        sharePoints: Object.fromEntries(
          COMP_LIFTS.map((l) => [l, pts(total.parts[l].share, before.parts[l].share)]),
        ) as Record<CompLift, number>,
        days: Math.round((dayMs(total.day!) - dayMs(before.day!)) / DAY),
      }
    : null;
  const t = sex ? TYPICAL_SPLIT[sex] : null;
  const k = Object.fromEntries(COMP_LIFTS.map((l) => [l, total.parts[l].lb])) as Record<
    CompLift,
    number
  >;
  const ratios: DnaRead["ratios"] = [
    {
      key: "bench_squat",
      label: "Bench ÷ squat",
      value: k.bench / k.squat,
      typical: t ? t.bench / t.squat : null,
    },
    {
      key: "dead_squat",
      label: "Deadlift ÷ squat",
      value: k.deadlift / k.squat,
      typical: t ? t.deadlift / t.squat : null,
    },
  ];
  const timesBodyweight = total.bodyweightLb
    ? Math.round((total.totalLb / total.bodyweightLb) * 100) / 100
    : null;

  // the notes: their own history first (a shift in their own split), then a typical lifter
  const notes: string[] = [];
  if (own) {
    const shift = own.lines
      .filter((l) => l.leans)
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))[0];
    if (shift) {
      notes.push(
        `${COMP_LIFT_LABEL[shift.lift]} is ${pctWord(total.parts[shift.lift].share)} of this total; across ${own.label} it averaged ${pctWord(own.mean[shift.lift])}.`,
      );
    } else if (own.count >= 2) {
      notes.push(`Your split is within ${LEAN_POINTS} points of ${own.label} on every lift.`);
    }
  }
  if (typical) {
    const who = typical.sex === "male" ? "men's" : "women's";
    const lean = typical.lines
      .filter((l) => l.leans)
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
    if (!lean.length) {
      notes.push(`Every lift is within ${LEAN_POINTS} points of the typical raw ${who} split.`);
    } else {
      const l = lean[0];
      notes.push(
        `${COMP_LIFT_LABEL[l.lift]} carries ${l.leans === "over" ? "more" : "less"} of your total than average: ${pctWord(total.parts[l.lift].share)} against ${pctWord(TYPICAL_SPLIT[typical.sex][l.lift])} for raw ${who} totals.`,
      );
    }
  }
  if (previous && Math.abs(previous.totalLb) >= 0.5) {
    const moved = COMP_LIFTS.filter((l) => Math.abs(previous.lifts[l]) >= 0.5);
    if (moved.length) {
      const biggest = moved.sort(
        (a, b) => Math.abs(previous.lifts[b]) - Math.abs(previous.lifts[a]),
      )[0];
      notes.push(
        `Since ${before.kind === "meet" ? before.label : "the month before"}, ${COMP_LIFT_LABEL[biggest].toLowerCase()} moved the most (${delta(previous.lifts[biggest])}).`,
      );
    }
  }
  return { typical, own, previous, ratios, timesBodyweight, notes: notes.slice(0, 3) };
}

/** The total a screen should open on: the estimate when there is one, else the last meet, else best lifts. */
export function defaultDnaKind(have: Record<DnaKind, boolean>): DnaKind | null {
  if (have.estimate) return "estimate";
  if (have.meet) return "meet";
  if (have.best) return "best";
  return null;
}

/** A share's history for one lift, oldest first: [{ day, share }] (a meet's or a month's estimate). */
export function shareSeries(
  totals: DnaTotal[],
  lift: CompLift,
): Array<{ day: string; share: number; key: string }> {
  return totals
    .filter((t) => t.day)
    .map((t) => ({ day: t.day!, share: t.parts[lift].share, key: t.key }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
