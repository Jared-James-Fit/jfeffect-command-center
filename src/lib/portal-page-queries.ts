/**
 * The first reads of the client's Workouts and Nutrition pages, in one place
 * so the pages and the warm-up (`useWarmClientPages`) share them exactly (same
 * keys, same loaders): a page opened after the warm-up paints from the cache.
 * Each is kept for a day (`PAGE_CACHE_MS`) so the copy saved on the phone is
 * still there on the next open.
 */
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCoachAssignedMealPlan } from "@/lib/nutrition-targets/member-targets.functions";
import { clientWorkoutsQuery, PAGE_CACHE_MS, PAGE_FRESH_MS } from "@/lib/client-workouts-query";

/** Workouts: the signed-in person's client row (its id opens the program). */
export function portalWorkoutsClientQuery(portalUserId: string) {
  return queryOptions({
    queryKey: ["portal-workouts-client", portalUserId] as const,
    queryFn: async () =>
      ((await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId).maybeSingle()).data ?? null) as
        | { id: string; full_name: string | null }
        | null,
    staleTime: PAGE_FRESH_MS,
    gcTime: PAGE_CACHE_MS,
  });
}

export type NutritionCtx = {
  goals: string[];
  clientId: string | null;
  preferredHighDays: string[] | null;
  committedTrainingDays: string[] | null;
};

/** Nutrition: the client row's id and the schedule it reads the day's plan from. */
export function portalNutritionCtxQuery(portalUserId: string) {
  return queryOptions({
    queryKey: ["portal-nutrition-ctx", portalUserId] as const,
    queryFn: async (): Promise<NutritionCtx> => {
      try {
        const { data } = await (supabase as any)
          .from("clients")
          .select("id, goals, preferred_high_days, committed_training_days")
          .eq("user_id", portalUserId)
          .maybeSingle();
        return {
          goals: data?.goals ? [String(data.goals)] : [],
          clientId: (data?.id as string | undefined) ?? null,
          preferredHighDays: (data?.preferred_high_days as string[] | null) ?? null,
          committedTrainingDays: (data?.committed_training_days as string[] | null) ?? null,
        };
      } catch (e) {
        console.error("[portal-nutrition] ctx query failed", e);
        return { goals: [], clientId: null, preferredHighDays: null, committedTrainingDays: null };
      }
    },
    retry: false,
    staleTime: PAGE_FRESH_MS,
    gcTime: PAGE_CACHE_MS,
  });
}

type MealPlanFetcher = (args: { data: { viewAsUserId?: string } }) => Promise<unknown>;

/** Nutrition: the coach's plan (targets + meal plan), as the client sees it (or as a coach previewing them). */
export function coachMealPlanQuery(portalUserId: string, viewAsUserId: string | null, fetcher: MealPlanFetcher = getCoachAssignedMealPlan as any) {
  return queryOptions({
    queryKey: ["portal-coach-meal-plan", portalUserId, viewAsUserId] as const,
    queryFn: () => fetcher({ data: viewAsUserId ? { viewAsUserId } : {} }),
    staleTime: PAGE_FRESH_MS,
    gcTime: PAGE_CACHE_MS,
    retry: false,
  });
}

/** How long after the app opens to warm the pages: after the first screen has painted, before a tap is likely. */
export const WARM_DELAY_MS = 1500;

/** Warmed copies younger than this are left alone (a page refreshes them itself when it opens). */
export const WARM_FRESH_MS = 10 * 60_000;

/**
 * Once the app has opened and painted, fetch what Workouts and Nutrition open
 * with, in the background, so the first tap on either shows the page at once.
 * The coach's plan only for coaching clients (a member's Nutrition is their own
 * calculator); never while previewing as a client; only what isn't already fresh.
 */
export function useWarmClientPages(opts: { portalUserId: string | null | undefined; enabled: boolean; nutrition: boolean }) {
  const qc = useQueryClient();
  const { portalUserId, enabled, nutrition } = opts;
  useEffect(() => {
    if (!enabled || !portalUserId || typeof window === "undefined") return;
    let cancelled = false;
    const warm = async () => {
      if (cancelled) return;
      try {
        const [client] = await Promise.all([
          qc.fetchQuery({ ...portalWorkoutsClientQuery(portalUserId), staleTime: WARM_FRESH_MS }),
          nutrition ? qc.prefetchQuery({ ...portalNutritionCtxQuery(portalUserId), staleTime: WARM_FRESH_MS }) : null,
          nutrition ? qc.prefetchQuery({ ...coachMealPlanQuery(portalUserId, null), staleTime: WARM_FRESH_MS }) : null,
        ]);
        if (cancelled || !client?.id) return;
        await qc.prefetchQuery({ ...clientWorkoutsQuery(client.id), staleTime: WARM_FRESH_MS });
      } catch {
        // best effort: the page loads it itself when opened
      }
    };
    const idle = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined;
    let handle: number | null = null;
    const timer = window.setTimeout(() => {
      handle = idle ? idle(() => void warm(), { timeout: 3000 }) : window.setTimeout(() => void warm(), 0);
    }, WARM_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (handle != null) {
        const cancelIdle = (window as any).cancelIdleCallback as ((h: number) => void) | undefined;
        if (idle && cancelIdle) cancelIdle(handle);
        else window.clearTimeout(handle);
      }
    };
  }, [enabled, portalUserId, nutrition, qc]);
}
