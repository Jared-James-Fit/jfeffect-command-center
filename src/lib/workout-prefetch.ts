import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createClientAdapter } from "@/lib/workout-context/client-adapter";
import { writePlanCache } from "@/lib/workout-plan-cache";
import { plDayKey, plDayResultsKey, plDayRowsKey, portalRouteMyClientKey, WORKOUT_STALE } from "@/lib/workout-query-keys";

/**
 * Start loading a workout BEFORE its page mounts.
 *
 * Runs from the route loader, which TanStack Router fires on hover/touch-start
 * (preload "intent") and again on navigation — so the day, its exercises and
 * the athlete's logged sets are usually already in the cache (or in flight, and
 * de-duplicated) by the time the logger asks for them. Without this, nothing
 * was requested until after the page and its JS had loaded, then every query
 * waited on the one before it.
 *
 * Own-account only: when a coach is viewing "as" a client the logger builds its
 * own adapter, so the prefetch is simply a harmless no-op for them.
 * Never throws — it's an optimisation, the logger fetches normally if it fails.
 */
export async function prefetchWorkoutOpen(
  queryClient: QueryClient,
  opts: { dayId: string; instanceId?: string | null },
): Promise<void> {
  if (typeof window === "undefined") return; // SSR: no session, nothing to warm
  try {
    const { dayId } = opts;
    const instanceId = opts.instanceId ?? null;
    const { data: sessionData } = await supabase.auth.getSession(); // local read, no network
    const userId = sessionData.session?.user?.id;
    if (!userId) return;

    const client = await queryClient.ensureQueryData({
      queryKey: portalRouteMyClientKey(userId),
      staleTime: WORKOUT_STALE.client,
      queryFn: async () =>
        (await supabase.from("clients").select("id, user_id").eq("user_id", userId).maybeSingle()).data,
    });
    const clientId = (client as { id?: string } | null)?.id;
    if (!clientId) return;

    const adapter = createClientAdapter({ kind: "client", userId, ownerId: clientId, scheduledWorkoutId: instanceId });
    const scope = `portal:${dayId}`;

    const [, rows] = await Promise.all([
      queryClient.prefetchQuery({
        queryKey: plDayKey(dayId, "client", clientId),
        staleTime: WORKOUT_STALE.day,
        queryFn: async () => {
          const d = await adapter.getDayRaw(dayId);
          if (d) writePlanCache(scope, "day", d);
          return d;
        },
      }),
      queryClient.fetchQuery({
        queryKey: plDayRowsKey(dayId, "client", clientId),
        staleTime: WORKOUT_STALE.rows,
        queryFn: async () => {
          const r = await adapter.listRowsRaw(dayId);
          writePlanCache(scope, "rows", r);
          return r;
        },
      }),
    ]);

    // Logged sets need the row ids, so they follow the rows (still ahead of the page).
    const rowIds = (rows as Array<{ id: string }>).map((r) => r.id);
    if (!rowIds.length) return;
    await queryClient.prefetchQuery({
      queryKey: plDayResultsKey(dayId, clientId, "client", clientId, instanceId),
      staleTime: WORKOUT_STALE.results,
      queryFn: async () => {
        const r = await adapter.listRowResultsRaw(dayId, rowIds);
        writePlanCache(scope, `results:${clientId}`, r);
        return r;
      },
    });
  } catch {
    /* optimisation only */
  }
}
