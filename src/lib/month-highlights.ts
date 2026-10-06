/**
 * "Your Month" highlights for the client Workouts tab — a handful of numbers a
 * brand-new gym-goer understands at a glance, plus two athlete extras.
 *
 * Pure: takes the rows from getClientResults() (loads always in lb) and "now".
 * Weight lifted counts only loaded sets (load × reps) — bodyweight and assisted
 * sets never inflate it, same rule as the full analytics page.
 */
import { buildExerciseHistory, recentPRs, weeklyMuscleVolume } from "@/lib/pl-programs";

const LB_PER_KG = 2.2046226;
const DAY_MS = 86_400_000;

export type Unit = "lb" | "kg";

export type MonthHighlights = {
  monthLabel: string;
  prevMonthLabel: string;
  hasData: boolean;
  /** Total weight lifted this calendar month (lb). */
  weightLb: number;
  /** Last month's total up to the same day-of-month (lb) — the fair comparison. */
  prevSamePointLb: number;
  /** Last month's full total (lb). */
  prevMonthTotalLb: number;
  workouts: number;
  prevWorkouts: number;
  /** Lifts that set a new estimated-1RM record this month. */
  prLifts: number;
  /** Consecutive weeks (Mon–Sun) with at least one workout. */
  streakWeeks: number;
  /** Athlete: strongest lift by estimated 1-rep max. */
  topLift: { name: string; est1rmLb: number; gainLb: number | null } | null;
  /** Athlete: most-trained muscle group over the last 7 days. */
  topMuscle: { muscle: string; sets: number } | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function localDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday 00:00 (local) of the week containing d. */
function weekStart(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
}

export function computeMonthHighlights(results: any[], now: Date = new Date()): MonthHighlights {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const daysInPrev = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const prevSameEnd = new Date(prevStart.getFullYear(), prevStart.getMonth(), Math.min(now.getDate(), daysInPrev), 23, 59, 59, 999);
  const prevEnd = new Date(monthStart.getTime() - 1);

  let weightLb = 0;
  let prevSamePointLb = 0;
  let prevMonthTotalLb = 0;
  const workoutDays = new Set<string>();
  const prevWorkoutDays = new Set<string>();
  const allWorkoutDays = new Set<string>();

  for (const r of results) {
    if (!r?.date) continue;
    const t = new Date(r.date);
    if (Number.isNaN(t.getTime())) continue;
    allWorkoutDays.add(localDateKey(t));
    const lifted = r.counts_load ? Number(r.load || 0) * Number(r.reps || 0) : 0;
    if (t >= monthStart && t <= now) {
      weightLb += lifted;
      workoutDays.add(localDateKey(t));
    } else if (t >= prevStart && t <= prevEnd) {
      prevMonthTotalLb += lifted;
      if (t <= prevSameEnd) {
        prevSamePointLb += lifted;
        prevWorkoutDays.add(localDateKey(t));
      }
    }
  }

  // PRs set this month — one per lift, matching the PRs page's definition.
  const sinceDays = Math.max(1, Math.ceil((Date.now() - monthStart.getTime()) / DAY_MS));
  const prKeys = new Set<string>();
  for (const p of recentPRs(results, sinceDays)) {
    if (new Date(p.date) >= monthStart) prKeys.add(p.exercise_id ?? String(p.exercise_name ?? "").toLowerCase());
  }

  // Weekly streak: current week counts if it has a workout; an empty current
  // week doesn't break a streak that is still alive from last week.
  const weeksWithWorkout = new Set<number>();
  for (const key of allWorkoutDays) {
    const [y, m, d] = key.split("-").map(Number);
    weeksWithWorkout.add(weekStart(new Date(y, m - 1, d)).getTime());
  }
  let cursor = weekStart(now);
  if (!weeksWithWorkout.has(cursor.getTime())) cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
  let streakWeeks = 0;
  while (weeksWithWorkout.has(cursor.getTime())) {
    streakWeeks++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
  }

  // Athlete extras.
  const history = buildExerciseHistory(results);
  const lead = history[0] ?? null;
  let topLift: MonthHighlights["topLift"] = null;
  if (lead?.pr && lead.pr.est_1rm > 0) {
    const cutoff = now.getTime() - 30 * DAY_MS;
    const before = lead.points
      .filter((p: any) => p.date && new Date(p.date).getTime() < cutoff)
      .reduce((m: number, p: any) => Math.max(m, p.est_1rm || 0), 0);
    topLift = {
      name: lead.name,
      est1rmLb: lead.pr.est_1rm,
      gainLb: before > 0 ? Math.max(0, lead.pr.est_1rm - before) : null,
    };
  }
  const muscle = weeklyMuscleVolume(results, 7).find((m) => m.muscle !== "Other") ?? null;

  return {
    monthLabel: MONTHS[now.getMonth()],
    prevMonthLabel: MONTHS[prevStart.getMonth()],
    hasData: weightLb > 0 || workoutDays.size > 0 || allWorkoutDays.size > 0,
    weightLb,
    prevSamePointLb,
    prevMonthTotalLb,
    workouts: workoutDays.size,
    prevWorkouts: prevWorkoutDays.size,
    prLifts: prKeys.size,
    streakWeeks,
    topLift,
    topMuscle: muscle,
  };
}

/** lb → display unit number. */
export function toUnit(lb: number, unit: Unit) {
  return unit === "kg" ? lb / LB_PER_KG : lb;
}

/** 0 → "0", 842 → "842", 4,210 → "4.2k", 42,500 → "43k", 1.2M → "1.2M". */
export function compactWeight(lb: number, unit: Unit): string {
  const n = toUnit(lb, unit);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Whole-number weight with thousands separators, e.g. "1,240". */
export function wholeWeight(lb: number, unit: Unit): string {
  return Math.round(toUnit(lb, unit)).toLocaleString("en-US");
}

const COMPARISONS: Array<{ lb: number; one: string; many: string; emoji: string }> = [
  { lb: 300_000, one: "a blue whale", many: "blue whales", emoji: "🐋" },
  { lb: 90_000, one: "a passenger jet", many: "passenger jets", emoji: "✈️" },
  { lb: 26_000, one: "a school bus", many: "school buses", emoji: "🚌" },
  { lb: 12_000, one: "an elephant", many: "elephants", emoji: "🐘" },
  { lb: 4_000, one: "a car", many: "cars", emoji: "🚗" },
  { lb: 1_000, one: "a grand piano", many: "grand pianos", emoji: "🎹" },
];

/** Something relatable to compare the month's total to. null under ~1,000 lb. */
export function weightComparison(lb: number): { text: string; emoji: string } | null {
  const hit = COMPARISONS.find((c) => lb >= c.lb);
  if (!hit) return null;
  const count = lb / hit.lb;
  if (count < 1.5) return { text: `about the weight of ${hit.one}`, emoji: hit.emoji };
  const n = count >= 10 ? Math.round(count) : Math.round(count * 2) / 2;
  return { text: `about ${n} ${hit.many}`, emoji: hit.emoji };
}

/** "+18%" / "-6%" vs a previous value, or null when there's nothing to compare. */
export function percentChange(current: number, previous: number): { pct: number; text: string } | null {
  if (!(previous > 0)) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, text: `${pct > 0 ? "+" : ""}${pct}%` };
}
