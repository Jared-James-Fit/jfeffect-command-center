import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { previousLeagueMonth } from "@/lib/league-recap";
import type { LeagueRow } from "@/lib/league-boost";

export type PerformanceLeagueRow = LeagueRow & {
  is_coach?: boolean;
  bodyweight_value: number | null;
  bodyweight_unit: string | null;
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const nOrNull = (v: unknown) => (v == null ? null : Number(v));

/** One get_performance_league() row with every number a number (rank stays null when unranked). */
export function normalizeLeagueRow(r: any): PerformanceLeagueRow {
  return {
    ...r,
    rank: r.rank == null ? null : Number(r.rank),
    qualified: Boolean(r.qualified),
    is_me: Boolean(r.is_me),
    total_points: n(r.total_points),
    workout_points: n(r.workout_points),
    logging_points: n(r.logging_points),
    bodyweight_points: n(r.bodyweight_points),
    improvement_points: n(r.improvement_points),
    match_points: n(r.match_points),
    community_points: n(r.community_points),
    community_posts: n(r.community_posts),
    workouts_completed: n(r.workouts_completed),
    fully_logged: n(r.fully_logged),
    needed_workouts: n(r.needed_workouts),
    projected_total: nOrNull(r.projected_total),
    projected_match: nOrNull(r.projected_match),
    eligible_workouts: nOrNull(r.eligible_workouts),
    completed_eligible: nOrNull(r.completed_eligible),
    open_workouts: nOrNull(r.open_workouts),
    adherence_pct: nOrNull(r.adherence_pct),
    match_target: nOrNull(r.match_target),
    atpr_lifts: n(r.atpr_lifts),
    program_pr_lifts: n(r.program_pr_lifts),
    block_pr_lifts: n(r.block_pr_lifts),
    bodyweight_value: nOrNull(r.bodyweight_value),
  };
}

/**
 * This month's League (or last month's final standings), points by source.
 * One cache for Home's Rankings card, the Monthly board and its sheets, and
 * the key every bodyweight / workout / post save already refreshes.
 */
export function usePerformanceLeague(view: "current" | "previous" = "current") {
  const viewerId = usePortalUserId() ?? null;
  return useQuery({
    queryKey: ["athlete-rankings-monthly-view", view, viewerId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_performance_league", {
        _month: view === "previous" ? previousLeagueMonth() : null,
        ...(viewerId ? { _as_user: viewerId } : {}),
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map(normalizeLeagueRow);
    },
  });
}
