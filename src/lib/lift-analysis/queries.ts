/**
 * Lift analyses in the database (pl_set_video_analyses): read with the
 * person's own login (RLS: the athlete, their coach, admins), written only
 * through set_video_analysis_save / _delete.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { LvPoint } from "@/lib/lift-analysis/profile";
import { announceChanged, LIFT_ANALYSIS_CHANGED } from "@/lib/lift-analysis/store";

const db = supabase as any;

export type StoredAnalysis = {
  set_video_id: string;
  client_id: string;
  result: LiftAnalysis;
  source: "auto" | "tap";
  units: "mm" | "px";
  best_mcv: number | null;
  best_mcv_tier: "measured" | "estimated" | null;
  velocity_loss_pct: number | null;
  reps: number;
  exercise_id: string | null;
  created_by: string;
  updated_at: string;
};

export const analysesKey = (ids: string[]) => ["lift-analyses", [...ids].sort().join(",")] as const;

/** The saved analyses of these set videos, by set video id. */
export function useSetVideoAnalyses(setVideoIds: string[], opts: { enabled?: boolean } = {}) {
  const qc = useQueryClient();
  const ids = [...new Set(setVideoIds.filter(Boolean))];
  const q = useQuery({
    queryKey: analysesKey(ids),
    enabled: ids.length > 0 && opts.enabled !== false,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, StoredAnalysis>> => {
      const { data, error } = await db
        .from("pl_set_video_analyses")
        .select(
          "set_video_id, client_id, result, source, units, best_mcv, best_mcv_tier, velocity_loss_pct, reps, exercise_id, created_by, updated_at",
        )
        .in("set_video_id", ids);
      if (error) throw error;
      const out: Record<string, StoredAnalysis> = {};
      for (const r of (data ?? []) as StoredAnalysis[]) out[r.set_video_id] = r;
      return out;
    },
  });
  // saved or removed on this device: read again
  useEffect(() => {
    if (!ids.length) return;
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ setVideoId: string }>).detail?.setVideoId;
      if (!id || !ids.includes(id)) return;
      // the set's own read, and everything built from analyses (load–velocity, History's speeds)
      for (const key of ["lift-analyses", "lift-analyses-lv", "lift-analyses-by-result"])
        void qc.invalidateQueries({ queryKey: [key] });
    };
    window.addEventListener(LIFT_ANALYSIS_CHANGED, on);
    return () => window.removeEventListener(LIFT_ANALYSIS_CHANGED, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), qc]);
  return q;
}

export async function saveAnalysis(setVideoId: string, analysis: LiftAnalysis): Promise<void> {
  const { error } = await db.rpc("set_video_analysis_save", {
    _set_video_id: setVideoId,
    _result: analysis,
  });
  if (error) throw error;
  announceChanged(setVideoId);
}

export async function deleteAnalysis(setVideoId: string): Promise<void> {
  const { error } = await db.rpc("set_video_analysis_delete", { _set_video_id: setVideoId });
  if (error) throw error;
  announceChanged(setVideoId);
}

/** Whether a set video already has an analysis (the auto run skips it). */
export async function hasAnalysis(setVideoId: string): Promise<boolean> {
  const { data, error } = await db
    .from("pl_set_video_analyses")
    .select("set_video_id")
    .eq("set_video_id", setVideoId)
    .maybeSingle();
  if (error) return true; // can't tell: don't spend the battery
  return !!data;
}

/**
 * Every analysed set of one exercise for one athlete with a speed and a
 * logged load: the points of their load–velocity line.
 */
export function useLoadVelocityPoints(
  clientId: string | null | undefined,
  exerciseId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["lift-analyses-lv", clientId, exerciseId],
    enabled: !!clientId && !!exerciseId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LvPoint[]> => {
      const { data, error } = await db
        .from("pl_set_video_analyses")
        .select(
          "set_video_id, best_mcv, best_mcv_tier, best_u:result->set->bestMcv->>u, created_at, logged:result_id(actual_load_kg, actual_reps, actual_rpe_num, completed_at, is_bodyweight)",
        )
        .eq("client_id", clientId)
        .eq("exercise_id", exerciseId)
        .not("best_mcv", "is", null)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      const out: LvPoint[] = [];
      for (const r of (data ?? []) as any[]) {
        const kg = Number(r.logged?.actual_load_kg);
        if (!(kg > 0) || r.logged?.is_bodyweight) continue;
        out.push({
          id: r.set_video_id,
          kg,
          v: Number(r.best_mcv),
          u: r.best_u != null ? Number(r.best_u) : null,
          tier: r.best_mcv_tier === "measured" ? "measured" : "estimated",
          at: r.logged?.completed_at ?? r.created_at,
          reps: r.logged?.actual_reps ?? null,
          rpe: r.logged?.actual_rpe_num ?? null,
        });
      }
      return out;
    },
  });
}

export type VideoSpeed = { v: number; tier: "measured" | "estimated"; loss: number | null };

/**
 * The bar speed read from set videos, by logged set (pl_row_results.id), for
 * an athlete's exercise(s): what an exercise's History shows beside a set
 * when no speed was typed in from a device.
 */
export function useVideoSpeedsByResult(
  clientId: string | null | undefined,
  exerciseIds: string[],
  enabled = true,
) {
  const ids = [...new Set(exerciseIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["lift-analyses-by-result", clientId, ids.join(",")],
    enabled: enabled && !!clientId && ids.length > 0,
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<Record<string, VideoSpeed>> => {
      const { data, error } = await db
        .from("pl_set_video_analyses")
        .select("result_id, best_mcv, best_mcv_tier, velocity_loss_pct")
        .eq("client_id", clientId)
        .in("exercise_id", ids)
        .not("result_id", "is", null)
        .not("best_mcv", "is", null)
        .limit(1000);
      if (error) throw error;
      const out: Record<string, VideoSpeed> = {};
      for (const r of (data ?? []) as any[]) {
        out[r.result_id] = {
          v: Number(r.best_mcv),
          tier: r.best_mcv_tier === "measured" ? "measured" : "estimated",
          loss: r.velocity_loss_pct != null ? Number(r.velocity_loss_pct) : null,
        };
      }
      return out;
    },
  });
}
