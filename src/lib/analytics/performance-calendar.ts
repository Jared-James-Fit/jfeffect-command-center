/**
 * The performance calendar: every day of training as one read (pure,
 * deterministic, tested), for the analytics Calendar and the Overview's strip.
 *
 * A day says what happened, each thing measured for what it is:
 *  - its workouts: finished (Finish was tapped), logged but not finished, or
 *    a workout the program wrote for it that was never trained (missed, only
 *    once the day is over; an optional one is never missed) or is still
 *    ahead. A workout trained on another day than it was written for is
 *    done on the day it was trained, never missed on the day it was written;
 *  - working sets, hard sets (RPE 7+), reps and loaded volume (weight × reps
 *    of sets with an external load; bodyweight and assisted sets add sets
 *    and reps, never weight);
 *  - strength: the day's estimated max on its main lift against that
 *    exercise's best in the STRENGTH_LOOKBACK_DAYS before it (a ratio, so a
 *    bench day and a deadlift day read on one scale; hard sets only, and only
 *    with STRENGTH_MIN_PRIOR earlier hard sessions to compare with). A day
 *    with no hard set has no strength read: never zero, never "weaker";
 *  - all-time PRs (recentPRs, the Strength tab's records) and its check-out.
 * Heat levels are relative to the athlete's own days (volume by their own
 * quartiles), so a 12-set day reads big for someone who trains 10 sets and
 * ordinary for someone who trains 30. All loads lb; the screen converts.
 */
import { comparableE1rm } from "@/lib/analytics/strength-read";
import { compLiftOfResult, type CompLift } from "@/lib/analytics/competition-strength";

export const STRENGTH_LOOKBACK_DAYS = 180;
export const STRENGTH_MIN_PRIOR = 2;
const DAY = 86_400_000;

export type CalendarMode = "workouts" | "volume" | "strength" | "prs" | "consistency";
export const CALENDAR_MODES: Array<[CalendarMode, string]> = [
  ["workouts", "Workouts"],
  ["volume", "Volume"],
  ["strength", "Strength"],
  ["prs", "PRs"],
  ["consistency", "Consistency"],
];

export type CalCompletion = {
  dayId: string;
  completedAt: string | null;
  activeSeconds: number | null;
  elapsedSeconds: number | null;
  loggingPct: number | null;
};
export type CalPlanned = { dayId: string; date: string; title: string; optional: boolean };
export type CalCheckout = {
  day: string;
  sleepBucket: string | null;
  recovery: number | null;
  pain: boolean | null;
};

export type CalSetLine = {
  id: string;
  load: number;
  reps: number;
  rpe: number | null;
  rir: number | null;
  loadType: "external" | "bodyweight" | "assisted";
  assistLb: number | null;
  /** comparable estimated max (hard set, ≤10 reps), lb */
  e1rm: number | null;
  pr: boolean;
};
export type CalExercise = {
  key: string;
  name: string;
  lift: CompLift | null;
  dayId: string | null;
  sets: CalSetLine[];
  bestE1rm: number | null;
};
export type CalWorkout = {
  dayId: string | null;
  title: string;
  finished: boolean;
  /** written by the program for some day (this one or another) */
  planned: boolean;
  durationMin: number | null;
  loggingPct: number | null;
  sets: number;
};
export type CalStrength = {
  ratio: number;
  exercise: string;
  e1rmLb: number;
  priorBestLb: number;
  /** beat every earlier hard set of that exercise on file */
  newBest: boolean;
};
export type CalPr = {
  exercise: string;
  load: number;
  reps: number;
  rpe: number | null;
  headline: boolean;
};

export type CalDay = {
  day: string;
  /**
   * "untracked": a workout written for a day before the first set was ever
   * logged in the app (they weren't using it yet): never counted as missed.
   */
  status: "done" | "partial" | "missed" | "upcoming" | "untracked" | "rest";
  workouts: CalWorkout[];
  /** written for this date and not trained (missed or still ahead) */
  plannedOpen: CalPlanned[];
  /** optional workouts written for this date and left (never missed) */
  optionalSkipped: number;
  sets: number;
  hardSets: number;
  unratedSets: number;
  reps: number;
  volumeLb: number;
  exercises: CalExercise[];
  strength: CalStrength | null;
  prs: CalPr[];
  checkout: CalCheckout | null;
};

export type PerformanceCalendar = {
  days: Map<string, CalDay>;
  /** first and last day with anything on it */
  first: string | null;
  /** the first day a set was logged (before it, a written workout isn't missed: it wasn't tracked) */
  firstLogged: string | null;
  last: string | null;
  /** the athlete's own volume quartiles (working sets on a training day) */
  setQuartiles: [number, number, number] | null;
  today: string;
};

export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
const dayStr = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => dayStr(dayNum(d) + n);
/** Monday of a day's week */
export function mondayOf(d: string): string {
  const n = dayNum(d);
  const dow = (new Date(n * DAY).getUTCDay() + 6) % 7;
  return dayStr(n - dow);
}
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const exKey = (r: any) =>
  r.exercise_id
    ? `id:${r.exercise_id}`
    : `name:${String(r.exercise_name ?? "")
        .trim()
        .toLowerCase()}`;

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * The read. `results` are getClientResults rows (every logged set on file,
 * load in lb); `prIds` the ids of sets that were all-time PRs (recentPRs),
 * with `headline` for the ones worth leading with.
 */
export function buildPerformanceCalendar(input: {
  results: any[];
  completions?: CalCompletion[];
  planned?: CalPlanned[];
  checkouts?: CalCheckout[];
  prs?: Array<{ id: string; headline: boolean }>;
  today: string;
}): PerformanceCalendar {
  const today = input.today;
  const completions = new Map<string, CalCompletion>();
  for (const c of input.completions ?? []) {
    if (!c.completedAt) continue;
    const prev = completions.get(c.dayId);
    if (!prev || String(c.completedAt) > String(prev.completedAt)) completions.set(c.dayId, c);
  }
  const plannedById = new Map<string, CalPlanned>();
  for (const p of input.planned ?? []) plannedById.set(p.dayId, p);
  const prMap = new Map<string, boolean>();
  for (const p of input.prs ?? []) prMap.set(String(p.id), p.headline);

  const days = new Map<string, CalDay>();
  const blank = (day: string): CalDay => ({
    day,
    status: "rest",
    workouts: [],
    plannedOpen: [],
    optionalSkipped: 0,
    sets: 0,
    hardSets: 0,
    unratedSets: 0,
    reps: 0,
    volumeLb: 0,
    exercises: [],
    strength: null,
    prs: [],
    checkout: null,
  });
  const get = (day: string) => {
    let d = days.get(day);
    if (!d) {
      d = blank(day);
      days.set(day, d);
    }
    return d;
  };

  // ── sets, in the order they were done ──
  const rows = (input.results ?? [])
    .filter((r) => r?.date && Number(r.reps) > 0)
    .slice()
    .sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        (a.row_order ?? 0) - (b.row_order ?? 0) ||
        (a.set_index ?? 0) - (b.set_index ?? 0),
    );
  // a workout's sets belong to the day it started (a set saved past midnight stays with it)
  const sessionDay = new Map<string, string>();
  for (const r of rows) {
    if (r.day_id && !sessionDay.has(r.day_id)) sessionDay.set(r.day_id, localDay(r.date));
  }
  const trained = new Set<string>();
  // per exercise: every hard session's best estimate (for the strength read)
  const history = new Map<string, Array<{ day: string; e1rm: number }>>();
  const exOnDay = new Map<string, CalExercise>();
  const exDay = new Map<CalExercise, string>();
  const workoutOnDay = new Map<string, CalWorkout>();
  for (const r of rows) {
    const day = r.day_id ? sessionDay.get(r.day_id)! : localDay(r.date);
    const d = get(day);
    if (r.day_id) trained.add(r.day_id);
    const loadType: CalSetLine["loadType"] =
      r.load_type === "assisted"
        ? "assisted"
        : r.load_type === "bodyweight" || r.is_bodyweight
          ? "bodyweight"
          : "external";
    const load = Number(r.load) || 0;
    const reps = Number(r.reps) || 0;
    const rpe = num(r.rpe);
    const rir = num(r.rir);
    const counts = r.counts_load !== false && loadType === "external" && load > 0;
    const e1rm = counts ? comparableE1rm({ load, reps, rpe, rir }) : null;
    d.sets += 1;
    d.reps += reps;
    if (counts) d.volumeLb += load * reps;
    const effort = rpe != null ? rpe : rir != null ? 10 - rir : null;
    if (effort == null) d.unratedSets += 1;
    else if (effort >= 7) d.hardSets += 1;
    const isPr = prMap.has(String(r.id));
    const line: CalSetLine = {
      id: String(r.id),
      load,
      reps,
      rpe,
      rir,
      loadType,
      assistLb: r.assist_lb != null ? Number(r.assist_lb) : null,
      e1rm: e1rm != null ? Math.round(e1rm * 10) / 10 : null,
      pr: isPr,
    };
    const k = `${day}|${exKey(r)}|${r.day_id ?? ""}`;
    let ex = exOnDay.get(k);
    if (!ex) {
      ex = {
        key: exKey(r),
        name: r.exercise_name ?? "Exercise",
        lift: compLiftOfResult(r),
        dayId: r.day_id ?? null,
        sets: [],
        bestE1rm: null,
      };
      exOnDay.set(k, ex);
      exDay.set(ex, day);
      d.exercises.push(ex);
    }
    ex.sets.push(line);
    if (line.e1rm != null && (ex.bestE1rm == null || line.e1rm > ex.bestE1rm))
      ex.bestE1rm = line.e1rm;
    if (isPr) {
      d.prs.push({ exercise: ex.name, load, reps, rpe, headline: !!prMap.get(String(r.id)) });
    }
    const wk = `${day}|${r.day_id ?? "-"}`;
    let w = workoutOnDay.get(wk);
    if (!w) {
      const c = r.day_id ? completions.get(r.day_id) : undefined;
      const secs = c ? (c.activeSeconds ?? c.elapsedSeconds) : null;
      w = {
        dayId: r.day_id ?? null,
        title: (r.day_id && plannedById.get(r.day_id)?.title) || "Workout",
        finished: !r.day_id || !!c,
        planned: !!(r.day_id && plannedById.has(r.day_id)),
        durationMin: secs && secs > 0 ? Math.round(secs / 60) : null,
        loggingPct: c?.loggingPct ?? null,
        sets: 0,
      };
      workoutOnDay.set(wk, w);
      d.workouts.push(w);
    }
    w.sets += 1;
  }

  // ── strength: the day's main lift against its own recent best ──
  const exDays = new Map<
    string,
    Array<{ day: string; best: number; name: string; lift: CompLift | null }>
  >();
  for (const ex of exOnDay.values()) {
    if (ex.bestE1rm == null) continue;
    const day = exDay.get(ex)!;
    const list = exDays.get(ex.key) ?? [];
    const same = list.find((x) => x.day === day);
    if (same) same.best = Math.max(same.best, ex.bestE1rm);
    else list.push({ day, best: ex.bestE1rm, name: ex.name, lift: ex.lift });
    exDays.set(ex.key, list);
  }
  for (const [key, list] of exDays) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    history.set(
      key,
      list.map((x) => ({ day: x.day, e1rm: x.best })),
    );
  }
  for (const d of days.values()) {
    let pick: CalStrength | null = null;
    let pickComp = false;
    let anyNewBest = false;
    for (const ex of d.exercises) {
      if (ex.bestE1rm == null) continue;
      const list = history.get(ex.key) ?? [];
      const before = list.filter((x) => x.day < d.day);
      if (before.length < STRENGTH_MIN_PRIOR) continue;
      const recent = before.filter((x) => dayNum(d.day) - dayNum(x.day) <= STRENGTH_LOOKBACK_DAYS);
      if (!recent.length) continue;
      const priorBest = Math.max(...recent.map((x) => x.e1rm));
      const allBest = Math.max(...before.map((x) => x.e1rm));
      const newBest = ex.bestE1rm > allBest;
      if (newBest) anyNewBest = true;
      const cand: CalStrength = {
        ratio: Math.round((ex.bestE1rm / priorBest) * 1000) / 1000,
        exercise: ex.name,
        e1rmLb: ex.bestE1rm,
        priorBestLb: priorBest,
        newBest,
      };
      const comp = !!ex.lift;
      // the main lift: a competition lift over anything else, then the heaviest
      if (!pick || (comp && !pickComp) || (comp === pickComp && priorBest > pick.priorBestLb)) {
        pick = cand;
        pickComp = comp;
      }
    }
    if (pick) d.strength = { ...pick, newBest: pick.newBest || anyNewBest };
  }

  // ── what was written for each date ──
  for (const p of input.planned ?? []) {
    if (!p.date || trained.has(p.dayId)) continue;
    const d = get(p.date);
    if (p.optional) {
      if (p.date < today) d.optionalSkipped += 1;
      else d.plannedOpen.push(p);
      continue;
    }
    d.plannedOpen.push(p);
  }

  // ── check-outs ──
  for (const c of input.checkouts ?? []) {
    if (!c.day) continue;
    const d = days.get(c.day);
    if (d) d.checkout = c;
  }

  // ── status ──
  const loggedDays = [...days.values()]
    .filter((d) => d.sets > 0)
    .map((d) => d.day)
    .sort();
  const firstLogged = loggedDays[0] ?? null;
  for (const d of days.values()) {
    if (d.workouts.length) d.status = d.workouts.some((w) => w.finished) ? "done" : "partial";
    else if (
      d.plannedOpen.some((p) => !p.optional) &&
      d.day < today &&
      (!firstLogged || d.day < firstLogged)
    )
      d.status = "untracked";
    else if (d.plannedOpen.some((p) => !p.optional) && d.day < today) d.status = "missed";
    else if (d.plannedOpen.length && d.day >= today) d.status = "upcoming";
    else d.status = "rest";
  }

  const keys = [...days.keys()]
    .filter((k) => {
      const d = days.get(k)!;
      return d.sets > 0 || d.plannedOpen.length > 0;
    })
    .sort();
  const setCounts = [...days.values()]
    .filter((d) => d.sets > 0)
    .map((d) => d.sets)
    .sort((a, b) => a - b);
  return {
    days,
    first: keys[0] ?? null,
    firstLogged,
    last: keys.at(-1) ?? null,
    setQuartiles:
      setCounts.length >= 4
        ? [quantile(setCounts, 0.25), quantile(setCounts, 0.5), quantile(setCounts, 0.75)]
        : null,
    today,
  };
}

// ── levels: what a cell shows in each mode ──────────────────────────────

export type CellLook = {
  /** 0 = nothing, 1–4 = how much (the mode's ramp) */
  level: 0 | 1 | 2 | 3 | 4;
  /** a written workout not trained by a day that's over */
  missed?: boolean;
  /** written for a day still ahead */
  upcoming?: boolean;
  /** a mark worth calling out: a new best estimate, a headline PR */
  star?: boolean;
  /** this mode has nothing to say about the day (trained, but no hard set to read strength from) */
  noRead?: boolean;
};

export function weekConsistency(
  cal: PerformanceCalendar,
  monday: string,
): { planned: number; done: number; daysTrained: number } {
  let planned = 0;
  let done = 0;
  let daysTrained = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    const d = cal.days.get(day);
    if (!d) continue;
    if (d.sets > 0) daysTrained += 1;
    if (day >= cal.today) {
      // a day still ahead is never missed; a workout already done on it still counts as done
      done += d.workouts.filter((w) => w.planned).length;
      planned += d.workouts.filter((w) => w.planned).length;
      continue;
    }
    const plannedTrainedHere = d.workouts.filter((w) => w.planned).length;
    const missedHere = d.status === "missed" ? d.plannedOpen.filter((p) => !p.optional).length : 0;
    planned += plannedTrainedHere + missedHere;
    done += plannedTrainedHere;
  }
  return { planned, done, daysTrained };
}

export function cellLook(cal: PerformanceCalendar, day: string, mode: CalendarMode): CellLook {
  const d = cal.days.get(day);
  if (mode === "consistency") {
    const wk = weekConsistency(cal, mondayOf(day));
    const trainedHere = !!d && d.sets > 0;
    let level: CellLook["level"] = 0;
    if (wk.planned > 0) {
      const r = wk.done / wk.planned;
      level = r >= 1 ? 4 : r >= 0.75 ? 3 : r >= 0.5 ? 2 : r > 0 ? 1 : 0;
    } else {
      level = Math.min(4, wk.daysTrained) as CellLook["level"];
    }
    return {
      level: trainedHere ? level : (Math.max(0, level - 2) as CellLook["level"]),
      missed: d?.status === "missed",
      upcoming: d?.status === "upcoming",
    };
  }
  if (!d) return { level: 0 };
  if (d.status === "missed") return { level: 0, missed: true };
  if (d.status === "upcoming") return { level: 0, upcoming: true };
  if (!d.sets) return { level: 0 };
  if (mode === "workouts") return { level: d.status === "done" ? 4 : 2 };
  if (mode === "volume") {
    const q = cal.setQuartiles;
    if (!q) return { level: 3 };
    const level = d.sets > q[2] ? 4 : d.sets > q[1] ? 3 : d.sets > q[0] ? 2 : 1;
    return { level };
  }
  if (mode === "strength") {
    const s = d.strength;
    if (!s) return { level: 0, noRead: true };
    const level = s.ratio >= 0.99 ? 4 : s.ratio >= 0.95 ? 3 : s.ratio >= 0.9 ? 2 : 1;
    return { level, star: s.newBest };
  }
  // PRs
  const n = d.prs.length;
  return { level: n >= 3 ? 4 : n === 2 ? 3 : n === 1 ? 2 : 0, star: d.prs.some((p) => p.headline) };
}

// ── ranges ───────────────────────────────────────────────────────────────

export type RangeKind = "week" | "month" | "block" | "year" | "all";
export const RANGE_KINDS: Array<[RangeKind, string]> = [
  ["week", "Week"],
  ["month", "Month"],
  ["block", "Block"],
  ["year", "Year"],
  ["all", "All"],
];
export type CalBlock = { id: string; name: string; start: string | null; end: string | null };
export type CalRange = {
  kind: RangeKind;
  start: string;
  end: string;
  label: string;
  blockId?: string | null;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MON3 = MONTHS.map((m) => m.slice(0, 3));

function shortRange(a: string, b: string): string {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  if (ay !== by) return `${MON3[am - 1]} ${ad}, ${ay} – ${MON3[bm - 1]} ${bd}, ${by}`;
  if (am === bm) return `${MON3[am - 1]} ${ad} – ${bd}`;
  return `${MON3[am - 1]} ${ad} – ${MON3[bm - 1]} ${bd}`;
}

/**
 * The range a calendar shows: the week or month holding `anchor`, a block
 * (its own dates, else the weeks its workouts sit on), the calendar year, or
 * everything from the first day on file.
 */
export function calendarRange(
  kind: RangeKind,
  anchor: string,
  ctx: { blocks?: CalBlock[]; blockId?: string | null; first?: string | null; today: string },
): CalRange {
  if (kind === "week") {
    const s = mondayOf(anchor);
    const e = addDays(s, 6);
    return {
      kind,
      start: s,
      end: e,
      label: s <= ctx.today && ctx.today <= e ? "This week" : shortRange(s, e),
    };
  }
  if (kind === "month") {
    const [y, m] = anchor.split("-").map(Number);
    const s = `${y}-${String(m).padStart(2, "0")}-01`;
    const e = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { kind, start: s, end: e, label: `${MONTHS[m - 1]} ${y}` };
  }
  if (kind === "year") {
    const y = Number(anchor.slice(0, 4));
    return { kind, start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
  }
  if (kind === "block") {
    const blocks = (ctx.blocks ?? []).filter((b) => b.start);
    const b =
      blocks.find((x) => x.id === ctx.blockId) ??
      blocks.find((x) => x.start! <= anchor && (!x.end || anchor <= x.end)) ??
      blocks
        .filter((x) => x.start! <= anchor)
        .sort((a, c) => c.start!.localeCompare(a.start!))[0] ??
      blocks[0];
    if (b) {
      const s = mondayOf(b.start!);
      const e = b.end ?? addDays(s, 27);
      return { kind, start: s, end: addDays(mondayOf(e), 6), label: b.name, blockId: b.id };
    }
    // no dated block: the last 4 weeks
    const s = mondayOf(addDays(anchor, -21));
    return { kind, start: s, end: addDays(s, 27), label: "Last 4 weeks", blockId: null };
  }
  const s = mondayOf(ctx.first ?? ctx.today);
  const e = addDays(mondayOf(ctx.today), 6);
  return {
    kind: "all",
    start: s,
    end: e,
    label: `Since ${MON3[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`,
  };
}

/** The anchor one step earlier / later (null where there's nowhere to go). */
export function stepRange(
  r: CalRange,
  dir: -1 | 1,
  ctx: { blocks?: CalBlock[]; today: string; first?: string | null },
): { anchor: string; blockId?: string | null } | null {
  if (r.kind === "all") return null;
  if (r.kind === "week") return { anchor: addDays(r.start, 7 * dir) };
  if (r.kind === "month") {
    const [y, m] = r.start.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
    return { anchor: d };
  }
  if (r.kind === "year") return { anchor: `${Number(r.start.slice(0, 4)) + dir}-06-01` };
  const blocks = (ctx.blocks ?? [])
    .filter((b) => b.start)
    .sort((a, b) => a.start!.localeCompare(b.start!));
  const i = blocks.findIndex((b) => b.id === r.blockId);
  const next = i < 0 ? null : blocks[i + dir];
  return next ? { anchor: next.start!, blockId: next.id } : null;
}

/** The weeks a grid shows (Monday first), each its 7 days; days outside the range are null. */
export function gridWeeks(
  r: Pick<CalRange, "start" | "end">,
): Array<{ monday: string; days: Array<string | null> }> {
  const out: Array<{ monday: string; days: Array<string | null> }> = [];
  for (let mon = mondayOf(r.start); mon <= r.end; mon = addDays(mon, 7)) {
    const days: Array<string | null> = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i);
      days.push(d >= r.start && d <= r.end ? d : null);
    }
    out.push({ monday: mon, days });
  }
  return out;
}

// ── a range in numbers ───────────────────────────────────────────────────

export type Standout = { day: string; kind: "best" | "pr" | "volume"; text: string };
export type RangeSummary = {
  trainingDays: number;
  workouts: number;
  finished: number;
  plannedPast: number;
  plannedDone: number;
  missed: number;
  upcoming: number;
  sets: number;
  volumeLb: number;
  prs: number;
  /** training days a week over the range's weeks that are over (null before one is) */
  daysPerWeek: number | null;
  /** weeks in a row, up to this week, with a training day (this week counts once it has one) */
  streakWeeks: number;
  longestStreakWeeks: number;
  standouts: Standout[];
};

export function summarizeRange(
  cal: PerformanceCalendar,
  r: Pick<CalRange, "start" | "end">,
): RangeSummary {
  let trainingDays = 0;
  let workouts = 0;
  let finished = 0;
  let plannedPast = 0;
  let plannedDone = 0;
  let missed = 0;
  let upcoming = 0;
  let sets = 0;
  let volumeLb = 0;
  let prs = 0;
  const inRange: CalDay[] = [];
  for (const d of cal.days.values()) {
    if (d.day < r.start || d.day > r.end) continue;
    inRange.push(d);
    if (d.sets > 0) trainingDays += 1;
    workouts += d.workouts.length;
    finished += d.workouts.filter((w) => w.finished).length;
    const plannedHere = d.workouts.filter((w) => w.planned).length;
    sets += d.sets;
    volumeLb += d.volumeLb;
    prs += d.prs.length;
    if (d.day < cal.today) {
      const missedHere =
        d.status === "missed" ? d.plannedOpen.filter((p) => !p.optional).length : 0;
      plannedPast += plannedHere + missedHere;
      plannedDone += plannedHere;
      missed += missedHere;
    } else {
      plannedDone += plannedHere;
      plannedPast += plannedHere;
      upcoming += d.plannedOpen.length;
    }
  }
  // days a week over full weeks that are over
  const thisMonday = mondayOf(cal.today);
  const fullWeeks: string[] = [];
  for (
    let mon = mondayOf(r.start);
    mon < thisMonday && addDays(mon, 6) <= r.end;
    mon = addDays(mon, 7)
  ) {
    if (mon >= mondayOf(cal.first ?? r.start)) fullWeeks.push(mon);
  }
  const trainedIn = (mon: string) => {
    let n = 0;
    for (let i = 0; i < 7; i++) if ((cal.days.get(addDays(mon, i))?.sets ?? 0) > 0) n++;
    return n;
  };
  const daysPerWeek = fullWeeks.length
    ? Math.round((fullWeeks.reduce((a, w) => a + trainedIn(w), 0) / fullWeeks.length) * 10) / 10
    : null;
  // streaks (whole history)
  let streak = 0;
  for (
    let mon = trainedIn(thisMonday) > 0 ? thisMonday : addDays(thisMonday, -7);
    cal.first && mon >= mondayOf(cal.first);
    mon = addDays(mon, -7)
  ) {
    if (trainedIn(mon) > 0) streak++;
    else break;
  }
  let longest = 0;
  let run = 0;
  if (cal.first) {
    for (let mon = mondayOf(cal.first); mon <= thisMonday; mon = addDays(mon, 7)) {
      if (trainedIn(mon) > 0) {
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
    }
  }
  // standouts: new bests on the main lift, headline PRs, the biggest days for this athlete
  const standouts: Standout[] = [];
  const bests = inRange
    .filter((d) => d.strength?.newBest)
    .sort((a, b) => b.strength!.ratio - a.strength!.ratio);
  for (const d of bests.slice(0, 2))
    standouts.push({ day: d.day, kind: "best", text: `Best estimate on ${d.strength!.exercise}` });
  const headline = inRange.filter(
    (d) => d.prs.some((p) => p.headline) && !standouts.some((s) => s.day === d.day),
  );
  for (const d of headline.slice(-1)) {
    const p = d.prs.find((x) => x.headline)!;
    standouts.push({ day: d.day, kind: "pr", text: `${p.exercise} PR` });
  }
  if (cal.setQuartiles) {
    const big = inRange
      .filter((d) => d.sets > 0 && !standouts.some((s) => s.day === d.day))
      .sort((a, b) => b.sets - a.sets)[0];
    if (big && big.sets > cal.setQuartiles[2])
      standouts.push({
        day: big.day,
        kind: "volume",
        text: `Biggest day: ${big.sets} working sets`,
      });
  }
  return {
    trainingDays,
    workouts,
    finished,
    plannedPast,
    plannedDone,
    missed,
    upcoming,
    sets,
    volumeLb,
    prs,
    daysPerWeek,
    streakWeeks: streak,
    longestStreakWeeks: longest,
    standouts: standouts.sort((a, b) => b.day.localeCompare(a.day)).slice(0, 3),
  };
}

/** A cell's words for a screen reader and the hover card: "Tue, Nov 18: Lower A, done, 18 sets". */
export function dayLabel(d: CalDay | undefined, day: string): string {
  const dt = new Date(`${day}T12:00:00Z`);
  const head = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()]}, ${MON3[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  if (!d || (!d.sets && !d.plannedOpen.length)) return `${head}: rest`;
  if (d.status === "missed")
    return `${head}: ${d.plannedOpen.map((p) => p.title).join(", ")}, missed`;
  if (d.status === "untracked")
    return `${head}: ${d.plannedOpen.map((p) => p.title).join(", ")}, written before you started logging`;
  if (d.status === "upcoming")
    return `${head}: ${d.plannedOpen.map((p) => p.title).join(", ")}, planned`;
  const titles = d.workouts.map((w) => w.title).join(", ");
  const bits = [titles, d.status === "done" ? "done" : "logged, not finished", `${d.sets} sets`];
  if (d.prs.length) bits.push(`${d.prs.length} PR${d.prs.length === 1 ? "" : "s"}`);
  return `${head}: ${bits.join(", ")}`;
}
