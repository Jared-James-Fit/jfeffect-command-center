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
import type { LoggedSet } from "@/lib/lift-analysis/verdict";
import { announceChanged, LIFT_ANALYSIS_CHANGED } from "@/lib/lift-analysis/store";

const db = supabase as any;

/** A read that found no plate on its own (status needs_tap) or couldn't open the video (failed). */
export type NotRead = {
  engine: string;
  status: "needs_tap" | "failed";
  why: string;
  suggestions?: { t: number; fx: number; fy: number; fr: number }[];
};

export type StoredAnalysis = {
  set_video_id: string;
  client_id: string;
  /** done: `result` is the read; needs_tap / failed: it's a NotRead (older rows have no status: done). */
  status?: "done" | "needs_tap" | "failed";
  result: LiftAnalysis;
  /** The average of every rep, when the server put it on the set (velocity_accepted). */
  set_mcv?: number | null;
  velocity_accepted?: boolean;
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
        // every column: an app newer than the database never asks for one it doesn't have yet
        .select("*")
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
      for (const key of [
        "lift-analyses",
        "lift-analyses-lv",
        "lift-analyses-by-result",
        "lift-analysis-set",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
    };
    window.addEventListener(LIFT_ANALYSIS_CHANGED, on);
    return () => window.removeEventListener(LIFT_ANALYSIS_CHANGED, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), qc]);
  return q;
}

/** The logged set a set video is on (its velocity, reps and load), or null before the set is logged. */
export function useSetForVideo(setVideoId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["lift-analysis-set", setVideoId],
    enabled: enabled && !!setVideoId,
    staleTime: 30_000,
    queryFn: async (): Promise<LoggedSet | null> => {
      const { data: sv, error } = await db
        .from("pl_set_videos")
        .select("result_id")
        .eq("id", setVideoId)
        .maybeSingle();
      if (error) throw error;
      if (!sv?.result_id) return null;
      // every column: an app newer than the database never asks for one it doesn't have yet
      const { data: r, error: e2 } = await db
        .from("pl_row_results")
        .select("*")
        .eq("id", sv.result_id)
        .maybeSingle();
      if (e2) throw e2;
      return (r as LoggedSet | null) ?? null;
    },
  });
}

export async function saveAnalysis(setVideoId: string, analysis: LiftAnalysis): Promise<void> {
  const { error } = await db.rpc("set_video_analysis_save", {
    _set_video_id: setVideoId,
    _result: analysis,
  });
  if (error) throw error;
  announceChanged(setVideoId);
}

/** Keep that this video was tried and how it went, so it isn't read again by itself. */
export async function saveNotRead(setVideoId: string, notRead: NotRead): Promise<void> {
  const { error } = await db.rpc("set_video_analysis_save", {
    _set_video_id: setVideoId,
    _result: notRead,
  });
  if (error) throw error;
  announceChanged(setVideoId);
}

/** A stored row that holds a read (not a "needs a tap" / "couldn't read" note). */
export function isRead(a: StoredAnalysis | null | undefined): a is StoredAnalysis {
  return !!a && (a.status ?? "done") === "done" && Array.isArray((a.result as any)?.reps);
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

export type VideoSpeed = { v: number; reps: number };

/**
 * The bar speeds set videos put on their sets (the average of every rep,
 * accepted by the server's rule: set_video_analysis_save), by logged set
 * (pl_row_results.id): what an exercise's History marks "video".
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
        .select("result_id, set_mcv, reps")
        .eq("client_id", clientId)
        .in("exercise_id", ids)
        .eq("velocity_accepted", true)
        .not("result_id", "is", null)
        .not("set_mcv", "is", null)
        .limit(1000);
      if (error) throw error;
      const out: Record<string, VideoSpeed> = {};
      for (const r of (data ?? []) as any[])
        out[r.result_id] = { v: Number(r.set_mcv), reps: Number(r.reps) };
      return out;
    },
  });
}
