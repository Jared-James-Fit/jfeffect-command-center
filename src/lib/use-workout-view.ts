import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/** How the workout logger shows a workout: every card in a list, or one exercise at a time full screen. */
export type WorkoutView = "list" | "story";

const db = supabase as any;
const isView = (v: unknown): v is WorkoutView => v === "list" || v === "story";
const cacheKey = (userId: string) => `jf-workout-view:${userId}`;
const dirtyKey = (userId: string) => `jf-workout-view-dirty:${userId}`;

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
    const { error } = await db
      .from("workout_view_prefs")
      .upsert({ user_id: userId, view, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
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
 */
export function useWorkoutView() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: workoutViewKey(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    placeholderData: () => readCache(userId) ?? undefined,
    queryFn: async (): Promise<WorkoutView> => {
      const { data: row, error } = await db.from("workout_view_prefs").select("view").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      const unsaved = ls(dirtyKey(userId!)) === "1";
      const view = resolveWorkoutView(isView(row?.view) ? row.view : null, readCache(userId), unsaved);
      if (unsaved) void saveToAccount(userId!, view);
      lsSet(cacheKey(userId!), view);
      return view;
    },
  });

  const setView = useCallback(
    (next: WorkoutView) => {
      if (!userId) return;
      lsSet(cacheKey(userId), next);
      lsSet(dirtyKey(userId), "1");
      qc.setQueryData(workoutViewKey(userId), next);
      void saveToAccount(userId, next);
    },
    [qc, userId],
  );

  return { view: isView(data) ? data : ("list" as WorkoutView), setView };
}
