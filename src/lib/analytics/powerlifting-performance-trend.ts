export type TrendRole = "all" | "Primary" | "Secondary" | "Tertiary" | "Quaternary";
export type TrendFamily = "squat" | "bench" | "deadlift";

const LB_PER_KG = 2.2046226;

export type PerformanceTrendPoint = {
  key: string;
  date: string;
  fullDate: string;
  dateMs: number;
  est: number;
  load: number;
  reps: number;
  role: string | null;
  exerciseName: string | null;
  dayId: string | null;
};

/**
 * Powerlifting "Performance Trend" should represent the best strength
 * performance from each workout/exposure — not every warm-up and back-off set.
 *
 * Plotting every set creates fake-looking 200 -> 500 -> 300 swings even when
 * the athlete is progressing normally. Results from getClientResults are
 * normalized to pounds, so this helper also converts both e1RM and load to the
 * requested display unit before they reach the chart.
 */
export function buildPowerliftingPerformanceTrend(
  results: any[],
  opts: {
    family: TrendFamily;
    role: TrendRole;
    start: Date;
    end: Date;
    displayUnit: "lb" | "kg";
  },
): PerformanceTrendPoint[] {
  const startMs = opts.start.getTime();
  const endMs = opts.end.getTime();

  const candidates = (results ?? []).filter((r: any) => {
    const family = String(r?.movement_family ?? "").toLowerCase();
    if (family !== opts.family) return false;
    if (opts.role !== "all" && r?.purpose_label !== opts.role) return false;

    const dateMs = r?.date ? new Date(r.date).getTime() : NaN;
    if (!Number.isFinite(dateMs) || dateMs < startMs || dateMs > endMs) return false;

    const est = Number(r?.est_1rm);
    const load = Number(r?.load);
    const reps = Number(r?.reps);
    return (
      Number.isFinite(est) &&
      Number.isFinite(load) &&
      Number.isFinite(reps) &&
      est > 0 &&
      load > 0 &&
      reps > 0
    );
  });

  // One point per workout/day. day_id is authoritative when available; legacy
  // rows fall back to local calendar date so multiple sets from the same old
  // workout still collapse to one representative performance.
  const bestByWorkout = new Map<string, any>();
  for (const r of candidates) {
    const d = new Date(r.date);
    const fallbackDay = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
    const key = r.day_id ? String(r.day_id) : fallbackDay;
    const prev = bestByWorkout.get(key);
    if (!prev || Number(r.est_1rm) > Number(prev.est_1rm)) {
      bestByWorkout.set(key, r);
    }
  }

  const convert = (lb: number) =>
    opts.displayUnit === "kg" ? lb / LB_PER_KG : lb;

  return [...bestByWorkout.entries()]
    .map(([key, r]) => {
      const d = new Date(r.date);
      return {
        key,
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        fullDate: d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        dateMs: d.getTime(),
        est: Number(convert(Number(r.est_1rm)).toFixed(1)),
        load: Number(convert(Number(r.load)).toFixed(1)),
        reps: Number(r.reps),
        role: r.purpose_label ?? null,
        exerciseName: r.exercise_name ?? null,
        dayId: r.day_id ?? null,
      };
    })
    .sort((a, b) => a.dateMs - b.dateMs);
}
