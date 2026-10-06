/**
 * React Query keys for the data the workout logger needs on first paint.
 *
 * ONE definition shared by WorkoutDayView (which reads them) and the route
 * loader / prefetch (which fills them before the page mounts). If these ever
 * differ, the prefetch silently stops helping — so don't inline them.
 */
type Kind = string | null | undefined;

export const plDayKey = (dayId: string, adapterKind: Kind, ownerId: string | null | undefined) =>
  ["pl-day", dayId, adapterKind ?? null, ownerId ?? null] as const;

export const plDayRowsKey = (dayId: string, adapterKind: Kind, ownerId: string | null | undefined) =>
  ["pl-day-rows", dayId, adapterKind ?? null, ownerId ?? null] as const;

export const plDayResultsKey = (
  dayId: string,
  clientId: string | null | undefined,
  adapterKind: Kind,
  ownerId: string | null | undefined,
  scheduledWorkoutId: string | null | undefined,
) => ["pl-day-results", dayId, clientId, adapterKind ?? null, ownerId ?? null, scheduledWorkoutId] as const;

/** The signed-in athlete's client row, as the workout route resolves it. */
export const portalRouteMyClientKey = (userId: string | null | undefined) =>
  ["portal-route-my-client", userId] as const;

/** How long each is treated as fresh — matches the logger's own queries. */
export const WORKOUT_STALE = { day: 5 * 60_000, rows: 5 * 60_000, results: 2 * 60_000, client: 2 * 60_000 } as const;
