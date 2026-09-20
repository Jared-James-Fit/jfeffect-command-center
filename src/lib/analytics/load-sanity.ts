/**
 * Conservative analytics-only protection against obviously corrupted load rows.
 *
 * Historical imports occasionally carried a lb value as kg (or vice versa),
 * producing 2.2x+ spikes and impossible e1RMs. We never rewrite or delete the
 * underlying workout result here. Instead, when an exercise has enough real
 * history to establish a baseline, an extreme one-off load is neutralized for
 * load-based analytics while the set still counts for reps/frequency/volume.
 *
 * The threshold is intentionally very high: >4x the exercise median AND at
 * least 400 lb above it. Legitimate PR jumps stay visible; only absurd spikes
 * are suppressed.
 */

export type AnalyticsLoadPoint = {
  exercise_id?: string | null;
  exercise_name?: string | null;
  load: number;
  counts_load?: boolean;
  est_1rm: number;
  date?: string | null;
  [key: string]: unknown;
};

function identity(row: AnalyticsLoadPoint): string {
  if (row.exercise_id) return `id:${row.exercise_id}`;
  return `name:${String(row.exercise_name ?? "unknown").trim().toLowerCase()}`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function neutralizeObviousLoadOutliers<T extends AnalyticsLoadPoint>(
  rows: T[],
): Array<T & {
  analytics_load_outlier?: boolean;
  analytics_excluded_load_lb?: number;
}> {
  const byExercise = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.date || !Number.isFinite(Number(row.load)) || Number(row.load) <= 0) continue;
    const key = identity(row);
    const arr = byExercise.get(key) ?? [];
    arr.push(row);
    byExercise.set(key, arr);
  }

  const flagged = new Set<T>();
  for (const points of byExercise.values()) {
    if (points.length < 4) continue;
    const loads = points.map((p) => Number(p.load)).filter((v) => Number.isFinite(v) && v > 0);
    if (loads.length < 4) continue;
    const med = median(loads);
    if (!Number.isFinite(med) || med <= 0) continue;

    const threshold = Math.max(med * 4, med + 400);
    for (const point of points) {
      if (Number(point.load) > threshold) flagged.add(point);
    }
  }

  return rows.map((row) => {
    if (!flagged.has(row)) return row;
    return {
      ...row,
      analytics_load_outlier: true,
      analytics_excluded_load_lb: Number(row.load),
      load: 0,
      counts_load: false,
      est_1rm: 0,
    };
  });
}
