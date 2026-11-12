/**
 * The coach's "How it's going" charts on a client's Nutrition tab, as pure
 * math so it's tested: bodyweight as weigh-ins with their 7-day average (a
 * single weigh-in is noise), when each plan started and its calories, the
 * weekly check-in's nutrition consistency (1–5), and water against the
 * target. Read from what was logged only; nothing is estimated.
 */
import { normalizeDayLabel } from "@/lib/client-nutrition-day";
import { weeklyAverageKcal, weightTrend, type WeightTrend } from "@/lib/nutrition-targets/nutrition-intel";

const DAY = 86_400_000;
const LB_PER_KG = 2.2046226218;

export type ProgressRange = "4w" | "12w" | "6m";
export const PROGRESS_RANGES: Array<{ value: ProgressRange; label: string; days: number }> = [
  { value: "4w", label: "4 weeks", days: 28 },
  { value: "12w", label: "12 weeks", days: 84 },
  { value: "6m", label: "6 months", days: 182 },
];

/** YYYY-MM-DD `days` before `today` (inclusive range start). */
export function rangeStart(today: string, range: ProgressRange): string {
  const days = PROGRESS_RANGES.find((r) => r.value === range)?.days ?? 84;
  return addDays(today, -(days - 1));
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Days from `a` to `b` (YYYY-MM-DD). */
export function dayIndex(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

export type WeighInPoint = { date: string; value: number };
export type BodyweightChartPoint = WeighInPoint & { avg: number };

/**
 * Each weigh-in with the average of the weigh-ins in the 7 days ending on it
 * (itself included). Oldest first; one entry a day (the input already is).
 */
export function withSevenDayAverage(points: WeighInPoint[], days = 7): BodyweightChartPoint[] {
  const sorted = points
    .filter((p) => Number.isFinite(p.value) && p.value > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((p, i) => {
    const from = addDays(p.date, -(days - 1));
    let sum = 0;
    let n = 0;
    for (let k = i; k >= 0 && sorted[k].date >= from; k--) {
      sum += sorted[k].value;
      n++;
    }
    return { ...p, avg: Math.round((sum / n) * 10) / 10 };
  });
}

export type BodyweightSummary = {
  /** The 7-day average at the latest weigh-in. */
  latest: { date: string; avg: number } | null;
  /** The 7-day average change across the range shown (last vs first), in the display unit. */
  rangeChange: number | null;
  /** The trend on the current plan (least squares, its first 2 weeks left out once there's enough after), in the display unit a week. */
  onPlan: { perWeek: number; pctPerWeek: number; clear: boolean; weeks: number } | null;
};

/**
 * What the bodyweight chart's header says. `planStart` is the current plan's
 * start (YYYY-MM-DD) or null; the trend reads every weigh-in since it,
 * whatever range is shown, exactly as the nutrition AI reads it (weightTrend).
 */
export function bodyweightSummary(
  shown: BodyweightChartPoint[],
  all: WeighInPoint[],
  unit: "lb" | "kg",
  planStart: string | null,
  today: string,
): BodyweightSummary {
  const last = shown[shown.length - 1] ?? null;
  const first = shown[0] ?? null;
  const rangeChange = first && last && first.date !== last.date ? Math.round((last.avg - first.avg) * 10) / 10 : null;
  let onPlan: BodyweightSummary["onPlan"] = null;
  if (planStart) {
    const toKg = (v: number) => (unit === "lb" ? v / LB_PER_KG : v);
    const t: WeightTrend | null = weightTrend(
      all.map((p) => ({ date: p.date, kg: toKg(p.value) })),
      planStart,
      today,
    );
    if (t) {
      const perWeek = unit === "lb" ? t.kgPerWeek * LB_PER_KG : t.kgPerWeek;
      onPlan = { perWeek: Math.round(perWeek * 100) / 100, pctPerWeek: t.pctPerWeek, clear: t.clear, weeks: t.weeks };
    }
  }
  return { latest: last ? { date: last.date, avg: last.avg } : null, rangeChange, onPlan };
}

/** A plan for the markers: its start, its days' calories. */
export type PlanForMarkers = {
  id: string;
  start_date: string | null;
  phase?: string | null;
  days: Array<{ label: string; calories: number | null }>;
};

export type PlanMarker = { id: string; date: string; kcal: number | null; phase: string | null };

/**
 * When each plan started (inside the range shown) and its average calories a
 * day across their week (training days and the High Day placed like the
 * client's Nutrition page, weeklyAverageKcal; the plain average of its days
 * when the week can't be placed). Oldest first.
 */
export function planMarkers(
  plans: PlanForMarkers[],
  from: string,
  to: string,
  trainingDays: string[],
  highWeekday: string | null,
): PlanMarker[] {
  return plans
    .filter((p) => p.start_date && p.start_date >= from && p.start_date <= to)
    .map((p) => {
      const typed = p.days.filter((d) => normalizeDayLabel(d.label));
      const weekly = typed.length ? weeklyAverageKcal(typed, trainingDays, highWeekday) : null;
      const valued = p.days.map((d) => Number(d.calories)).filter((v) => Number.isFinite(v) && v > 0);
      const plain = valued.length ? valued.reduce((a, b) => a + b, 0) / valued.length : null;
      const kcal = weekly ?? plain;
      return { id: p.id, date: p.start_date!, kcal: kcal == null ? null : Math.round(kcal / 10) * 10, phase: p.phase ?? null };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type CheckinRating = { date: string; rating: number };

/** The weekly check-ins' nutrition consistency (1–5) in the range, oldest first, with the average. */
export function nutritionConsistency(
  checkins: Array<{ submitted_at: string | null; answers: Record<string, unknown> | null }>,
  from: string,
  to: string,
): { points: CheckinRating[]; avg: number | null } {
  const points = checkins
    .map((c) => {
      const date = String(c.submitted_at ?? "").slice(0, 10);
      const raw = c.answers?.nutrition_rating;
      const rating = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
      return { date, rating };
    })
    .filter((p) => p.date && p.date >= from && p.date <= to && Number.isFinite(p.rating) && p.rating >= 1 && p.rating <= 5)
    .sort((a, b) => a.date.localeCompare(b.date));
  const avg = points.length ? Math.round((points.reduce((a, p) => a + p.rating, 0) / points.length) * 10) / 10 : null;
  return { points, avg };
}

export type WaterDay = { date: string; liters: number };

/**
 * Water drunk each day of the last `days` days (every day, 0 when nothing was
 * logged, so a missed day shows), with the days that logged anything and
 * their average. Null when nothing was logged in that time.
 */
export function waterDays(
  entries: Array<{ entry_date: string | null; amount_ml: number | null }>,
  today: string,
  days = 14,
): { days: WaterDay[]; logged: number; avgLiters: number | null } | null {
  const from = addDays(today, -(days - 1));
  const byDay = new Map<string, number>();
  for (const e of entries) {
    const d = String(e.entry_date ?? "").slice(0, 10);
    const ml = Number(e.amount_ml);
    if (!d || d < from || d > today || !Number.isFinite(ml) || ml <= 0) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + ml);
  }
  if (!byDay.size) return null;
  const out: WaterDay[] = [];
  for (let k = 0; k < days; k++) {
    const d = addDays(from, k);
    out.push({ date: d, liters: Math.round(((byDay.get(d) ?? 0) / 1000) * 10) / 10 });
  }
  const loggedDays = [...byDay.values()];
  return {
    days: out,
    logged: loggedDays.length,
    avgLiters: Math.round((loggedDays.reduce((a, b) => a + b, 0) / loggedDays.length / 1000) * 10) / 10,
  };
}

/** "−0.4 lb a week", "+0.25 kg a week" (a real minus sign). */
export function perWeekText(v: number, unit: "lb" | "kg"): string {
  const r = Math.abs(v) < 0.1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
  if (r === 0) return `0 ${unit} a week`;
  return `${r > 0 ? "+" : "−"}${Math.abs(r)} ${unit} a week`;
}
