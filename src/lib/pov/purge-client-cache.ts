import type { QueryClient } from "@tanstack/react-query";

/**
 * Forget everything this device has loaded about an account the signed-in staff member can no
 * longer reach (a client reassigned or removed from them, a view revoked): every query whose key
 * names the client's id or login id leaves the cache, and with it the copy saved on the device
 * (the persister writes the cache as it changes). Returns how many were removed.
 */
export function purgeClientData(qc: QueryClient, ids: ReadonlyArray<string | null | undefined>): number {
  const needles = ids.filter((x): x is string => !!x && x.length >= 8);
  if (!needles.length) return 0;
  let removed = 0;
  qc.removeQueries({
    predicate: (q) => {
      let key: string;
      try {
        key = JSON.stringify(q.queryKey);
      } catch {
        return false;
      }
      const hit = needles.some((id) => key.includes(id));
      if (hit) removed++;
      return hit;
    },
  });
  return removed;
}

/** The ids that were reachable before and aren't now. */
export function lostAccess(before: ReadonlyArray<string>, now: ReadonlyArray<string>): string[] {
  const still = new Set(now);
  return before.filter((id) => !still.has(id));
}
