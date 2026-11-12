/**
 * The set video point-out: when a coaching client logs their first set of a
 * workout, a small bubble points at that set's camera ("Film your sets for
 * Jared"), so they find out a set can be filmed and sent to their coach.
 *
 * It shows at most once a day (on any phone), at most SET_VIDEO_TIP_MAX
 * days, never once they've sent a set video, never to a coach viewing as the
 * client, and one bubble per app open. The count lives on the account
 * (`workout_view_prefs.set_video_tip_*`), never the phone.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useViewingAsClient } from "@/lib/client-impersonation";

/** Shown on this many workout days at most, then it stops by itself. */
export const SET_VIDEO_TIP_MAX = 3;
/** At most once in this long (one a training day, on any phone). */
export const SET_VIDEO_TIP_GAP_MS = 18 * 60 * 60 * 1000;

export type SetVideoTipState = {
  count: number;
  lastAt: string | null;
  /** They've sent a set video before (the point-out has done its job). */
  hasSent: boolean;
  /** The coach's first name, for "Film your sets for Jared". */
  coachFirst: string | null;
};

/** Pure: whether the point-out may show now. */
export function setVideoTipDue(state: SetVideoTipState | null | undefined, now = Date.now()): boolean {
  if (!state) return false;
  if (state.hasSent) return false;
  if (state.count >= SET_VIDEO_TIP_MAX) return false;
  const last = state.lastAt ? Date.parse(state.lastAt) : Number.NaN;
  if (Number.isFinite(last) && now - last < SET_VIDEO_TIP_GAP_MS) return false;
  return true;
}

/** The bubble's words, named for the coach when we know them. */
export function setVideoTipCopy(coachFirst: string | null | undefined) {
  const coach = coachFirst?.trim() || null;
  return {
    title: coach ? `Film your sets for ${coach}` : "Film your sets for your coach",
    body: `Tap the camera to film this set or pick a clip. ${coach ?? "Your coach"} gets it in your chat with the weight, reps and RPE, so they can check your form.`,
  };
}

let claimed = false;
/** One bubble per app open, whichever set gets there first. */
export function claimSetVideoTip(): boolean {
  if (claimed) return false;
  claimed = true;
  return true;
}
/** Hand the claim back (it didn't end up showing). */
export function releaseSetVideoTip() {
  claimed = false;
}

const db = supabase as any;
export const setVideoTipKey = (userId: string | null, clientId: string | null | undefined) =>
  ["set-video-tip", userId, clientId ?? null] as const;

/**
 * The signed-in client's point-out state. Off for a coach viewing as the
 * client (it's the client's account) and until the logger can add a video.
 * A read that fails (no connection, the column not there yet) means no bubble.
 */
export function useSetVideoTip(clientId: string | null | undefined, enabled: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const viewingAsClient = useViewingAsClient();
  const qc = useQueryClient();
  const on = enabled && !viewingAsClient && !!userId && !!clientId;
  const { data } = useQuery({
    queryKey: setVideoTipKey(userId, clientId),
    enabled: on,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<SetVideoTipState | null> => {
      const [prefs, sent, client] = await Promise.all([
        db.from("workout_view_prefs").select("set_video_tip_count, set_video_tip_last_at").eq("user_id", userId).maybeSingle(),
        db.from("pl_set_videos").select("id").eq("client_id", clientId).limit(1),
        db.from("clients").select("assigned_coach_id").eq("id", clientId).maybeSingle(),
      ]);
      if (prefs.error || sent.error) return null;
      let coachFirst: string | null = null;
      const coachId = client.data?.assigned_coach_id ?? null;
      if (coachId) {
        const { data: coach } = await db.from("coaches").select("full_name").eq("id", coachId).maybeSingle();
        coachFirst = (coach?.full_name ?? "").trim().split(/\s+/)[0] || null;
      }
      return {
        count: Number(prefs.data?.set_video_tip_count ?? 0),
        lastAt: prefs.data?.set_video_tip_last_at ?? null,
        hasSent: (sent.data ?? []).length > 0,
        coachFirst,
      };
    },
  });

  /** It was on screen: counted on the account so another phone doesn't show it again today. */
  const markShown = useCallback(() => {
    if (!on) return;
    qc.setQueryData(setVideoTipKey(userId, clientId), (old: SetVideoTipState | null | undefined) =>
      old ? { ...old, count: old.count + 1, lastAt: new Date().toISOString() } : old,
    );
    void db.rpc("workout_view_set_video_tip_shown").then(() => {}, () => {});
  }, [on, qc, userId, clientId]);

  return {
    due: on && setVideoTipDue(data),
    coachFirst: data?.coachFirst ?? null,
    markShown,
  };
}
