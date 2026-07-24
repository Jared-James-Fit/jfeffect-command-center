/**
 * Performance Insights calculators.
 *
 * Pure functions that take normalized set rows and produce the numbers
 * consumed by the Performance Insights UI: muscle-group volume, tonnage,
 * powerlifting comp-lift breakdowns, and derived insight bullets.
 *
 * All math runs in LB internally; the caller converts for display.
 */

import { epley1RM } from "./e1rm";
import {
  MUSCLE_GROUPS,
  resolveMuscleGroups,
  type MuscleGroup,
} from "./muscle-map";

/** One logged set with the metadata Performance Insights needs. */
export interface InsightSet {
  date: string; // ISO timestamp
  load_lb: number;
  reps: number;
  rpe: number | null;
  exercise_name: string;
  primary_muscle: string | null;
  secondary_muscles: string[] | null;
  is_competition_lift: boolean;
  competition_lift_type: string | null; // 'squat' | 'bench' | 'deadlift' | null
  lift_family: string | null;
  variation_type: string | null;
  counts_toward_volume: boolean;
  volume_multiplier: number;
}

export interface MuscleStat {
  group: MuscleGroup;
  weekly_sets: number;
  monthly_sets: number;
  avg_weekly_sets: number;
  weekly_tonnage: number;
  monthly_tonnage: number;
  /** Percent change vs previous equal-length window. */
  trend_pct: number | null;
}

export type CompLift = "squat" | "bench" | "deadlift";

export interface CompLiftStat {
  lift: CompLift;
  weekly_volume: number; // total reps * load in lb this week (7d)
  weekly_sets: number;
  block_tonnage: number;
  avg_intensity_pct: number | null; // load / max_e1rm * 100
  avg_rpe: number | null;
  top_set: { load: number; reps: number; date: string } | null;
  e1rm_trend: { date: string; est_1rm: number }[]; // by week, max e1rm
  variations: { name: string; sets: number; tonnage: number }[];
}

export interface PerformanceInsight {
  id: string;
  emoji: string;
  headline: string;
  subline: string;
  shareable: boolean;
  metric?: { label: string; value: string };
}

export type TimeWindow = "week" | "month" | "block" | "year" | "all";

const DAY = 86400000;

export interface WindowRange {
  start: number;
  end: number;
  /** Approximate window length in days, used for the previous comparison window. */
  lengthDays: number;
}

export function resolveWindow(
  window: TimeWindow,
  block?: { start_date: string | null; end_date: string | null } | null,
): WindowRange {
  const now = Date.now();
  switch (window) {
    case "week":
      return { start: now - 7 * DAY, end: now, lengthDays: 7 };
    case "month":
      return { start: now - 30 * DAY, end: now, lengthDays: 30 };
    case "year":
      return { start: now - 365 * DAY, end: now, lengthDays: 365 };
    case "block": {
      const s = block?.start_date ? new Date(block.start_date).getTime() : now - 42 * DAY;
      const e = block?.end_date ? Math.min(new Date(block.end_date).getTime(), now) : now;
      return { start: s, end: e, lengthDays: Math.max(1, Math.round((e - s) / DAY)) };
    }
    case "all":
    default:
      return { start: 0, end: now, lengthDays: 3650 };
  }
}

function inWindow(t: number, r: WindowRange) {
  return t >= r.start && t <= r.end;
}

function tonnage(s: InsightSet): number {
  return (Number(s.load_lb) || 0) * (Number(s.reps) || 0);
}

/**
 * Muscle-group volume + tonnage + trend for the window, plus weekly/monthly
 * anchor stats so cards can show "22 sets/week · 84 sets/month".
 */
export function muscleGroupStats(sets: InsightSet[], window: WindowRange): MuscleStat[] {
  const now = window.end;
  const weekStart = now - 7 * DAY;
  const monthStart = now - 30 * DAY;
  const prevStart = window.start - window.lengthDays * DAY;

  const perGroup = new Map<MuscleGroup, {
    weekly_sets: number;
    monthly_sets: number;
    weekly_tonnage: number;
    monthly_tonnage: number;
    window_sets: number;
    prev_window_sets: number;
    total_days_active: Set<string>;
  }>();
  for (const g of MUSCLE_GROUPS) {
    perGroup.set(g, {
      weekly_sets: 0, monthly_sets: 0,
      weekly_tonnage: 0, monthly_tonnage: 0,
      window_sets: 0, prev_window_sets: 0,
      total_days_active: new Set(),
    });
  }

  for (const s of sets) {
    if (!s.counts_toward_volume) continue;
    const t = new Date(s.date).getTime();
    if (Number.isNaN(t)) continue;
    const contribs = resolveMuscleGroups(s.primary_muscle, s.secondary_muscles);
    if (!contribs.length) continue;
    const setWeight = Number(s.volume_multiplier ?? 1) || 1;
    const ton = tonnage(s);
    for (const c of contribs) {
      const bucket = perGroup.get(c.group);
      if (!bucket) continue;
      const contribSets = c.weight * setWeight;
      if (t >= weekStart) {
        bucket.weekly_sets += contribSets;
        bucket.weekly_tonnage += ton * c.weight;
      }
      if (t >= monthStart) {
        bucket.monthly_sets += contribSets;
        bucket.monthly_tonnage += ton * c.weight;
      }
      if (inWindow(t, window)) {
        bucket.window_sets += contribSets;
      }
      if (t >= prevStart && t < window.start) {
        bucket.prev_window_sets += contribSets;
      }
    }
  }

  const weeksInWindow = Math.max(1, window.lengthDays / 7);
  return MUSCLE_GROUPS.map((g) => {
    const b = perGroup.get(g)!;
    const trend =
      b.prev_window_sets > 0
        ? Math.round(((b.window_sets - b.prev_window_sets) / b.prev_window_sets) * 100)
        : b.window_sets > 0
          ? 100
          : null;
    return {
      group: g,
      weekly_sets: Math.round(b.weekly_sets * 10) / 10,
      monthly_sets: Math.round(b.monthly_sets * 10) / 10,
      avg_weekly_sets: Math.round((b.window_sets / weeksInWindow) * 10) / 10,
      weekly_tonnage: Math.round(b.weekly_tonnage),
      monthly_tonnage: Math.round(b.monthly_tonnage),
      trend_pct: trend,
    };
  });
}

export interface TopMuscleGroups {
  most_trained: MuscleStat | null;
  highest_tonnage: MuscleStat | null;
  biggest_growth: MuscleStat | null;
  most_consistent: { group: MuscleGroup; weeks_hit: number; window_weeks: number } | null;
}

export function topMuscleGroups(
  stats: MuscleStat[],
  sets: InsightSet[],
  window: WindowRange,
): TopMuscleGroups {
  const trained = [...stats].filter((s) => s.monthly_sets > 0)
    .sort((a, b) => b.monthly_sets - a.monthly_sets)[0] ?? null;
  const tonn = [...stats].filter((s) => s.monthly_tonnage > 0)
    .sort((a, b) => b.monthly_tonnage - a.monthly_tonnage)[0] ?? null;
  const growth = [...stats].filter((s) => s.trend_pct != null && s.monthly_sets > 0)
    .sort((a, b) => (b.trend_pct ?? -Infinity) - (a.trend_pct ?? -Infinity))[0] ?? null;
  // "Most consistent": most distinct weeks with ≥1 set inside the window.
  const perGroup = new Map<MuscleGroup, Set<string>>();
  for (const g of MUSCLE_GROUPS) perGroup.set(g, new Set());
  for (const s of sets) {
    if (!s.counts_toward_volume) continue;
    const t = new Date(s.date).getTime();
    if (Number.isNaN(t) || !inWindow(t, window)) continue;
    const weekKey = String(Math.floor(t / (7 * DAY)));
    for (const c of resolveMuscleGroups(s.primary_muscle, s.secondary_muscles)) {
      perGroup.get(c.group)?.add(weekKey);
    }
  }
  const consistencyRows = [...perGroup.entries()]
    .map(([group, set]) => ({ group, weeks_hit: set.size }))
    .sort((a, b) => b.weeks_hit - a.weeks_hit);
  const consistent = consistencyRows[0]?.weeks_hit
    ? {
        group: consistencyRows[0].group,
        weeks_hit: consistencyRows[0].weeks_hit,
        window_weeks: Math.max(1, Math.round(window.lengthDays / 7)),
      }
    : null;

  return {
    most_trained: trained,
    highest_tonnage: tonn,
    biggest_growth: growth && growth.trend_pct != null && growth.trend_pct > 0 ? growth : null,
    most_consistent: consistent,
  };
}

function detectCompLift(s: InsightSet): CompLift | null {
  if (s.is_competition_lift) {
    const raw = (s.competition_lift_type ?? "").toLowerCase();
    if (raw.includes("squat")) return "squat";
    if (raw.includes("bench")) return "bench";
    if (raw.includes("dead")) return "deadlift";
  }
  const n = (s.exercise_name ?? "").toLowerCase();
  const fam = (s.lift_family ?? "").toLowerCase();
  if (fam.includes("squat") || (/\bsquat\b/.test(n) && !n.includes("split"))) return "squat";
  if (fam.includes("bench") || /\bbench\b/.test(n)) return "bench";
  if (fam.includes("dead") || /\bdead(lift)?\b/.test(n)) return "deadlift";
  return null;
}

export function powerliftingStats(sets: InsightSet[], window: WindowRange): CompLiftStat[] {
  const now = window.end;
  const weekStart = now - 7 * DAY;
  const byLift = new Map<CompLift, InsightSet[]>();
  for (const s of sets) {
    const t = new Date(s.date).getTime();
    if (Number.isNaN(t) || !inWindow(t, window)) continue;
    const lift = detectCompLift(s);
    if (!lift) continue;
    if (!byLift.has(lift)) byLift.set(lift, []);
    byLift.get(lift)!.push(s);
  }

  const out: CompLiftStat[] = [];
  for (const lift of ["squat", "bench", "deadlift"] as CompLift[]) {
    const arr = byLift.get(lift) ?? [];
    if (!arr.length) continue;
    const weekArr = arr.filter((s) => new Date(s.date).getTime() >= weekStart);
    const weekly_volume = weekArr.reduce((sum, s) => sum + tonnage(s), 0);
    const weekly_sets = weekArr.length;
    const block_tonnage = arr.reduce((sum, s) => sum + tonnage(s), 0);
    const maxE1RM = arr.reduce((m, s) => Math.max(m, epley1RM(s.load_lb, s.reps)), 0);
    const withPct = arr.filter((s) => s.load_lb > 0 && maxE1RM > 0);
    const avg_intensity_pct = withPct.length
      ? Math.round((withPct.reduce((sum, s) => sum + (s.load_lb / maxE1RM), 0) / withPct.length) * 100)
      : null;
    const rpes = arr.map((s) => (s.rpe == null ? null : Number(s.rpe))).filter((n): n is number => n != null && Number.isFinite(n));
    const avg_rpe = rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null;
    const top = [...arr].sort((a, b) => epley1RM(b.load_lb, b.reps) - epley1RM(a.load_lb, a.reps))[0];
    const top_set = top ? { load: top.load_lb, reps: top.reps, date: top.date } : null;

    // Weekly max e1RM series
    const weekMap = new Map<string, number>();
    for (const s of arr) {
      const t = new Date(s.date).getTime();
      const key = String(Math.floor(t / (7 * DAY)));
      const e = epley1RM(s.load_lb, s.reps);
      weekMap.set(key, Math.max(weekMap.get(key) ?? 0, e));
    }
    const e1rm_trend = [...weekMap.entries()]
      .map(([k, e]) => ({ date: new Date(Number(k) * 7 * DAY).toISOString(), est_1rm: Math.round(e * 10) / 10 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Variations by name
    const vmap = new Map<string, { sets: number; tonnage: number }>();
    for (const s of arr) {
      const key = s.exercise_name || "Unknown";
      const v = vmap.get(key) ?? { sets: 0, tonnage: 0 };
      v.sets += 1;
      v.tonnage += tonnage(s);
      vmap.set(key, v);
    }
    const variations = [...vmap.entries()]
      .map(([name, v]) => ({ name, sets: v.sets, tonnage: Math.round(v.tonnage) }))
      .sort((a, b) => b.sets - a.sets)
      .slice(0, 6);

    out.push({
      lift, weekly_volume: Math.round(weekly_volume), weekly_sets,
      block_tonnage: Math.round(block_tonnage),
      avg_intensity_pct, avg_rpe, top_set, e1rm_trend, variations,
    });
  }
  return out;
}

export type TrainingFocus = "powerlifting" | "bodybuilding" | "hybrid" | "unknown";

/**
 * Detect the athlete's training focus. Uses block/client hints when present;
 * otherwise infers from the ratio of comp-lift volume to total volume in the
 * most recent 30 days.
 */
export function detectFocus(
  sets: InsightSet[],
  hints: { client_focus?: string | null; block_focus?: string | null },
): TrainingFocus {
  const hint = (hints.block_focus ?? hints.client_focus ?? "").toLowerCase();
  if (hint.includes("power")) return "powerlifting";
  if (hint.includes("body") || hint.includes("physique") || hint.includes("hyper")) return "bodybuilding";
  if (hint.includes("hybrid") || hint.includes("both")) return "hybrid";
  const now = Date.now();
  const cutoff = now - 30 * DAY;
  const recent = sets.filter((s) => new Date(s.date).getTime() >= cutoff);
  if (!recent.length) return "unknown";
  const compTon = recent.filter((s) => detectCompLift(s)).reduce((sum, s) => sum + tonnage(s), 0);
  const total = recent.reduce((sum, s) => sum + tonnage(s), 0);
  if (total <= 0) return "unknown";
  const ratio = compTon / total;
  if (ratio >= 0.55) return "powerlifting";
  if (ratio <= 0.2) return "bodybuilding";
  return "hybrid";
}

/** Data-driven insights — every string is grounded in the athlete's numbers. */
export function generateInsights(
  stats: MuscleStat[],
  top: TopMuscleGroups,
  pl: CompLiftStat[],
  sets: InsightSet[],
  window: WindowRange,
): PerformanceInsight[] {
  const out: PerformanceInsight[] = [];

  if (top.most_trained) {
    out.push({
      id: "top-muscle",
      emoji: "🏆",
      headline: `${top.most_trained.group} received your highest training volume`,
      subline: `${Math.round(top.most_trained.monthly_sets)} sets in the last 30 days.`,
      shareable: true,
      metric: { label: `${top.most_trained.group} sets`, value: String(Math.round(top.most_trained.monthly_sets)) },
    });
  }
  if (top.biggest_growth && top.biggest_growth.trend_pct != null && top.biggest_growth.trend_pct >= 10) {
    out.push({
      id: "growth",
      emoji: "📈",
      headline: `${top.biggest_growth.group} volume up ${top.biggest_growth.trend_pct}%`,
      subline: `Compared to the previous window.`,
      shareable: true,
      metric: { label: `${top.biggest_growth.group} trend`, value: `+${top.biggest_growth.trend_pct}%` },
    });
  }
  for (const s of pl) {
    if (s.avg_intensity_pct != null && s.avg_intensity_pct >= 75) {
      out.push({
        id: `intensity-${s.lift}`,
        emoji: "🔥",
        headline: `Heavy ${s.lift} block`,
        subline: `Averaging ${s.avg_intensity_pct}% of estimated 1RM across your working sets.`,
        shareable: true,
        metric: { label: `${s.lift} intensity`, value: `${s.avg_intensity_pct}%` },
      });
    }
    if (s.e1rm_trend.length >= 3) {
      const first = s.e1rm_trend[0].est_1rm;
      const last = s.e1rm_trend[s.e1rm_trend.length - 1].est_1rm;
      if (first > 0 && last > first) {
        const pct = Math.round(((last - first) / first) * 100);
        if (pct >= 3) {
          out.push({
            id: `e1rm-${s.lift}`,
            emoji: "💪",
            headline: `${s.lift[0].toUpperCase() + s.lift.slice(1)} e1RM climbing`,
            subline: `Up ${pct}% since the start of this window.`,
            shareable: true,
            metric: { label: `${s.lift} e1RM`, value: `+${pct}%` },
          });
        }
      }
    }
  }
  if (top.most_consistent && top.most_consistent.weeks_hit >= 3) {
    out.push({
      id: "consistent",
      emoji: "📅",
      headline: `${top.most_consistent.group} hit ${top.most_consistent.weeks_hit} of the last ${top.most_consistent.window_weeks} weeks`,
      subline: `Your most consistent muscle group.`,
      shareable: true,
    });
  }
  const totalTonnage = sets
    .filter((s) => {
      const t = new Date(s.date).getTime();
      return !Number.isNaN(t) && inWindow(t, window);
    })
    .reduce((sum, s) => sum + tonnage(s), 0);
  if (totalTonnage > 0) {
    out.unshift({
      id: "total-tonnage",
      emoji: "🏋️",
      headline: `${Math.round(totalTonnage).toLocaleString()} lb moved`,
      subline: `Total tonnage across your logged sets.`,
      shareable: true,
      metric: { label: "Total volume", value: `${Math.round(totalTonnage).toLocaleString()} lb` },
    });
  }
  return out.slice(0, 6);
}

export interface CoachExtras {
  adherence_pct: number | null; // logged sets / prescribed sets
  missed_volume_sets: number;
  balance_score: number; // 0-100, how balanced across the 12 groups
}

/**
 * Coach-only rollups. `prescribed` is the sum of `pl_exercise_rows.sets`
 * across days that fall inside the window; caller passes it in so we don't
 * refetch here.
 */
export function coachExtras(
  stats: MuscleStat[],
  completedSets: number,
  prescribedSets: number,
): CoachExtras {
  const adherence = prescribedSets > 0 ? Math.round((completedSets / prescribedSets) * 100) : null;
  const missed = Math.max(0, prescribedSets - completedSets);

  // Balance: 100 = every group has ≥ 8 sets in the window; drops as groups
  // fall below threshold. Simple + interpretable rather than a stdev score.
  const target = 8;
  const hit = stats.filter((s) => s.avg_weekly_sets * (30 / 7) >= target).length;
  const balance_score = Math.round((hit / stats.length) * 100);
  return { adherence_pct: adherence, missed_volume_sets: missed, balance_score };
}