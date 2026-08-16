/**
 * Centralized TanStack Query keys for the ONE grocery list system.
 *
 * The list is derived from: the client's canonical nutrition plan, their
 * resolved week (scheduled workouts + high-day config/overrides) and the
 * requested week start. Any mutation that changes one of those inputs should
 * call `invalidateGroceryList` so client and coach preview stay identical.
 */
import type { QueryClient } from "@tanstack/react-query";

export const GROCERY_ROOT = "grocery-list" as const;

export function groceryListKey(clientId: string | null | undefined, weekStartISO: string) {
  return [GROCERY_ROOT, clientId ?? "self", weekStartISO] as const;
}

/** Invalidate every grocery derivation (optionally only for one client). */
export function invalidateGroceryList(qc: QueryClient, clientId?: string | null) {
  return qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey as unknown[];
      if (k[0] !== GROCERY_ROOT) return false;
      if (!clientId) return true;
      return k[1] === clientId || k[1] === "self";
    },
  });
}
