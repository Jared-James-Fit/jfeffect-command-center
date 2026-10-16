import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/** How the workout logger shows a workout: every card in a list, or one exercise at a time full screen ("story" = Focus). */
export type WorkoutView = "list" | "story";

type Saved = { view: WorkoutView; tried: boolean; tipsSeen: boolean };

const db = supabase as any;
const isView = (v: unknown): v is WorkoutView => v === "list" || v === "story";
const cacheKey = (userId: string) => `jf-workout-view:${userId}`;
const dirtyKey = (userId: string) => `jf-workout-view-dirty:${userId}`;
const triedKey = (userId: string) => `jf-workout-view-tried:${userId}`;
const tipsKey = (userId: string) => `jf-focus-tips:${userId}`;

function ls(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
}
const readCache = (userId: string | null): WorkoutView | null => {
  if (!userId) return null;
  const v = ls(cacheKey(userId));
  return isView(v) ? v : null;
};

export const workoutViewKey = (userId: string | null) => ["workout-view", userId] as const;

/**
 * Which view to use: a switch this phone hasn't saved to the account yet wins
 * (made offline at the gym), then the account's choice, then this phone's copy,
 * then the list (the default).
 */
export function resolveWorkoutView(account: WorkoutView | null, device: WorkoutView | null, unsaved: boolean): WorkoutView {
  if (unsaved && device) return device;
  return account ?? device ?? "list";
}

async function saveToAccount(userId: string, view: WorkoutView, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    // workout_view_set also stamps the first time they used the switch (tried_at)
    const { error } = await db.rpc("workout_view_set", { _view: view });
    if (!error) {
      // a newer switch may have happened while this one was saving
      if (readCache(userId) === view) lsSet(dirtyKey(userId), null);
      return true;
    }
    await new Promise((r) => setTimeout(r, 700 * 2 ** i));
  }
  return false; // stays unsaved: pushed the next time a workout opens
}

/**
 * The signed-in person's workout view, saved on their account every time they
 * switch (workout_view_prefs) so every workout and every phone opens the same
 * way. A per-phone copy paints the right view instantly while the account loads.
 * `tried`: they've used the List / Focus switch at least once (the Focus intro
 * stops then); `known` is false until the account has answered, so the intro
 * never shows to someone who already tried on another phone.
 */
export function useWorkoutView() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const { data, isPlaceholderData, isFetched } = useQuery({
    queryKey: workoutViewKey(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    placeholderData: (): Saved | undefined => {
      const view = readCache(userId);
      return view ? { view, tried: !!userId && ls(triedKey(userId)) === "1", tipsSeen: !!userId && ls(tipsKey(userId)) === "1" } : undefined;
    },
    queryFn: async (): Promise<Saved> => {
      const { data: row, error } = await db.from("workout_view_prefs").select("view, tried_at, focus_tips_at").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      const unsaved = ls(dirtyKey(userId!)) === "1";
      const view = resolveWorkoutView(isView(row?.view) ? row.view : null, readCache(userId), unsaved);
      if (unsaved) void saveToAccount(userId!, view);
      lsSet(cacheKey(userId!), view);
      const tried = !!row?.tried_at || ls(triedKey(userId!)) === "1";
      if (tried) lsSet(triedKey(userId!), "1");
      const tipsSeen = !!row?.focus_tips_at || ls(tipsKey(userId!)) === "1";
      if (tipsSeen) lsSet(tipsKey(userId!), "1");
      return { view, tried, tipsSeen };
    },
  });

  const setView = useCallback(
    (next: WorkoutView) => {
      if (!userId) return;
      lsSet(cacheKey(userId), next);
      lsSet(dirtyKey(userId), "1");
      lsSet(triedKey(userId), "1");
      qc.setQueryData(workoutViewKey(userId), (old: Saved | undefined) => ({ view: next, tried: true, tipsSeen: !!old?.tipsSeen }) satisfies Saved);
      void saveToAccount(userId, next);
    },
    [qc, userId],
  );

  /** Focus's tips were seen ("Got it"): they don't open by themselves again, on any phone. */
  const markTipsSeen = useCallback(() => {
    if (!userId) return;
    lsSet(tipsKey(userId), "1");
    qc.setQueryData(workoutViewKey(userId), (old: Saved | undefined) => (old ? { ...old, tipsSeen: true } : old));
    void db.rpc("workout_view_tips_seen").then(() => {}, () => {});
  }, [qc, userId]);

  /** The Focus intro was shown / closed with "Not now" (counts only; never changes the view). */
  const noteIntro = useCallback((event: "shown" | "dismissed") => {
    if (!userId) return;
    void db.rpc("workout_view_intro", { _event: event }).then(() => {}, () => {});
  }, [userId]);

  return {
    view: isView(data?.view) ? data!.view : ("list" as WorkoutView),
    tried: !!data?.tried,
    tipsSeen: !!data?.tipsSeen,
    known: isFetched && !isPlaceholderData,
    setView,
    noteIntro,
    markTipsSeen,
  };
}
