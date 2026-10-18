import { addDays, format, parseISO } from "date-fns";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";

// ───────────────────────────────────────────────────────────────────────────
// Starting a plan: every workout of the week needs its own training day.
// When the plan's workouts a week and the days someone committed to differ,
// suggest the closest fit (keep their days, add or drop the fewest, spread
// out) so the plan and their committed schedule start in sync. Pure, tested.
// ───────────────────────────────────────────────────────────────────────────

export interface DaysFit {
  days: WeekDay[];
  /** suggested on top of what they committed to */
  added: WeekDay[];
  /** committed days the plan doesn't need */
  dropped: WeekDay[];
}

const idx = (d: WeekDay) => WEEK_DAYS.indexOf(d);

/** Lower is better: no long runs of back-to-back days, then even gaps. */
function spreadScore(days: readonly WeekDay[]): [number, number] {
  const pos = days.map(idx).sort((a, b) => a - b);
  if (pos.length <= 1) return [pos.length, 0];
  const gaps = pos.map((p, i) => (i === pos.length - 1 ? pos[0] + 7 - p : pos[i + 1] - p));
  // longest run of consecutive days, wrapping Sunday → Monday
  let maxRun = 1;
  if (pos.length === 7) maxRun = 7;
  else {
    const start = gaps.findIndex((g) => g > 1); // a run starts right after a gap
    let run = 1;
    for (let k = 1; k <= pos.length; k++) {
      const g = gaps[(start + k - 1) % pos.length];
      if (g === 1) run++;
      else run = 1;
      maxRun = Math.max(maxRun, run);
    }
  }
  return [maxRun, gaps.reduce((s, g) => s + g * g, 0)];
}

function combinations<T>(pool: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > pool.length) return [];
  const out: T[][] = [];
  const walk = (from: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = from; i < pool.length; i++) {
      acc.push(pool[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function better(a: WeekDay[], b: WeekDay[]): boolean {
  const [ra, sa] = spreadScore(a);
  const [rb, sb] = spreadScore(b);
  if (ra !== rb) return ra < rb;
  if (sa !== sb) return sa < sb;
  // tie: earlier in the week (Monday first)
  const ka = a.map(idx).sort((x, y) => x - y).join(",");
  const kb = b.map(idx).sort((x, y) => x - y).join(",");
  return ka < kb;
}

const inWeekOrder = (days: Iterable<WeekDay>) => {
  const set = new Set(days);
  return WEEK_DAYS.filter((d) => set.has(d));
};

/** The committed days, fitted to `perWeek` workouts. */
export function fitTrainingDays(committed: readonly WeekDay[], perWeek: number | null | undefined): DaysFit {
  const mine = inWeekOrder(committed);
  const n = Math.max(0, Math.min(7, Math.round(perWeek ?? 0)));
  if (!n || mine.length === n) return { days: mine, added: [], dropped: [] };

  if (mine.length > n) {
    let best: WeekDay[] | null = null;
    for (const c of combinations(mine, n)) if (!best || better(c, best)) best = c;
    const days = inWeekOrder(best ?? []);
    return { days, added: [], dropped: mine.filter((d) => !days.includes(d)) };
  }

  const free = WEEK_DAYS.filter((d) => !mine.includes(d));
  let best: WeekDay[] | null = null;
  for (const extra of combinations(free, n - mine.length)) {
    const c = [...mine, ...extra];
    if (!best || better(c, best)) best = c;
  }
  const days = inWeekOrder(best ?? mine);
  return { days, added: days.filter((d) => !mine.includes(d)), dropped: [] };
}

/**
 * Week 1 as the calendar will show it: the plan's days in order on the
 * chosen weekdays, from the start date (the same 7-day window the realign
 * engine walks, so a mid-week start is right too).
 */
export function weekOnePreview(startISO: string, days: readonly WeekDay[]): Array<{ day: number; date: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO)) return [];
  const set = new Set(days.map(idx));
  const start = parseISO(startISO);
  const out: Array<{ day: number; date: string }> = [];
  for (let i = 0; i < 7; i++) {
    const dt = addDays(start, i);
    const mondayFirst = (dt.getDay() + 6) % 7;
    if (set.has(mondayFirst)) out.push({ day: out.length + 1, date: format(dt, "yyyy-MM-dd") });
  }
  return out;
}

/** "Sat" / "Sat and Sun" / "Mon, Wed and Fri" */
export function listDays(days: readonly string[]): string {
  const short = days.map((d) => d.slice(0, 3));
  if (short.length <= 1) return short.join("");
  return `${short.slice(0, -1).join(", ")} and ${short[short.length - 1]}`;
}
