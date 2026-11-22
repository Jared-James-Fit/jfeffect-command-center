/**
 * Training analytics in four areas (Strength, Volume, Consistency, Recovery),
 * read the same way on the analytics page, its Overview and the Workouts
 * dashboard's progress snapshot. Pure and tested (analytics-areas.test.ts):
 * the screens only draw what this returns.
 *
 * Rules every chart here keeps (Nov 22 2026, the second analytics pass):
 *  - One lift on one axis by default. Squat, bench and deadlift live hundreds
 *    of pounds apart, so three lines on one axis drew each as a flat line and
 *    made a 5 lb wobble look like a cliff. Comparing them is a separate view in
 *    % change from a stated day (`normalizedSeries`), labelled as such.
 *  - A line never joins observations too far apart to be one trend
 *    (`GAP_DAYS`): a gap breaks it instead of drawing a slope nobody lifted.
 *  - An axis never zooms in past what the numbers can show (`niceDomain`'s
 *    minimum span): a 1 lb change in an estimated max is noise, and an axis of
 *    308–312 lb drew it as a crash.
 *  - Every change says what it's measured from ("+12 lb since Aug 31").
 *  - Estimates, meet results, tested maxes and training maxes are four
 *    different things, kept apart and named (`MaxKind`).
 */
import {
  bucketPoints,
  COMP_LIFTS,
  grainFor,
  type CompLift,
  type Grain,
  type MeetResult,
  type StrengthPoint,
} from "@/lib/analytics/competition-strength";
import { strengthTrend, type StrengthTrend } from "@/lib/analytics/strength-read";
import type { TrainingLoad, WeekLoad } from "@/lib/analytics/training-load";

const DAY = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day.slice(0, 10)}T12:00:00Z`);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The longest gap (days) a line joins at each grain; a longer one breaks the line. */
export const GAP_DAYS: Record<Grain, number> = { session: 28, week: 42, month: 75 };

export type SeriesPoint = {
  /** ms at noon UTC of `day`: a time axis */
  t: number;
  day: string;
  /** null = a break in the line (the gap before the next observation is too long) */
  value: number | null;
  point?: StrengthPoint;
};

/** One lift's estimated max in a period, at the period's grain, with a break wherever the gap is too long. */
export function liftSeries(
  points: StrengthPoint[],
  lift: CompLift,
  startDay: string,
  endDay: string,
  grain?: Grain,
): SeriesPoint[] {
  const g = grain ?? grainFor(Math.max(1, (dayMs(endDay) - dayMs(startDay)) / DAY));
  const inRange = points.filter((p) => p.lift === lift && p.day >= startDay && p.day <= endDay);
  const bucketed = bucketPoints(inRange, g);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < bucketed.length; i++) {
    const p = bucketed[i];
    const prev = bucketed[i - 1];
    if (prev && (dayMs(p.day) - dayMs(prev.day)) / DAY > GAP_DAYS[g]) {
      const mid = Math.round((dayMs(p.day) + dayMs(prev.day)) / 2);
      out.push({ t: mid, day: new Date(mid).toISOString().slice(0, 10), value: null });
    }
    out.push({ t: dayMs(p.day), day: p.day, value: p.e1rm, point: p });
  }
  return out;
}

/** The step a set of ticks moves in: 1, 2, 2.5, 5, 10, 20, 25, 50, … whatever gives ~4 ticks. */
function niceStep(span: number, ticks = 4): number {
  const raw = span / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

/**
 * An axis for the values on screen that never zooms in past `minSpan` (the
 * smallest change worth drawing as a change) and starts no lower than
 * `floor`. Ticks are round numbers.
 */
export function niceDomain(
  values: number[],
  opts: { minSpan: number; floor?: number; ticks?: number },
): { domain: [number, number]; ticks: number[] } {
  const vs = values.filter((v) => Number.isFinite(v));
  if (!vs.length) return { domain: [0, 1], ticks: [0, 1] };
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < opts.minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - opts.minSpan / 2;
    hi = mid + opts.minSpan / 2;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  if (opts.floor != null) lo = Math.max(opts.floor, lo);
  const step = niceStep(hi - lo, opts.ticks ?? 4);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { domain: [a, b], ticks };
}

/** The smallest change in an estimated max worth drawing as a change: 6% of it, at least 10 lb. */
export function strengthMinSpan(values: number[]): number {
  const vs = values.filter((v) => v > 0);
  const mean = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
  return Math.max(10, mean * 0.06);
}

export type LiftSummary = {
  lift: CompLift;
  /** the period's latest hard-set estimate */
  latest: StrengthPoint | null;
  /** the period's best */
  best: StrengthPoint | null;
  /** best of the first few against best of the last few (strength-read's rule), with their days */
  trend: StrengthTrend;
  /** hard sessions behind the read */
  sessions: number;
};

export function liftSummary(
  points: StrengthPoint[],
  lift: CompLift,
  startDay: string,
  endDay: string,
): LiftSummary {
  const pts = points.filter((p) => p.lift === lift && p.day >= startDay && p.day <= endDay);
  const latest = pts[pts.length - 1] ?? null;
  const best = pts.reduce<StrengthPoint | null>((a, p) => (!a || p.e1rm > a.e1rm ? p : a), null);
  return {
    lift,
    latest,
    best,
    trend: strengthTrend(pts.map((p) => ({ date: p.day, value: p.e1rm }))),
    sessions: pts.length,
  };
}

/** "+12 lb since Aug 31", "No change since Aug 31", or why there's no read yet. Units already converted by `conv`. */
export function changeWords(
  t: StrengthTrend,
  conv: (lb: number) => number,
  unit: string,
  fmtDay: (day: string) => string,
): { text: string; tone: "up" | "down" | "flat" | "none" } {
  if (t.kind === "unclear") {
    return {
      text:
        t.reason === "few" ? "Needs a few more hard sets (RPE 7+)" : "Needs 3+ weeks of hard sets",
      tone: "none",
    };
  }
  const diff = Math.round(conv(t.last) - conv(t.first));
  const since = `since ${fmtDay(t.firstDate)}`;
  if (t.kind === "steady") return { text: `About the same ${since}`, tone: "flat" };
  return {
    text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} ${unit} ${since}`,
    tone: t.kind === "up" ? "up" : "down",
  };
}

export type NormalizedPoint = { t: number; day: string } & Record<
  string,
  number | string | null | undefined
>;

/** The Monday (or the 1st, by month) a day's bucket starts on: lifts trained on different days line up. */
function bucketStart(day: string, grain: "week" | "month"): string {
  if (grain === "month") return `${day.slice(0, 7)}-01`;
  const n = Math.floor(dayMs(day) / DAY);
  const dow = (new Date(n * DAY).getUTCDay() + 6) % 7;
  return new Date((n - dow) * DAY).toISOString().slice(0, 10);
}

/**
 * The three lifts on one axis, each as % change from its own first
 * observation in the period (`baselines`): the only fair way to put a 300 lb
 * bench beside a 600 lb deadlift. Weeks (months on a long period) line the
 * lifts up, since each is trained on its own days; each lift's line is split
 * into `segments` where its gap is too long to be one trend (row keys
 * `${lift}__${n}`), so a missing week of one lift never breaks another's line.
 * A lift with fewer than 2 observations is left out rather than drawn as a dot at 0%.
 */
export function normalizedSeries(
  points: StrengthPoint[],
  startDay: string,
  endDay: string,
  grain?: Grain,
): {
  rows: NormalizedPoint[];
  baselines: Partial<Record<CompLift, { day: string; value: number }>>;
  lifts: CompLift[];
  segments: Partial<Record<CompLift, number>>;
} {
  const g0 = grain ?? grainFor(Math.max(1, (dayMs(endDay) - dayMs(startDay)) / DAY));
  const g: "week" | "month" = g0 === "month" ? "month" : "week";
  const byT = new Map<number, NormalizedPoint>();
  const baselines: Partial<Record<CompLift, { day: string; value: number }>> = {};
  const segments: Partial<Record<CompLift, number>> = {};
  const lifts: CompLift[] = [];
  for (const lift of COMP_LIFTS) {
    const best = new Map<string, StrengthPoint>();
    for (const p of points) {
      if (p.lift !== lift || p.day < startDay || p.day > endDay) continue;
      const k = bucketStart(p.day, g);
      const cur = best.get(k);
      if (!cur || p.e1rm > cur.e1rm) best.set(k, p);
    }
    const keys = [...best.keys()].sort();
    if (keys.length < 2) continue;
    lifts.push(lift);
    const base = best.get(keys[0])!;
    baselines[lift] = { day: base.day, value: base.e1rm };
    let seg = 0;
    keys.forEach((k, i) => {
      if (i > 0 && (dayMs(k) - dayMs(keys[i - 1])) / DAY > GAP_DAYS[g]) seg++;
      const t = dayMs(k);
      const row = byT.get(t) ?? ({ t, day: k } as NormalizedPoint);
      const v = round1((best.get(k)!.e1rm / base.e1rm - 1) * 100);
      row[lift] = v;
      row[`${lift}__${seg}`] = v;
      byT.set(t, row);
    });
    segments[lift] = seg + 1;
  }
  return { rows: [...byT.values()].sort((a, b) => a.t - b.t), baselines, lifts, segments };
}

/** A block's training phase from its name ("Block 3 — Peak" → "Peak"), for comparing like with like. */
const PHASES: Array<[RegExp, string]> = [
  [/off[\s-]?season|pivot|transition/i, "Off-season"],
  [/hypertroph|accumulat|volume|base/i, "Base / volume"],
  [/strength|intensif/i, "Strength"],
  [/peak|realiz/i, "Peak"],
  [/taper|deload|meet week/i, "Taper"],
];
export function phaseOf(name: string | null | undefined): string | null {
  const s = String(name ?? "");
  for (const [re, label] of PHASES) if (re.test(s)) return label;
  return null;
}

export type BlockLike = {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
};
export type BlockStrengthRow = {
  id: string;
  name: string;
  start: string;
  end: string | null;
  phase: string | null;
  best: Partial<Record<CompLift, StrengthPoint>>;
  /** each lift's best against the previous block that trained it (lb) */
  vsPrev: Partial<Record<CompLift, number>>;
};

/**
 * Each block's best hard-set estimate per lift (by the block's own dates),
 * oldest first, with the change from the block before. Only blocks that
 * overlap the period and have a hard set.
 */
export function blockStrengthRows(
  points: StrengthPoint[],
  blocks: BlockLike[],
  startDay: string,
  endDay: string,
): BlockStrengthRow[] {
  const dated = blocks
    .filter((b) => b.start_date)
    .map((b) => ({
      ...b,
      start: b.start_date!.slice(0, 10),
      end: b.end_date ? b.end_date.slice(0, 10) : null,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const rows: BlockStrengthRow[] = [];
  for (let i = 0; i < dated.length; i++) {
    const b = dated[i];
    const until = b.end ?? dated[i + 1]?.start ?? "9999-12-31";
    if (until < startDay || b.start > endDay) continue;
    const best: BlockStrengthRow["best"] = {};
    for (const p of points) {
      if (p.day < b.start || p.day > until) continue;
      // a later block that starts inside this one owns its own days
      if (dated[i + 1] && p.day >= dated[i + 1].start) continue;
      const cur = best[p.lift];
      if (!cur || p.e1rm > cur.e1rm) best[p.lift] = p;
    }
    if (!Object.keys(best).length) continue;
    const clean =
      (b.name ?? "").replace(/^\s*block\s*\d+\s*[—–\-:·]\s*/i, "").trim() || (b.name ?? "Block");
    rows.push({
      id: b.id,
      name: clean,
      start: b.start,
      end: b.end,
      phase: phaseOf(b.name),
      best,
      vsPrev: {},
    });
  }
  for (let i = 0; i < rows.length; i++) {
    for (const lift of COMP_LIFTS) {
      const cur = rows[i].best[lift];
      if (!cur) continue;
      const prev = rows
        .slice(0, i)
        .reverse()
        .find((r) => r.best[lift]);
      if (prev) rows[i].vsPrev[lift] = round1(cur.e1rm - prev.best[lift]!.e1rm);
    }
  }
  return rows;
}

// ── maxes on file ────────────────────────────────────────────────────────

/**
 * What a max on file is. A tested max was lifted (a test day or a meet, with
 * its date); "on file" is a number a coach entered as a 1RM with no test
 * date, said as entered, never as tested; a training max is the coach's
 * number the program reads % loads from, never a measurement.
 */
export type MaxKind = "tested" | "on_file" | "training_max";
export type MaxOnFile = { lift: CompLift; kind: MaxKind; lb: number; date: string | null };

/** A tested max that's the same lift as a meet within 3 days and 1%: the meet already says it. */
export function testedNotMeet(tested: MaxOnFile[], meets: MeetResult[]): MaxOnFile[] {
  return tested.filter((t) => {
    if (t.kind !== "tested" || !t.date) return true;
    return !meets.some(
      (m) =>
        Math.abs(dayMs(m.date) - dayMs(t.date!)) <= 3 * DAY &&
        Math.abs(m.lifts[t.lift] - t.lb) <= m.lifts[t.lift] * 0.01,
    );
  });
}

// ── consistency ──────────────────────────────────────────────────────────

export type AdherenceWeek = {
  key: string;
  label: string;
  planned: number;
  done: number;
  current: boolean;
};

export type Consistency = {
  /** workouts written for days that have passed, and how many have a logged set */
  planned: number | null;
  done: number | null;
  pct: number | null;
  /** sets written for days that have passed, and how many were logged */
  setsPlanned: number | null;
  setsDone: number | null;
  setsPct: number | null;
  weeks: AdherenceWeek[];
  /** the last 4 weeks with a plan against the 4 before: each % of planned workouts done */
  recent: { pct: number; weeks: number } | null;
  before: { pct: number; weeks: number } | null;
  /** workouts logged in the period (with or without a plan) */
  logged: number;
};

const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

export function consistencyOf(load: TrainingLoad): Consistency {
  const t = load.totals;
  const weeks: AdherenceWeek[] = load.weeks
    .filter((w: WeekLoad) => !w.future && (w.plannedSessions ?? 0) > 0)
    .map((w) => ({
      key: w.key,
      label: w.label,
      planned: w.plannedSessions ?? 0,
      done: w.plannedSessionsDone ?? 0,
      current: w.current,
    }));
  const over = weeks.filter((w) => !w.current);
  const sum = (ws: AdherenceWeek[]) => {
    const p = ws.reduce((a, w) => a + w.planned, 0);
    return p > 0
      ? { pct: Math.round((ws.reduce((a, w) => a + w.done, 0) / p) * 100), weeks: ws.length }
      : null;
  };
  const recentW = over.slice(-4);
  const beforeW = over.slice(-8, -4);
  return {
    planned: t.plannedSessions,
    done: t.plannedSessionsDone,
    pct: t.plannedSessions ? pctOf(t.plannedSessionsDone ?? 0, t.plannedSessions) : null,
    setsPlanned: t.prescribed,
    setsDone: t.completedOfPrescribed,
    setsPct: t.completionPct,
    weeks,
    recent: recentW.length >= 2 ? sum(recentW) : null,
    before: beforeW.length >= 2 ? sum(beforeW) : null,
    logged: t.sessions,
  };
}

// ── the Workouts dashboard's progress snapshot ───────────────────────────

export type SnapshotMetric = {
  key: "strength" | "workouts" | "prs" | "sets";
  label: string;
  value: string;
  /** what it's measured against, said every time */
  sub: string;
  tone?: "up" | "down" | "record";
};

/**
 * One to three numbers that answer "am I making progress?", picked for the
 * athlete: this month's workouts against the plan (when there is one), the
 * main lift's change over 12 weeks when there are enough hard sets to say,
 * and PRs only when there were some. Nothing at zero, nothing guessed.
 */
export function progressSnapshot(input: {
  month: { label: string; planned: number; done: number };
  /** a powerlifter's main lift and its trend, or, for anyone else, how many lifts are getting stronger */
  strength:
    | {
        name: string;
        trend: StrengthTrend;
        unit: string;
        conv: (lb: number) => number;
        fmtDay: (d: string) => string;
      }
    | { up: number; tracked: number }
    | null;
  prs: { count: number; names: string[] };
  setsLastWeek: number | null;
}): SnapshotMetric[] {
  const out: SnapshotMetric[] = [];
  if (input.month.planned > 0) {
    out.push({
      key: "workouts",
      label: "Workouts",
      value: `${input.month.done} of ${input.month.planned}`,
      sub: `planned so far in ${input.month.label}`,
    });
  }
  const s = input.strength;
  if (s && "tracked" in s) {
    if (s.tracked >= 2) {
      out.push({
        key: "strength",
        label: "Getting stronger",
        value: `${s.up} of ${s.tracked}`,
        sub: "lifts, last 12 weeks",
        tone: s.up > 0 ? "up" : undefined,
      });
    }
  } else if (s && s.trend.kind !== "unclear") {
    const diff = Math.round(s.conv(s.trend.last) - s.conv(s.trend.first));
    out.push({
      key: "strength",
      label: s.name,
      value:
        s.trend.kind === "steady"
          ? "Holding"
          : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} ${s.unit}`,
      sub: `est. max since ${s.fmtDay(s.trend.firstDate)}`,
      tone: s.trend.kind === "up" ? "up" : s.trend.kind === "down" ? "down" : undefined,
    });
  }
  if (input.prs.count > 0) {
    out.push({
      key: "prs",
      label: input.prs.count === 1 ? "PR" : "PRs",
      value: String(input.prs.count),
      sub: input.prs.names.length
        ? input.prs.names.slice(0, 2).join(", ")
        : `in ${input.month.label}`,
      tone: "record",
    });
  }
  if (out.length < 2 && input.setsLastWeek != null && input.setsLastWeek > 0) {
    out.push({
      key: "sets",
      label: "Working sets",
      value: String(input.setsLastWeek),
      sub: "last week",
    });
  }
  return out.slice(0, 3);
}

/** The lift the snapshot speaks for: a powerlifter's competition lift with the most hard sessions in 12 weeks. */
export function snapshotLift(points: StrengthPoint[], todayDay: string): CompLift | null {
  const since = new Date(dayMs(todayDay) - 84 * DAY).toISOString().slice(0, 10);
  let best: CompLift | null = null;
  let n = 0;
  for (const lift of COMP_LIFTS) {
    const c = points.filter((p) => p.lift === lift && p.day >= since && p.day <= todayDay).length;
    if (c > n) {
      n = c;
      best = lift;
    }
  }
  return n >= 4 ? best : null;
}

// ── cardio ───────────────────────────────────────────────────────────────

/**
 * How a cardio session's targets read: the primary one (time, else steps,
 * else calories) said big, and only when there are others, what else counts
 * as done. Calories are a machine's or a watch's estimate and are said so,
 * never as a precise target.
 */
export function cardioTargetsView(input: {
  minutes?: number | null;
  steps?: number | null;
  calories?: number | null;
  showCalories?: boolean;
}): { primary: string | null; alternatives: string | null } {
  const m = Number(input.minutes) > 0 ? Number(input.minutes) : null;
  const st = Number(input.steps) > 0 ? Number(input.steps) : null;
  const cal =
    input.showCalories !== false && Number(input.calories) > 0 ? Number(input.calories) : null;
  const parts: string[] = [];
  let primary: string | null = null;
  if (m) primary = `${m} min`;
  else if (st) primary = `${st.toLocaleString()} steps`;
  else if (cal) primary = `~${cal} cal`;
  if (st && primary !== `${st.toLocaleString()} steps`) parts.push(`${st.toLocaleString()} steps`);
  if (cal && primary !== `~${cal} cal`) parts.push(`~${cal} cal on the machine (an estimate)`);
  return {
    primary,
    alternatives: parts.length ? `Or stop at ${parts.join(", or ")}, whichever comes first` : null,
  };
}

/**
 * A cardio target's note as the athlete reads it: without the old boilerplate
 * rule ("Complete the session when ANY ONE target is reached…", 12 of 32 targets
 * on Nov 22 2026), which the card's targets now show, and without a restated
 * "Incline 5 · speed 2–3 mph" the settings line already says. The stored note
 * is never changed; a coach's own words always show.
 */
export function cardioNoteForAthlete(note: string | null | undefined): string | null {
  let s = String(note ?? "").trim();
  if (!s) return null;
  s = s
    .replace(/complete the session when any\s+one target is reached[;.,]?\s*/gi, "")
    .replace(/stop when whichever target comes first[.;]?\s*/gi, "")
    .trim();
  if (
    /^incline\s*[\d.]+%?\s*[·,]\s*speed\s*[\d.]+(?:\s*[–-]\s*[\d.]+)?\s*(?:mph|km\/h|kph)\.?$/i.test(
      s,
    )
  )
    return null;
  s = s.replace(/^[\s.;,·]+|[\s;,·]+$/g, "").trim();
  return s ? s : null;
}

/** True when the note says nothing beyond the targets and settings the card already shows. */
export function isBoilerplateCardioNote(note: string | null | undefined): boolean {
  return !!String(note ?? "").trim() && cardioNoteForAthlete(note) == null;
}

// ── strength for anyone: how many lifts are moving ───────────────────────

export type LiftsTrending = {
  /** exercises with enough hard sessions in the period to read a trend */
  tracked: number;
  up: number;
  steady: number;
  down: number;
  /** the tracked ones, the biggest gain first: name, trend */
  lifts: Array<{ name: string; trend: Extract<StrengthTrend, { pct: number }> }>;
};

/**
 * Every exercise with enough hard sessions in the period (strength-read's
 * rule: 4+ sessions over 3+ weeks of sets at RPE 7+, ≤10 reps), and which way
 * its estimated max went. The answer a beginner or a bodybuilder can read in
 * five seconds ("up on 3 of 5 lifts") without one lift standing for all.
 */
export function liftsTrending(
  results: Array<{
    exercise_name?: string;
    date?: string | null;
    load?: number;
    reps?: number;
    rpe?: unknown;
    rir?: unknown;
    counts_load?: boolean;
  }>,
  startDay: string,
  endDay: string,
  comparable: (s: { load: number; reps: number; rpe: unknown; rir: unknown }) => number | null,
): LiftsTrending {
  const byEx = new Map<string, Map<string, number>>();
  for (const r of results ?? []) {
    if (!r?.date || !r.exercise_name || r.counts_load === false) continue;
    // the athlete's own day (a set logged at 11 PM is that day, never tomorrow in UTC)
    const d = new Date(r.date);
    const day = Number.isNaN(d.getTime())
      ? String(r.date).slice(0, 10)
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (day < startDay || day > endDay) continue;
    const e = comparable({
      load: Number(r.load) || 0,
      reps: Number(r.reps) || 0,
      rpe: r.rpe,
      rir: r.rir,
    });
    if (e == null) continue;
    const m = byEx.get(r.exercise_name) ?? new Map<string, number>();
    m.set(day, Math.max(m.get(day) ?? 0, e));
    byEx.set(r.exercise_name, m);
  }
  const lifts: LiftsTrending["lifts"] = [];
  for (const [name, days] of byEx) {
    const t = strengthTrend([...days.entries()].map(([date, value]) => ({ date, value })));
    if (t.kind !== "unclear") lifts.push({ name, trend: t });
  }
  lifts.sort((a, b) => b.trend.pct - a.trend.pct);
  return {
    tracked: lifts.length,
    up: lifts.filter((l) => l.trend.kind === "up").length,
    steady: lifts.filter((l) => l.trend.kind === "steady").length,
    down: lifts.filter((l) => l.trend.kind === "down").length,
    lifts,
  };
}

// ── volume by block ──────────────────────────────────────────────────────

export type BlockVolumeRow = {
  id: string;
  name: string;
  start: string;
  phase: string | null;
  /** working sets a week over the block's weeks that are over (weeks off count as zero) */
  setsPerWeek: number;
  hardShare: number | null;
  sessionsPerWeek: number;
  weeks: number;
};

/** Each block's weekly working sets (its finished weeks, by its own dates), oldest first. */
export function blockVolumeRows(weeks: WeekLoad[], blocks: BlockLike[]): BlockVolumeRow[] {
  const dated = blocks
    .filter((b) => b.start_date)
    .map((b) => ({
      ...b,
      start: b.start_date!.slice(0, 10),
      end: b.end_date ? b.end_date.slice(0, 10) : null,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const out: BlockVolumeRow[] = [];
  for (let i = 0; i < dated.length; i++) {
    const b = dated[i];
    const until =
      b.end ??
      (dated[i + 1]
        ? new Date(dayMs(dated[i + 1].start) - DAY).toISOString().slice(0, 10)
        : "9999-12-31");
    // a week belongs to the block its Thursday falls in
    const ws = weeks.filter((w) => {
      if (w.future || w.current) return false;
      const thu = new Date(dayMs(w.key) + 3 * DAY).toISOString().slice(0, 10);
      return thu >= b.start && thu <= until;
    });
    if (!ws.length || !ws.some((w) => w.sets > 0)) continue;
    const sets = ws.reduce((a, w) => a + w.sets, 0);
    const hard = ws.reduce((a, w) => a + w.hardSets, 0);
    const rated = sets - ws.reduce((a, w) => a + w.unratedSets, 0);
    const clean =
      (b.name ?? "").replace(/^\s*block\s*\d+\s*[—–\-:·]\s*/i, "").trim() || (b.name ?? "Block");
    out.push({
      id: b.id,
      name: clean,
      start: b.start,
      phase: phaseOf(b.name),
      setsPerWeek: round1(sets / ws.length),
      hardShare: rated > 0 ? Math.round((hard / rated) * 100) : null,
      sessionsPerWeek: round1(ws.reduce((a, w) => a + w.sessions, 0) / ws.length),
      weeks: ws.length,
    });
  }
  return out;
}

/**
 * pl_client_maxes rows → each competition lift's maxes on file, said for what
 * they are: a tested 1RM (source "tested" or a test date), a 1RM a coach typed
 * in with no test date ("on_file"), and the training max the program reads %
 * loads from. The newest of each kind per lift (by when it was last updated).
 * Before Nov 22 2026 the screen called whichever was newest "Training max"
 * (Jared's "600" deadlift was an entered 1RM; his training max column was empty).
 */
export function maxesFromRows(
  rows: Array<{
    lift?: string | null;
    one_rm?: unknown;
    training_max?: unknown;
    source?: string | null;
    unit?: string | null;
    tested_at?: string | null;
    updated_at?: string | null;
  }>,
  liftOf: (name: string | null | undefined) => CompLift | null,
): MaxOnFile[] {
  const LB = 2.2046226;
  const latest = new Map<string, MaxOnFile & { stamp: string }>();
  const keep = (m: MaxOnFile, stamp: string) => {
    const k = `${m.lift}|${m.kind}`;
    const cur = latest.get(k);
    if (!cur || stamp > cur.stamp) latest.set(k, { ...m, stamp });
  };
  for (const r of rows ?? []) {
    const lift = liftOf(r.lift ?? null);
    if (!lift) continue;
    const toLb = (v: unknown) => {
      const n = Number(v);
      return n > 0 ? (r.unit === "kg" ? n * LB : n) : null;
    };
    const stamp = String(r.updated_at ?? r.tested_at ?? "");
    const oneRm = toLb(r.one_rm);
    const tm = toLb(r.training_max);
    if (oneRm != null) {
      const tested = r.source === "tested" || !!r.tested_at;
      keep(
        {
          lift,
          kind: tested ? "tested" : "on_file",
          lb: oneRm,
          date: tested ? (r.tested_at ?? null) : (r.updated_at ?? null),
        },
        stamp,
      );
    }
    if (tm != null) keep({ lift, kind: "training_max", lb: tm, date: r.updated_at ?? null }, stamp);
  }
  return [...latest.values()].map(({ stamp: _s, ...m }) => m);
}

/**
 * Round dates for a time axis, at most ~6: weekly or every other week on a
 * short period, else the 1st of every month (every 2nd or 3rd on a long one).
 * Local midnight, like the points' days.
 */
export function timeTicks(startMs: number, endMs: number): number[] {
  const spanDays = (endMs - startMs) / DAY;
  const out: number[] = [];
  if (spanDays <= 120) {
    const step = spanDays <= 45 ? 7 : 14;
    const d = new Date(startMs);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7)); // the first Monday
    for (; d.getTime() <= endMs; d.setDate(d.getDate() + step)) out.push(d.getTime());
    return out;
  }
  const months = Math.ceil(spanDays / 30.4);
  const step = months <= 7 ? 1 : months <= 14 ? 2 : months <= 24 ? 3 : 6;
  const d = new Date(startMs);
  d.setDate(1);
  d.setHours(12, 0, 0, 0);
  if (d.getTime() < startMs) d.setMonth(d.getMonth() + 1);
  for (; d.getTime() <= endMs; d.setMonth(d.getMonth() + step)) out.push(d.getTime());
  return out;
}
