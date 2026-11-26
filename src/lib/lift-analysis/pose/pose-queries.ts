/**
 * The body's read the server stored for a set video (pl_set_video_poses,
 * written only by the server's reader; read with the viewer's own login, so
 * whoever may see the set video sees its body). Technique opens on it instead
 * of reading the clip on the phone (pose-pack.ts `storedPoseCovers`).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PoseWindow } from "@/lib/lift-analysis/pose/pose-pack";

export type StoredPose = {
  status: "queued" | "running" | "done" | "no_body" | "failed" | "cancelled";
  window: PoseWindow | null;
  track: unknown;
  engine: string | null;
  updated_at: string;
};

export const storedPoseKey = (setVideoId: string | null | undefined) => [
  "lift-analysis-pose",
  setVideoId ?? "",
];

export function useStoredPose(setVideoId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: storedPoseKey(setVideoId),
    enabled: !!setVideoId && enabled,
    // asked again every time Technique opens (the server may have read it since), and every 15 s while
    // the server is still reading, so a read that lands mid-way takes over from the phone's
    staleTime: 0,
    refetchInterval: (q) => {
      const s = (q.state.data as StoredPose | null | undefined)?.status;
      return s === "queued" || s === "running" ? 15_000 : false;
    },
    queryFn: async (): Promise<StoredPose | null> => {
      const { data, error } = await (supabase.from as any)("pl_set_video_poses")
        .select(
          "status, window_start, window_end, window_whole, clip_seconds, track, engine, updated_at",
        )
        .eq("set_video_id", setVideoId)
        .maybeSingle();
      if (error) {
        // a database without the table yet reads as nothing stored (Technique reads on the device as before)
        if (/pl_set_video_poses|does not exist|schema cache/i.test(String(error.message ?? "")))
          return null;
        throw error;
      }
      if (!data) return null;
      const w =
        data.window_start != null && data.window_end != null
          ? {
              start: Number(data.window_start),
              end: Number(data.window_end),
              whole: !!data.window_whole,
              duration: data.clip_seconds != null ? Number(data.clip_seconds) : null,
            }
          : null;
      return {
        status: data.status,
        window: w,
        track: data.track,
        engine: data.engine,
        updated_at: data.updated_at,
      };
    },
  });
}
