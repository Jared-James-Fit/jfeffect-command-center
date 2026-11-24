/**
 * One exercise's progress for its History sheet, read the same way as the
 * Analytics page's lift card (lift-progress-card.tsx): loads in lb, an Epley
 * e1RM per set (the app's one formula, e1rm.ts), the same outlier guard
 * (load-sanity.ts). Only completed sets with reps and an external load count:
 * a bodyweight or assisted set has no load to chart, and a cardio row never
 * gets here.
 */
import { epley1RM } from "@/lib/analytics/e1rm";
import { neutralizeObviousLoadOutliers } from "@/lib/analytics/load-sanity";
import { resultLoadLb } from "@/lib/pl-programs";
import type { LiftHistory, LiftHistoryPoint } from "@/components/analytics/lift-progress-card";

export function liftHistoryFromRows(rows: readonly any[], name: string): LiftHistory | null {
  const mapped = rows
    .filter((r) => r?.completed_at && Number(r.actual_reps) > 0)
    .filter((r) => r.load_type !== "assisted" && r.load_type !== "bodyweight" && r.is_bodyweight !== true)
    .map((r) => {
      const lb = resultLoadLb(r);
      const reps = Number(r.actual_reps);
      return {
        id: String(r.id),
        row_id: r.pl_exercise_rows?.id ?? null,
        day_id: r.pl_exercise_rows?.pl_days?.id ?? null,
        date: String(r.completed_at),
        load: lb,
        reps,
        est_1rm: lb > 0 ? epley1RM(lb, reps) : 0,
        rpe: r.actual_rpe_num ?? r.actual_rpe ?? null,
        rir: r.actual_rir ?? null,
        velocity_mps: !r.velocity_excluded && r.mean_concentric_velocity_mps != null ? Number(r.mean_concentric_velocity_mps) : null,
        set_index: r.set_index ?? null,
        exercise_name: name,
      };
    })
    .filter((p) => p.load > 0);
  const points = (neutralizeObviousLoadOutliers(mapped) as Array<LiftHistoryPoint & { load: number }>)
    .filter((p) => p.load > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return null;
  const pr = points.reduce<LiftHistoryPoint | null>((best, p) => (!best || p.est_1rm > best.est_1rm ? p : best), null);
  return { name, pr, points };
}
