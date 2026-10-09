import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { DashboardSplash } from "@/components/dashboard-splash";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { getLastRoute } from "@/lib/route-persistence";
import { getViewMode } from "@/lib/view-mode";
import { supabase } from "@/integrations/supabase/client";
import { hasPersistedAuthSession } from "@/lib/session-hint";

export const Route = createFileRoute("/")({
  // First-time / signed-out visitors: skip "splash -> hydrate -> wait for auth ->
  // redirect" and go straight to sign-in. Runs in the browser only (the server
  // can't see localStorage); anyone with a saved session keeps the full flow
  // below, including last-route restore and dual-account handling.
  beforeLoad: () => {
    if (typeof window !== "undefined" && !hasPersistedAuthSession()) {
      throw redirect({ to: "/auth", replace: true });
    }
  },
  head: () => ({
    meta: [
      { title: "JF Effect — Private Coaching & Training System" },
      { name: "description", content: "Structured training, nutrition, progress tracking, and private coaching for men who are done starting over." },
      { property: "og:title", content: "JF Effect — Private Coaching & Training System" },
      { property: "og:description", content: "Structured training, nutrition, progress tracking, and private coaching for men who are done starting over." },
    ],
  }),
  component: IndexRedirect,
});

function IndexRedirect() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const { isImpersonating } = useClientImpersonation();
  // Give the impersonation provider one tick to hydrate from sessionStorage
  // before we redirect — otherwise admins in active Client POV get bounced
  // to /admin on every cold launch / SW navigate-fallback that lands them
  // back at "/".
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHydrated(true), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (loading || !hydrated) return;
    if (user && role) {
      // Respect active Client POV: admins/coaches impersonating a client
      // must land in /portal, not their own admin dashboard.
      if (isImpersonating && (role === "admin" || role === "coach")) {
        navigate({ to: "/portal", replace: true });
        return;
      }

      // Dual-account users (client + staff role): honor their last
      // selected view (set by <DualAccountSwitcher />). They can flip
      // back from inside either dashboard at any time.
      const savedView = getViewMode(user.id);
      if (savedView && (role === "admin" || role === "coach")) {
        // Confirm a client record exists before honoring "client" — avoids
        // sending a staff-only user into /portal if localStorage was seeded
        // on another account on this device.
        if (savedView === "client") {
          void supabase.from("clients").select("id").eq("user_id", user.id).maybeSingle().then(({ data }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (data?.id) navigate({ to: "/portal/workouts" as any, replace: true });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            else navigate({ to: "/admin" as any, replace: true });
          });
          return;
        }
      }

      // Attempt to restore the user's last meaningful route (set by
      // RouteTracker on every navigation). Validate against the current role
      // so a user can never be sent into an area they're not permitted to
      // access, and so that switching accounts always lands at the correct
      // dashboard.
      if (user.id) {
        const saved = getLastRoute(user.id);
        if (saved) {
          const isPortal = saved.startsWith("/portal");
          const isMember = saved === "/m" || saved.startsWith("/m/");
          const isAdmin  = saved === "/admin" || saved.startsWith("/admin/");
          const isFinance = saved === "/finance" || saved.startsWith("/finance/");

          const roleMatch =
            (isPortal && (role === "client" || role === "admin" || role === "coach")) ||
            (isMember && (role === "member"  || role === "admin" || role === "coach")) ||
            (isAdmin  && (role === "admin"   || role === "coach")) ||
            (isFinance && role === "finance");

          if (roleMatch) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            navigate({ to: saved as any, replace: true });
            return;
          }
        }
      }

      const dest =
        role === "client" ? "/portal"
        : role === "member" ? "/m"
        // Finance is a staff-only login: the books, never the portal or /m.
        : role === "finance" ? "/finance"
        : "/admin";
      navigate({ to: dest, replace: true });
    } else {
      navigate({ to: "/auth", replace: true });
    }
  }, [user, role, loading, navigate, isImpersonating, hydrated]);

  return <DashboardSplash />;
}
