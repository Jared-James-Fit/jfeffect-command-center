/**
 * Pain beside the training: which exercises the days it came up had in
 * common, and how those sessions went (pure, tested). An association, never a
 * cause: "came up on 4 of 5 bench days (bench is in half their sessions)".
 *
 * Only areas reported on at least ASSOC_MIN_DAYS training days are read, and
 * an exercise or movement counts only when it was in nearly every one of
 * those days and clearly more often than in their training overall, so a lift
 * they do every session never reads as the reason.
 */
import { patternOf, type Pattern } from "@/lib/analytics/training-load";
import type { PainArea } from "@/lib/pain/history";
import type { SleepBucket } from "@/lib/analytics/recovery-score";

export type PainSession = {
  date: string;
  dayId?: string | null;
  /** The training block the workout was in (for "changes across blocks"). */
  block?: { id: string; name: string } | null;
  exercises: string[];
  sessionRpe: number | null;
  sleep: SleepBucket | string | null;
  energy: number | null;
};

export const ASSOC_MIN_DAYS = 3;
/** Share of the pain days the exercise was in. */
export const ASSOC_MIN_SHARE = 0.75;
/** How much more often than in their sessions overall. */
export const ASSOC_MIN_LIFT = 0.2;

export type Association = {
  /** "Competition Bench" (an exercise), or a movement with the exercise seen most. */
  kind: "exercise" | "pattern";
  name: string;
  pattern: Pattern | null;
  /** Pain days with it / pain days with a session. */
  with: number;
  of: number;
  /** Share of all their sessions in the window with it. */
  base: number;
};

const PATTERN_WORDS: Partial<Record<Pattern, string>> = {
  "Horizontal press": "pressing",
  "Vertical press": "overhead pressing",
  "Horizontal pull": "rowing",
  "Vertical pull": "pulldowns / pull-ups",
  Squat: "squatting",
  "Hip hinge": "hinging",
  "Single-leg": "single-leg work",
  "Knee extension": "knee extensions",
  "Knee flexion": "leg curls",
  "Hip thrust": "hip thrusts",
  "Shoulder isolation": "shoulder isolation work",
  Arms: "arm work",
};

export function patternWords(p: Pattern | null): string {
  return (p && PATTERN_WORDS[p]) || (p ? p.toLowerCase() : "");
}

function cleanName(n: string): string {
  return n.trim().replace(/\s+/g, " ");
}

/**
 * Movements that can plausibly load each place. A lift that only happens to
 * share the days (squats with an elbow, say) is never offered as a pattern;
 * the bar on the back keeps the squat for shoulders, elbows and wrists.
 */
export const PLAUSIBLE: Record<string, Pattern[]> = {
  neck: ["Horizontal press", "Vertical press", "Horizontal pull", "Vertical pull", "Shoulder isolation", "Squat", "Hip hinge"],
  shoulder: ["Horizontal press", "Vertical press", "Horizontal pull", "Vertical pull", "Shoulder isolation", "Arms", "Squat"],
  chest: ["Horizontal press", "Vertical press"],
  upper_arm: ["Horizontal press", "Vertical press", "Horizontal pull", "Vertical pull", "Arms"],
  elbow: ["Horizontal press", "Vertical press", "Horizontal pull", "Vertical pull", "Arms", "Squat"],
  wrist_hand: ["Horizontal press", "Vertical press", "Horizontal pull", "Vertical pull", "Arms", "Squat", "Hip hinge"],
  upper_back: ["Horizontal pull", "Vertical pull", "Hip hinge", "Squat", "Shoulder isolation"],
  shoulder_blade: ["Horizontal press", "Horizontal pull", "Vertical pull", "Vertical press", "Shoulder isolation"],
  mid_back: ["Hip hinge", "Squat", "Horizontal pull"],
  low_back: ["Hip hinge", "Squat", "Single-leg", "Horizontal pull", "Hip thrust"],
  abs: ["Trunk", "Squat", "Hip hinge"],
  hip_groin: ["Squat", "Single-leg", "Hip hinge", "Hip thrust"],
  glute: ["Squat", "Single-leg", "Hip hinge", "Hip thrust"],
  quad: ["Squat", "Single-leg", "Knee extension"],
  hamstring: ["Hip hinge", "Knee flexion", "Single-leg", "Squat"],
  knee: ["Squat", "Single-leg", "Knee extension", "Knee flexion"],
  shin: ["Single-leg", "Squat", "Calves"],
  calf: ["Calves", "Single-leg", "Squat"],
  ankle_foot: ["Calves", "Single-leg", "Squat"],
};

export function associations(area: Pick<PainArea, "entries"> & { region?: string; named?: { name: string; count: number }[] }, sessions: PainSession[]): Association[] {
  // they named the exercise themselves (twice or more): that's the association, nothing guessed beside it
  if (area.named?.some((n) => n.count >= 2)) return [];
  const byDate = new Map<string, PainSession>();
  for (const s of sessions) if (!byDate.has(s.date)) byDate.set(s.date, s);
  const painDates = [...new Set(area.entries.filter((e) => e.source !== "checkin").map((e) => e.date))].filter((d) => byDate.has(d));
  if (painDates.length < ASSOC_MIN_DAYS || sessions.length < painDates.length + 2) return [];

  const exSet = (s: PainSession) => new Set(s.exercises.map(cleanName));
  const patSet = (s: PainSession) => new Set(s.exercises.map((e) => patternOf({ exercise: e, category: null, dbPattern: null, countsTowardVolume: true })).filter((p): p is Pattern => !!p && p !== "Other"));

  const region = area.region ?? area.entries[0]?.region;
  const plausible = region && PLAUSIBLE[region] ? new Set<Pattern>(PLAUSIBLE[region]) : null;
  const fits = (p: Pattern | null) => !plausible || (!!p && plausible.has(p));
  const out: Association[] = [];
  const consider = (kind: "exercise" | "pattern", keysOf: (s: PainSession) => Set<string>) => {
    const counts = new Map<string, number>();
    for (const d of painDates) for (const k of keysOf(byDate.get(d)!)) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const [k, n] of counts) {
      if (n < ASSOC_MIN_DAYS || n / painDates.length < ASSOC_MIN_SHARE) continue;
      const base = sessions.filter((s) => keysOf(s).has(k)).length / sessions.length;
      if (n / painDates.length - base < ASSOC_MIN_LIFT) continue;
      if (!fits(kind === "pattern" ? (k as Pattern) : patternOf({ exercise: k, category: null, dbPattern: null, countsTowardVolume: true }))) continue;
      if (kind === "pattern") {
        // the exercise of that movement they did most on those days
        const names = new Map<string, number>();
        for (const d of painDates) for (const e of byDate.get(d)!.exercises) if (patternOf({ exercise: e, category: null, dbPattern: null, countsTowardVolume: true }) === k) names.set(cleanName(e), (names.get(cleanName(e)) ?? 0) + 1);
        const top = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? k;
        out.push({ kind, name: top, pattern: k as Pattern, with: n, of: painDates.length, base });
      } else out.push({ kind, name: k, pattern: null, with: n, of: painDates.length, base });
    }
  };
  consider("exercise", exSet);
  consider("pattern", patSet as (s: PainSession) => Set<string>);
  // one exercise or its movement, whichever explains more of the pain days (the exercise on a tie)
  const patOf = (a: Association) => (a.kind === "pattern" ? a.pattern : patternOf({ exercise: a.name, category: null, dbPattern: null, countsTowardVolume: true }));
  const keep = out.filter((a) => {
    const rivals = out.filter((b) => b !== a && b.kind !== a.kind && patOf(b) === patOf(a));
    if (a.kind === "pattern") return rivals.every((b) => b.with < a.with);
    return rivals.every((b) => b.with <= a.with);
  });
  return keep
    .sort((a, b) => b.with / b.of - b.base - (a.with / a.of - a.base))
    .slice(0, 2);
}

export function associationLine(a: Association): string {
  const what = a.kind === "exercise" ? a.name : `${patternWords(a.pattern)} (${a.name})`;
  return `came up on ${a.with} of ${a.of} days with ${what}, which is in ${Math.round(a.base * 100)}% of their sessions`;
}

export type BlockShift = {
  current: { name: string; pain: number; sessions: number };
  previous: { name: string; pain: number; sessions: number };
  direction: "more" | "less";
};

/**
 * How often a place came up in this training block against the one before
 * (Nov 26 2026): only a clear change (one block with none and the other with
 * two or more, or twice as often across at least three sessions), counted
 * per session so a longer block never reads as worse. Facts, never a cause.
 */
export function blockShift(area: Pick<PainArea, "entries">, sessions: PainSession[]): BlockShift | null {
  const withBlock = sessions.filter((s) => s.block?.id);
  if (withBlock.length < 4) return null;
  const order: string[] = [];
  const names = new Map<string, string>();
  for (const s of [...withBlock].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!order.includes(s.block!.id)) order.push(s.block!.id);
    names.set(s.block!.id, s.block!.name);
  }
  if (order.length < 2) return null;
  const latest = [...withBlock].sort((a, b) => b.date.localeCompare(a.date))[0].block!.id;
  const i = order.indexOf(latest);
  if (i < 1) return null;
  const prev = order[i - 1];
  const painDates = new Set(area.entries.filter((e) => e.source !== "checkin").map((e) => e.date));
  const count = (id: string) => {
    const list = withBlock.filter((s) => s.block!.id === id);
    return { sessions: list.length, pain: list.filter((s) => painDates.has(s.date)).length };
  };
  const cur = count(latest);
  const before = count(prev);
  if (cur.sessions < 2 || before.sessions < 2) return null;
  const rc = cur.pain / cur.sessions;
  const rp = before.pain / before.sessions;
  const clear =
    (before.pain === 0 && cur.pain >= 2) ||
    (cur.pain === 0 && before.pain >= 2 && cur.sessions >= 3) ||
    (cur.pain + before.pain >= 3 && (rc >= rp * 2 || rp >= rc * 2) && Math.abs(cur.pain - before.pain) >= 2);
  if (!clear) return null;
  return {
    current: { name: names.get(latest) ?? "This block", ...cur },
    previous: { name: names.get(prev) ?? "The block before", ...before },
    direction: rc > rp ? "more" : "less",
  };
}

export function blockShiftLine(b: BlockShift): string {
  return `came up in ${b.current.pain} of ${b.current.sessions} sessions this block (${b.current.name}), against ${b.previous.pain} of ${b.previous.sessions} in the block before (${b.previous.name})`;
}

/** How the sessions it came up in went: short sleep and very hard sessions, counted. */
export function sessionContext(area: Pick<PainArea, "entries">, sessions: PainSession[]): { sessions: number; shortSleep: number; veryHard: number; lowEnergy: number } {
  const dates = new Set(area.entries.map((e) => e.date));
  const list = sessions.filter((s) => dates.has(s.date));
  return {
    sessions: list.length,
    shortSleep: list.filter((s) => s.sleep === "lt5" || s.sleep === "5_6").length,
    veryHard: list.filter((s) => (s.sessionRpe ?? 0) >= 9).length,
    lowEnergy: list.filter((s) => s.energy != null && s.energy <= 2).length,
  };
}
