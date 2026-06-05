import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { pingClientActivity } from "@/lib/activity";

/** Mounted inside the authenticated portal. Pings the server with the current
 *  route on mount, on every route change, and every 3 minutes while the tab is
 *  visible. Server-side throttled to once per 60s. */
export function useActivityHeartbeat() {
  const { user, role } = useAuth();
  const router = useRouter();
  const enabled = !!user && role === "client";
  const lastRouteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const ping = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const route = router.state.location.pathname;
      lastRouteRef.current = route;
      void pingClientActivity(route);
    };

    // Initial ping
    ping();

    // Route change → ping
    const unsub = router.subscribe("onResolved", () => {
      const route = router.state.location.pathname;
      if (route !== lastRouteRef.current) ping();
    });

    // Heartbeat every 3 minutes
    const interval = window.setInterval(ping, 3 * 60 * 1000);

    // Ping on tab becoming visible again
    const onVis = () => { if (document.visibilityState === "visible") ping(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      unsub();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, router]);
}