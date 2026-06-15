import { supabase } from "@/integrations/supabase/client";
import { parseISO, format, startOfDay } from "date-fns";

const sb = supabase as any;

export type Unit = "kg" | "lb";

export interface SetRow {
  id: string;
  row_id: string;
  exercise_id: string | null;
  exercise_name: string;
  category: string | null;
  day_id: string;
  week_id: string;
  week_index: number;
  day_index: number;
  day_title: string | null;
  block_id: string;
  set_index: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  completed: boolean;
  date: string | null; // ISO date
}

export interface SummaryStats {
  workouts_completed: number;
  total_workouts: number;
  completion_pct: number;
  sets_completed: number;
  total_sets: number;
  total_volume: number;
  avg_rpe: number | null;
  missed_workouts: number;
  manual_weeks: number;
  total_training_min: number;
}

export interface WeeklyPoint {
  week_index: number;
  label: string;
  volume: number;
  workouts_completed: number;
  workouts_total: number;
  avg_rpe: number | null;
  top_set: number | null;
  est_1rm: number | null;
  completion_pct: number;
}

export interface ExerciseSeriesPoint {
  date: string;
  week_index: number;
  top_set: number | null;
  est_1rm: number | null;
  volume: number;
  avg_rpe: number | null;
  reps: number;
  sets: number;
}

export interface PR {
  label: string;
  value: string;
  exercise: string;
  date: string | null;
}

export interface Insight { label: string; value: string; tone?: "up" | "down" | "flat" }
export interface Flag { kind: string; label: string; tone: "warn" | "good" | "info" }

export interface BlockAnalytics {
  block: any;
  unit: Unit;
  sets: SetRow[];
  exercises: { id: string; name: string; category: string | null }[];
  workout_days: { id: string; week_index: number; day_index: number; title: string | null }[];
  summary: SummaryStats;
  weekly: WeeklyPoint[];
  prs: PR[];
  insights: Insight[];
  flags: Flag[];
}

function parseRPE(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
import { epley1RM as epley } from "@/lib/analytics/e1rm";
function isBodyweightCategory(c: string | null): boolean {
  if (!c) return false;
  const k = c.toLowerCase();
  return k.includes("cardio") || k.includes("mobility") || k.includes("conditioning");
}

/** Load everything needed to compute analytics for a single block. */
export async function getBlockAnalytics(blockId: string): Promise<BlockAnalytics | null> {
  const { data: block } = await sb.from("pl_blocks").select("*").eq("id", blockId).maybeSingle();
  if (!block) return null;

  const { data: client } = await sb.from("clients").select("preferred_weight_unit").eq("id", block.client_id).maybeSingle();
  const unit: Unit = (client?.preferred_weight_unit?.toLowerCase?.() === "lb" ? "lb" : "kg");

  const { data: weeks = [] } = await sb.from("pl_weeks").select("*").eq("block_id", blockId).order("week_index");
  const weekIds = weeks.map((w: any) => w.id);
  const { data: days = [] } = weekIds.length
    ? await sb.from("pl_days").select("*").in("week_id", weekIds).order("day_index")
    : { data: [] };
  const dayIds = days.map((d: any) => d.id);
  const { data: rows = [] } = dayIds.length
    ? await sb.from("pl_exercise_rows").select("*, exercise:exercises(id,name,category)").in("day_id", dayIds)
    : { data: [] };
  const rowIds = rows.map((r: any) => r.id);
  const { data: results = [] } = rowIds.length
    ? await sb.from("pl_row_results").select("*").in("row_id", rowIds).eq("client_id", block.client_id)
    : { data: [] };
  const { data: comps = [] } = dayIds.length
    ? await sb.from("pl_day_completions").select("*").in("day_id", dayIds).eq("client_id", block.client_id)
    : { data: [] };

  const weekById = new Map(weeks.map((w: any) => [w.id, w]));
  const dayById = new Map(days.map((d: any) => [d.id, d]));
  const rowById = new Map(rows.map((r: any) => [r.id, r]));
  const compByDay = new Map(comps.map((c: any) => [c.day_id, c]));

  const sets: SetRow[] = (results as any[]).map((r) => {
    const row = rowById.get(r.row_id) as any;
    const day = row ? dayById.get(row.day_id) as any : null;
    const week = day ? weekById.get(day.week_id) as any : null;
    const comp = day ? compByDay.get(day.id) as any : null;
    const ex = row?.exercise ?? null;
    const weight = unit === "lb"
      ? (r.actual_load_unit === "kg" ? null : r.actual_load) // don't auto-convert per spec
      : (r.actual_load_unit === "lb" ? null : r.actual_load);
    return {
      id: r.id,
      row_id: r.row_id,
      exercise_id: ex?.id ?? null,
      exercise_name: ex?.name ?? row?.exercise_name_override ?? "Exercise",
      category: ex?.category ?? null,
      day_id: row?.day_id ?? "",
      week_id: day?.week_id ?? "",
      week_index: week?.week_index ?? 0,
      day_index: day?.day_index ?? 0,
      day_title: day?.title ?? null,
      block_id: blockId,
      set_index: r.set_index ?? 0,
      weight: weight != null ? Number(weight) : (r.actual_load != null ? Number(r.actual_load) : null),
      reps: r.actual_reps ?? null,
      rpe: parseRPE(r.actual_rpe),
      completed: !!r.completed_at,
      date: r.completed_at ?? comp?.completed_at ?? day?.scheduled_date ?? null,
    };
  });

  const exercises = Array.from(
    new Map(
      (rows as any[])
        .filter((r) => r.exercise)
        .map((r) => [r.exercise.id, { id: r.exercise.id, name: r.exercise.name, category: r.exercise.category }])
    ).values(),
  );

  const workout_days = (days as any[]).map((d) => {
    const w = weekById.get(d.week_id) as any;
    return { id: d.id, week_index: w?.week_index ?? 0, day_index: d.day_index, title: d.title };
  });

  // Summary
  const completedSets = sets.filter((s) => s.completed);
  const totalSets = (rows as any[]).reduce((acc, r) => acc + (r.sets ?? 0), 0);
  const totalVolume = completedSets.reduce((acc, s) => acc + ((s.weight ?? 0) * (s.reps ?? 0)), 0);
  const rpes = completedSets.map((s) => s.rpe).filter((x): x is number => x != null);
  const avgRpe = rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null;
  const workoutsDone = (comps as any[]).filter((c) => c.completed_at).length;
  const totalWorkouts = days.length;
  const totalMin = (comps as any[]).reduce((acc, c) => acc + (c.actual_duration_min ?? 0), 0);
  const manualWeeks = (weeks as any[]).filter((w) => w.manually_completed).length;

  // Missed = scheduled date passed and not completed
  const today = startOfDay(new Date());
  const missed = (days as any[]).filter((d) => {
    const comp = compByDay.get(d.id) as any;
    if (comp?.completed_at) return false;
    if (!d.scheduled_date) return false;
    return parseISO(d.scheduled_date) < today;
  }).length;

  const summary: SummaryStats = {
    workouts_completed: workoutsDone,
    total_workouts: totalWorkouts,
    completion_pct: totalWorkouts ? Math.round((workoutsDone / totalWorkouts) * 100) : 0,
    sets_completed: completedSets.length,
    total_sets: totalSets,
    total_volume: Math.round(totalVolume),
    avg_rpe: avgRpe,
    missed_workouts: missed,
    manual_weeks: manualWeeks,
    total_training_min: totalMin,
  };

  // Weekly aggregates
  const weekly: WeeklyPoint[] = (weeks as any[]).map((w) => {
    const wDays = (days as any[]).filter((d) => d.week_id === w.id);
    const wDayIds = new Set(wDays.map((d) => d.id));
    const wSets = completedSets.filter((s) => wDayIds.has(s.day_id));
    const vol = wSets.reduce((a, s) => a + ((s.weight ?? 0) * (s.reps ?? 0)), 0);
    const wRpes = wSets.map((s) => s.rpe).filter((x): x is number => x != null);
    const topSet = wSets.reduce((m, s) => Math.max(m, s.weight ?? 0), 0) || null;
    const e1rm = wSets.reduce((m, s) => {
      if (!s.weight || !s.reps || s.reps <= 0 || isBodyweightCategory(s.category)) return m;
      return Math.max(m, epley(s.weight, s.reps));
    }, 0) || null;
    const wDone = wDays.filter((d) => (compByDay.get(d.id) as any)?.completed_at).length;
    return {
      week_index: w.week_index,
      label: `W${w.week_index}`,
      volume: Math.round(vol),
      workouts_completed: wDone,
      workouts_total: wDays.length,
      avg_rpe: wRpes.length ? Math.round((wRpes.reduce((a, b) => a + b, 0) / wRpes.length) * 10) / 10 : null,
      top_set: topSet,
      est_1rm: e1rm,
      completion_pct: wDays.length ? Math.round((wDone / wDays.length) * 100) : 0,
    };
  });

  // PRs
  const prs: PR[] = [];
  const bestByMetric = (label: string, valueOf: (s: SetRow) => number | null) => {
    let best: SetRow | null = null;
    let bestVal = -Infinity;
    for (const s of completedSets) {
      const v = valueOf(s);
      if (v == null) continue;
      if (v > bestVal) { bestVal = v; best = s; }
    }
    if (best) prs.push({ label, value: `${bestVal} ${label.includes("Reps") ? "reps" : unit}`, exercise: best.exercise_name, date: best.date });
  };
  bestByMetric("Highest Load", (s) => s.weight);
  bestByMetric("Highest e1RM", (s) => (s.weight && s.reps && s.reps > 0 && !isBodyweightCategory(s.category) ? epley(s.weight, s.reps) : null));
  bestByMetric("Highest Rep PR", (s) => s.reps);
  // Highest volume session
  const volByDay = new Map<string, number>();
  for (const s of completedSets) {
    if (!s.weight || !s.reps) continue;
    volByDay.set(s.day_id, (volByDay.get(s.day_id) ?? 0) + s.weight * s.reps);
  }
  let bestDay: string | null = null, bestVol = 0;
  for (const [k, v] of volByDay) if (v > bestVol) { bestVol = v; bestDay = k; }
  if (bestDay) {
    const d = dayById.get(bestDay) as any;
    const w = d ? weekById.get(d.week_id) as any : null;
    prs.push({ label: "Highest Volume Session", value: `${Math.round(bestVol)} ${unit}`, exercise: d?.title ?? `W${w?.week_index} D${d?.day_index}`, date: (compByDay.get(bestDay) as any)?.completed_at ?? null });
  }

  // Insights
  const insights: Insight[] = [];
  if (weekly.length >= 2) {
    const first = weekly[0], last = weekly[weekly.length - 1];
    if (first.volume && last.volume) {
      const delta = ((last.volume - first.volume) / first.volume) * 100;
      insights.push({
        label: "Volume Trend",
        value: `${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} ${Math.round(Math.abs(delta))}%`,
        tone: delta > 5 ? "up" : delta < -5 ? "down" : "flat",
      });
    }
    if (first.avg_rpe != null && last.avg_rpe != null) {
      const d = last.avg_rpe - first.avg_rpe;
      insights.push({
        label: "Avg RPE Trend",
        value: `${d > 0 ? "↑" : d < 0 ? "↓" : "→"} ${Math.abs(Math.round(d * 10) / 10)}`,
        tone: d > 0.3 ? "up" : d < -0.3 ? "down" : "flat",
      });
    }
  }
  // Per-exercise improvement: largest e1RM gain
  const byEx = new Map<string, { name: string; first: number; last: number; firstDate: string; lastDate: string }>();
  for (const s of completedSets) {
    if (!s.exercise_id || !s.weight || !s.reps || s.reps <= 0 || isBodyweightCategory(s.category)) continue;
    const e1 = epley(s.weight, s.reps);
    const cur = byEx.get(s.exercise_id);
    const date = s.date ?? "";
    if (!cur) { byEx.set(s.exercise_id, { name: s.exercise_name, first: e1, last: e1, firstDate: date, lastDate: date }); }
    else {
      if (date && date < cur.firstDate) { cur.first = e1; cur.firstDate = date; }
      if (date && date > cur.lastDate) { cur.last = e1; cur.lastDate = date; }
    }
  }
  let mostImproved: { name: string; delta: number } | null = null;
  let mostStalled: { name: string; delta: number } | null = null;
  for (const v of byEx.values()) {
    const d = v.last - v.first;
    if (!mostImproved || d > mostImproved.delta) mostImproved = { name: v.name, delta: d };
    if (!mostStalled || Math.abs(d) < Math.abs(mostStalled.delta)) mostStalled = { name: v.name, delta: d };
  }
  if (mostImproved) insights.push({ label: "Most Improved Lift", value: `${mostImproved.name} (+${Math.round(mostImproved.delta * 10) / 10} ${unit} e1RM)`, tone: "up" });
  if (mostStalled) insights.push({ label: "Most Stalled Lift", value: `${mostStalled.name}`, tone: "flat" });
  // Most consistent week (highest completion %)
  if (weekly.length) {
    const best = weekly.reduce((a, b) => (b.completion_pct > a.completion_pct ? b : a));
    insights.push({ label: "Most Consistent Week", value: `Week ${best.week_index} (${best.completion_pct}%)`, tone: "up" });
  }

  // Flags
  const flags: Flag[] = [];
  if (summary.missed_workouts > 0) flags.push({ kind: "missed", label: `${summary.missed_workouts} missed workout${summary.missed_workouts === 1 ? "" : "s"}`, tone: "warn" });
  if (summary.manual_weeks > 0) flags.push({ kind: "manual", label: `${summary.manual_weeks} manual week completion${summary.manual_weeks === 1 ? "" : "s"}`, tone: "info" });
  if (summary.completion_pct < 70 && summary.total_workouts > 0) flags.push({ kind: "low_compliance", label: `Low compliance (${summary.completion_pct}%)`, tone: "warn" });
  for (let i = 1; i < weekly.length; i++) {
    const prev = weekly[i - 1], cur = weekly[i];
    if (prev.volume && cur.volume) {
      const d = (cur.volume - prev.volume) / prev.volume;
      if (d > 0.2) flags.push({ kind: "vol_up", label: `Volume +${Math.round(d * 100)}% W${prev.week_index}→W${cur.week_index}`, tone: "good" });
      if (d < -0.2) flags.push({ kind: "vol_down", label: `Volume ${Math.round(d * 100)}% W${prev.week_index}→W${cur.week_index}`, tone: "warn" });
    }
    if (prev.avg_rpe != null && cur.avg_rpe != null && cur.avg_rpe - prev.avg_rpe >= 1) {
      flags.push({ kind: "rpe_spike", label: `RPE spike W${cur.week_index}`, tone: "warn" });
    }
    if (prev.volume && cur.volume && cur.volume < prev.volume * 0.6) {
      flags.push({ kind: "deload", label: `Possible deload W${cur.week_index}`, tone: "info" });
    }
  }
  if (prs.length) flags.push({ kind: "pr", label: `${prs.length} block PR${prs.length === 1 ? "" : "s"}`, tone: "good" });

  return { block, unit, sets, exercises, workout_days, summary, weekly, prs, insights, flags };
}

/** Build an exercise-specific time series. */
export function buildExerciseSeries(sets: SetRow[], exerciseId: string): ExerciseSeriesPoint[] {
  const ex = sets.filter((s) => s.exercise_id === exerciseId && s.completed);
  const byDay = new Map<string, SetRow[]>();
  for (const s of ex) {
    const key = s.day_id;
    const arr = byDay.get(key) ?? [];
    arr.push(s);
    byDay.set(key, arr);
  }
  const points: ExerciseSeriesPoint[] = [];
  for (const [, group] of byDay) {
    const first = group[0];
    const reps = group.reduce((a, s) => a + (s.reps ?? 0), 0);
    const vol = group.reduce((a, s) => a + ((s.weight ?? 0) * (s.reps ?? 0)), 0);
    const topSet = group.reduce((m, s) => Math.max(m, s.weight ?? 0), 0) || null;
    const rpes = group.map((s) => s.rpe).filter((x): x is number => x != null);
    const e1rm = group.reduce((m, s) => {
      if (!s.weight || !s.reps || s.reps <= 0 || isBodyweightCategory(s.category)) return m;
      return Math.max(m, epley(s.weight, s.reps));
    }, 0) || null;
    points.push({
      date: first.date ?? "",
      week_index: first.week_index,
      top_set: topSet,
      est_1rm: e1rm,
      volume: Math.round(vol),
      avg_rpe: rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null,
      reps,
      sets: group.length,
    });
  }
  return points.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

/** Map exercise category to movement category buckets. */
export function movementCategory(category: string | null): string {
  if (!category) return "Accessories";
  const c = category.toLowerCase();
  if (c.includes("squat")) return "Squat";
  if (c.includes("bench") || c.includes("press") && c.includes("chest")) return "Bench";
  if (c.includes("deadlift") || c.includes("hinge")) return "Deadlift";
  if (c.includes("upper") || c.includes("push") || c.includes("pull")) return "Upper";
  if (c.includes("lower") || c.includes("leg")) return "Lower";
  return "Accessories";
}

/** CSV export of analytics. */
export function analyticsToCSV(a: BlockAnalytics): string {
  const lines: string[] = [];
  lines.push(`Block,${a.block.name}`);
  lines.push(`Unit,${a.unit}`);
  lines.push("");
  lines.push("Summary");
  lines.push("Metric,Value");
  lines.push(`Workouts Completed,${a.summary.workouts_completed}/${a.summary.total_workouts}`);
  lines.push(`Completion %,${a.summary.completion_pct}`);
  lines.push(`Sets Completed,${a.summary.sets_completed}/${a.summary.total_sets}`);
  lines.push(`Total Volume,${a.summary.total_volume} ${a.unit}`);
  lines.push(`Avg RPE,${a.summary.avg_rpe ?? ""}`);
  lines.push(`Missed Workouts,${a.summary.missed_workouts}`);
  lines.push(`Manual Weeks,${a.summary.manual_weeks}`);
  lines.push(`Training Minutes,${a.summary.total_training_min}`);
  lines.push("");
  lines.push("Weekly");
  lines.push("Week,Volume,Workouts Done,Workouts Total,Avg RPE,Top Set,e1RM,Completion %");
  for (const w of a.weekly) {
    lines.push([w.week_index, w.volume, w.workouts_completed, w.workouts_total, w.avg_rpe ?? "", w.top_set ?? "", w.est_1rm ?? "", w.completion_pct].join(","));
  }
  lines.push("");
  lines.push("Sets");
  lines.push("Date,Week,Day,Exercise,Set,Weight,Reps,RPE,Completed");
  for (const s of a.sets) {
    const date = s.date ? format(parseISO(s.date), "yyyy-MM-dd") : "";
    lines.push([date, s.week_index, s.day_index, JSON.stringify(s.exercise_name), s.set_index, s.weight ?? "", s.reps ?? "", s.rpe ?? "", s.completed].join(","));
  }
  return lines.join("\n");
}