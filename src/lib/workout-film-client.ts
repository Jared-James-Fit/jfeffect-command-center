/**
 * A finished workout's film, in the app: how many sets are on film, whether
 * some are still uploading, whether the film is in the feed, the athlete's
 * "post my film automatically" switch, and posting it (now, or by itself once
 * the clips have landed). The server builds the post (workout-film.functions.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useViewingAsClient } from "@/lib/client-impersonation";
import { isActiveJob, useSetVideoJobs } from "@/lib/set-videos/jobs";
import { useSetVideosForDay } from "@/components/workout-day/set-video-cell";
import { invalidateCommunity, useMyPostForCompletion } from "@/lib/community.queries";
import { filmPaths, filmUpToDate, pickFilmClips } from "@/lib/workout-film";
import { postWorkoutFilmFn, type FilmPostResult } from "@/lib/workout-film.functions";

const db = supabase as any;
const AUTO_KEY = ["community-film-auto"] as const;

/** Their switch: a finished workout's film posts to Crew by itself (on unless they turn it off). */
export function useFilmAutoPost(enabled = true) {
  const viewingAsClient = useViewingAsClient();
  const { data } = useQuery({
    queryKey: AUTO_KEY,
    enabled: enabled && !viewingAsClient,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data: on, error } = await db.rpc("community_auto_post_film");
      if (error) throw error;
      return on !== false;
    },
  });
  return data;
}

export function useSetFilmAutoPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await db.rpc("community_set_auto_post_film", { _on: on });
      if (error) throw error;
    },
    onMutate: (on) => qc.setQueryData(AUTO_KEY, on),
    onSettled: () => qc.invalidateQueries({ queryKey: AUTO_KEY }),
  });
}

/** Posts already asked for in this app open (one automatic try per film state, whichever screen asks). */
const autoTried = new Set<string>();
const inFlight = new Map<string, Promise<FilmPostResult>>();

export type WorkoutFilmState = {
  /** Sets with a clip on them (sent). */
  clips: number;
  /** Clips still on their way. */
  uploading: number;
  /** The clips that fit a workout post (90 s, 50 MB, ten). */
  postable: number;
  posted: boolean;
  /** In the feed, but a clip that landed since isn't on it yet. */
  behind: boolean;
  /** They took the session's post out of Crew. */
  hidden: boolean;
  postId: string | null;
  posterPaths: string[];
};

/**
 * One finished workout's film. `auto` (default on): once every clip has
 * landed, posts it by itself when their switch is on; never for a coach
 * viewing as the athlete.
 */
export function useWorkoutFilm(completionId: string | null | undefined, dayId: string | null | undefined, opts: { auto?: boolean } = {}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const viewingAsClient = useViewingAsClient();
  const on = !!completionId && !!dayId && !!userId && !viewingAsClient;
  const qc = useQueryClient();
  const { data: videos } = useSetVideosForDay(dayId ?? "", on);
  const jobs = useSetVideoJobs();
  const { data: post } = useMyPostForCompletion(completionId, on);
  const autoOn = useFilmAutoPost(on);
  const post$ = useServerFn(postWorkoutFilmFn);

  const state = useMemo<WorkoutFilmState>(() => {
    const sent = (videos ?? []).filter((v) => !!v.result_id && (!userId || v.uploaded_by === userId));
    const uploading = jobs.filter((j) => j.dayId === dayId && isActiveJob(j)).length;
    const { picked } = pickFilmClips(
      sent.map((v) => ({ ...v, order: 0, size_bytes: v.size_bytes, duration_s: v.duration_s == null ? null : Number(v.duration_s) })),
    );
    const wanted = completionId && userId ? picked.map((v) => filmPaths(userId, completionId, v.id, v.storage_path).path) : [];
    const crew = post?.visibility === "community" || post?.visibility === "followers" || post?.visibility === "close_friends";
    const filmOn = !!post && !post.auto_shared && crew && (post.film?.length ?? 0) > 0;
    return {
      clips: sent.length,
      uploading,
      postable: picked.length,
      posted: filmOn,
      behind: filmOn && !filmUpToDate(post?.film, wanted),
      hidden: !!post && !post.auto_shared && !crew,
      postId: post?.id ?? null,
      posterPaths: sent.map((v) => v.thumbnail_path).filter((p): p is string => !!p).slice(0, 3),
    };
  }, [videos, jobs, post, dayId, completionId, userId]);

  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post_ = useCallback(
    async (auto: boolean): Promise<FilmPostResult | null> => {
      if (!on || !completionId) return null;
      const key = `${completionId}:${auto ? "auto" : "now"}`;
      let p = inFlight.get(key);
      if (!p) {
        p = post$({ data: { completionId, auto } });
        inFlight.set(key, p);
      }
      setPosting(true);
      setError(null);
      try {
        const res = await p;
        if (res.status === "posted") {
          invalidateCommunity(qc);
          await qc.invalidateQueries({ queryKey: ["community-my-post", completionId] });
        }
        return res;
      } catch (e: any) {
        setError(e?.message ?? "Couldn't post your film. Try again.");
        return null;
      } finally {
        inFlight.delete(key);
        setPosting(false);
      }
    },
    [on, completionId, post$, qc],
  );

  // By itself: every clip landed, the switch is on, it isn't in the feed (or a clip is missing from it).
  const wantAuto = opts.auto !== false;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!on || !wantAuto || autoOn !== true) return;
    if (state.uploading > 0 || state.postable === 0 || state.hidden) return;
    if (state.posted && !state.behind) return;
    const key = `${completionId}:${state.postable}:${state.posted ? "update" : "new"}`;
    if (autoTried.has(key) || lastKey.current === key) return;
    autoTried.add(key);
    lastKey.current = key;
    void post_(true);
  }, [on, wantAuto, autoOn, state, completionId, post_]);

  return { ...state, autoOn, posting, error, postNow: () => post_(false) };
}
