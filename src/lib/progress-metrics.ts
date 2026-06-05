import type { Database } from "@/integrations/supabase/types";

export type ProgressMetric = Database["public"]["Tables"]["progress_metrics"]["Row"];
export type ProgressMetricInsert = Database["public"]["Tables"]["progress_metrics"]["Insert"];

export type WeightUnit = "lb" | "kg";

export function lbToKg(lb: number): number { return lb * 0.45359237; }
export function kgToLb(kg: number): number { return kg / 0.45359237; }

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return from === "lb" ? lbToKg(value) : kgToLb(value);
}

export function formatWeight(value: number | null | undefined, unit: WeightUnit): string {
  if (value == null) return "—";
  return `${value.toFixed(1)} ${unit}`;
}

/** Returns all bodyweight entries (with bodyweight not null), normalized to `displayUnit`, sorted asc by date. */
export function normalizedBodyweightSeries(
  rows: ProgressMetric[],
  displayUnit: WeightUnit,
): Array<{ date: string; value: number; raw: ProgressMetric }> {
  return rows
    .filter((r) => r.bodyweight != null)
    .map((r) => ({
      date: r.entry_date,
      value: convertWeight(Number(r.bodyweight), (r.bodyweight_unit as WeightUnit) ?? "lb", displayUnit),
      raw: r,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function averageOfLast(series: Array<{ date: string; value: number }>, days: number): number | null {
  if (series.length === 0) return null;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const recent = series.filter((p) => new Date(p.date + "T00:00:00") >= cutoff);
  if (recent.length === 0) return null;
  return recent.reduce((s, p) => s + p.value, 0) / recent.length;
}

/** Difference between latest and the value ~7 days before latest (or earliest available). */
export function weeklyChange(series: Array<{ date: string; value: number }>): number | null {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const target = new Date(latest.date + "T00:00:00");
  target.setDate(target.getDate() - 7);
  // find closest entry <= target
  let prior = series[0];
  for (const p of series) {
    if (new Date(p.date + "T00:00:00") <= target) prior = p;
  }
  return latest.value - prior.value;
}

export function averageNumeric(rows: ProgressMetric[], field: keyof ProgressMetric, days = 7): number | null {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const vals = rows
    .filter((r) => new Date(r.entry_date + "T00:00:00") >= cutoff)
    .map((r) => r[field] as unknown as number | null)
    .filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + Number(v), 0) / vals.length;
}

export const RANGE_OPTIONS = [
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "all", label: "All time", days: null as number | null },
] as const;

export type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];

export function filterByRange<T extends { date: string }>(rows: T[], range: RangeValue): T[] {
  const opt = RANGE_OPTIONS.find((r) => r.value === range);
  if (!opt || opt.days == null) return rows;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - opt.days);
  return rows.filter((r) => new Date(r.date + "T00:00:00") >= cutoff);
}

export function toCsv(rows: ProgressMetric[]): string {
  const header = [
    "entry_date","bodyweight","bodyweight_unit","steps","sleep_hours",
    "resting_heart_rate","calories_burned","active_minutes","source","notes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const row = header.map((h) => {
      const v = (r as any)[h];
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    });
    lines.push(row.join(","));
  }
  return lines.join("\n");
}
// ============================================================
// Bodyweight goal helpers
// ============================================================

export type GoalType = "lose" | "gain" | "maintain" | "performance_cut" | "custom";

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  lose: "Lose weight",
  gain: "Gain weight",
  maintain: "Maintain weight",
  performance_cut: "Performance cut",
  custom: "Custom",
};

export interface BodyweightGoal {
  type: GoalType;
  value: number;          // target (or range floor for maintain)
  value_max?: number | null; // range ceiling for maintain
  unit: WeightUnit;
}

export interface GoalProgress {
  /** absolute distance from current to goal target (or range bounds) in current unit */
  distance: number | null;
  /** "ahead" = moving correctly, "behind" = away, "in_range" for maintain, "at_goal" if hit */
  state: "ahead" | "behind" | "in_range" | "out_of_range" | "at_goal" | "unknown";
  /** 0–1 progress (lose/gain/cut only) from start (first entry) to goal */
  ratio: number | null;
  /** Friendly short status copy */
  status: string;
}

export function computeGoalProgress(
  goal: BodyweightGoal | null,
  series: Array<{ value: number }>,
  displayUnit: WeightUnit,
): GoalProgress {
  if (!goal || series.length === 0) {
    return { distance: null, state: "unknown", ratio: null, status: "" };
  }
  const current = series[series.length - 1].value;
  const start = series[0].value;
  const target = convertWeight(goal.value, goal.unit, displayUnit);
  const targetMax = goal.value_max != null
    ? convertWeight(goal.value_max, goal.unit, displayUnit)
    : null;

  if (goal.type === "maintain") {
    const low = targetMax != null ? Math.min(target, targetMax) : target;
    const high = targetMax != null ? Math.max(target, targetMax) : target;
    if (current >= low && current <= high) {
      return { distance: 0, state: "in_range", ratio: null, status: "In range" };
    }
    const dist = current < low ? low - current : current - high;
    return {
      distance: Number(dist.toFixed(1)),
      state: "out_of_range",
      ratio: null,
      status: "Outside range",
    };
  }

  // lose / performance_cut: target < start, want current to decrease
  // gain: target > start, want current to increase
  // custom: infer direction from start vs target
  const wantsDown = goal.type === "lose" || goal.type === "performance_cut"
    || (goal.type === "custom" && target < start);
  const distance = Number(Math.abs(current - target).toFixed(1));

  if (distance < 0.05) {
    return { distance: 0, state: "at_goal", ratio: 1, status: "Goal reached" };
  }

  const totalSpan = Math.abs(start - target);
  const traveled = wantsDown ? start - current : current - start;
  const ratio = totalSpan > 0
    ? Math.max(0, Math.min(1, traveled / totalSpan))
    : null;

  const movingRight = wantsDown ? current <= start : current >= start;
  return {
    distance,
    state: movingRight ? "ahead" : "behind",
    ratio,
    status: `${distance.toFixed(1)} ${displayUnit} away`,
  };
}

/**
 * Pick a tasteful acknowledgment line for a new log, given the prior latest entry
 * and any goal context. Returned copy is neutral and never shaming.
 */
export function acknowledgementForLog(opts: {
  prior: number | null;
  next: number;
  goal: BodyweightGoal | null;
  displayUnit: WeightUnit;
}): string {
  const { prior, next, goal, displayUnit } = opts;
  if (!goal) {
    if (prior == null) return "Bodyweight logged. Keep the data coming.";
    return "Progress updated. Coach Jared can see it.";
  }
  const target = convertWeight(goal.value, goal.unit, displayUnit);
  const targetMax = goal.value_max != null
    ? convertWeight(goal.value_max, goal.unit, displayUnit)
    : null;

  if (goal.type === "maintain") {
    const low = targetMax != null ? Math.min(target, targetMax) : target;
    const high = targetMax != null ? Math.max(target, targetMax) : target;
    if (next >= low && next <= high) return "Still in range.";
    return "Logged. The trend matters more than one day.";
  }

  if (prior == null) return "Logged. Let's build the trend.";
  const wantsDown = goal.type === "lose" || goal.type === "performance_cut"
    || (goal.type === "custom" && target < prior);
  const movedRight = wantsDown ? next < prior : next > prior;
  if (Math.abs(next - target) < 0.05) return "Goal hit. Nice work.";
  return movedRight
    ? "Closer to your goal."
    : "Logged. One data point does not define the trend.";
}
