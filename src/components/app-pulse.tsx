import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

/**
 * Counts visits for the admin's App & website page (src/lib/app-pulse). Loaded a beat after the
 * app has painted, so it never costs the first screen anything. Renders nothing.
 */
export function AppPulse() {
  const router = useRouter();
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    const begin = () => {
      void import("@/lib/app-pulse/pulse-client")
        .then(({ startAppPulse }) => {
          if (cancelled) return;
          stop = startAppPulse((cb) =>
            router.subscribe("onResolved", () => cb(router.state.location.pathname)),
          );
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
    };
  }, [router]);
  return null;
}
