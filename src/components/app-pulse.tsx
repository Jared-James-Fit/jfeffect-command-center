import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Counts visits for the admin's Analytics (src/lib/app-pulse), and what a visit can't leave in a
 * record of its own: web vitals, script errors and failed requests (src/lib/bi/events.ts). Loaded a
 * beat after the app has painted, so it never costs the first screen anything. Renders nothing.
 *
 * A failed request is read from the app's own query and mutation caches (the loading system already
 * names each failure, lib/loading/load-state.ts): only the area (a query key's first part) and the
 * kind of failure, never its key's values or its message.
 */
export function AppPulse() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    let stop: (() => void) | null = null;
    let unsubQueries: (() => void) | null = null;
    let unsubMutations: (() => void) | null = null;
    let cancelled = false;
    const begin = () => {
      void Promise.all([import("@/lib/app-pulse/pulse-client"), import("@/lib/app-pulse/telemetry"), import("@/lib/loading/load-state")])
        .then(([{ startAppPulse }, { recordRequestFailure }, { loadErrorKind }]) => {
          if (cancelled) return;
          stop = startAppPulse((cb) =>
            router.subscribe("onResolved", () => cb(router.state.location.pathname)),
          );
          const online = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);
          unsubQueries = queryClient.getQueryCache().subscribe((ev: any) => {
            if (ev?.type !== "updated" || ev.action?.type !== "error") return;
            const key = ev.query?.queryKey;
            recordRequestFailure(Array.isArray(key) ? key[0] : key, loadErrorKind(ev.action.error, online()) as any);
          });
          unsubMutations = queryClient.getMutationCache().subscribe((ev: any) => {
            if (ev?.type !== "updated" || ev.action?.type !== "error") return;
            const key = ev.mutation?.options?.mutationKey;
            recordRequestFailure(Array.isArray(key) ? `save-${String(key[0])}` : "save", loadErrorKind(ev.action.error, online()) as any);
          });
        })
        .catch(() => null);
    };
    const w = window as any;
    const handle = typeof w.requestIdleCallback === "function"
      ? w.requestIdleCallback(begin, { timeout: 4000 })
      : window.setTimeout(begin, 1500);
    return () => {
      cancelled = true;
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      stop?.();
      unsubQueries?.();
      unsubMutations?.();
    };
  }, [router, queryClient]);
  return null;
}
