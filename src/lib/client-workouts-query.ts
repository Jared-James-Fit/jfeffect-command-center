/**
 * A client's whole program (blocks → weeks → days → rows → logged sets), read
 * once and shared: the Workouts screen, Home's calendar, Nutrition's training-
 * day check, the cardio card and the grocery list all use this one query.
 *
 * It's the app's biggest read (a few hundred KB for a client with a few
 * blocks of history), so it must never be downloaded twice for one screen,
 * and it's kept for a day so the copy the app saves on the phone
 * (query-persister.ts, 24h) is still there on the next open: the page paints
 * at once from it and refreshes quietly behind.
 */
import { queryOptions } from "@tanstack/react-query";
import { getClientWorkouts } from "@/lib/pl-programs";
import { isAtHomeBackupClient, isAtHomeBackupSessionBlock } from "@/lib/at-home-backup";

/** As long as the copy saved on the phone (QUERY_PERSIST_MAX_AGE): a shorter gcTime drops it before it's saved. */
export const PAGE_CACHE_MS = 24 * 60 * 60_000;

/** Fresh enough to show without asking again; older, it's shown and refreshed behind. */
export const PAGE_FRESH_MS = 60_000;

export function clientWorkoutsQuery(clientId: string) {
  return queryOptions({
    queryKey: ["my-workouts", clientId] as const,
    queryFn: () => getClientWorkouts(clientId, { includeAtHomeBackupSessions: isAtHomeBackupClient(clientId) }) as Promise<any[]>,
    staleTime: PAGE_FRESH_MS,
    gcTime: PAGE_CACHE_MS,
  });
}

/** The gym program only: at-home backup sessions are extra history on the Workouts calendar, never a training day elsewhere. */
export function primaryWorkouts<T extends { block?: unknown }>(items: readonly T[] | null | undefined): T[] {
  return (items ?? []).filter((it) => !isAtHomeBackupSessionBlock(it.block as any));
}
