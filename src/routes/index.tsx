import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { DashboardSplash } from "@/components/dashboard-splash";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { cachedLaunchHome, forgetSavedLastRoutes } from "@/lib/launch-home";
import { getViewMode } from "@/lib/view-mode";
import { supabase } from "@/integrations/supabase/client";
import { hasPersistedAuthSession } from "@/lib/session-hint";

export const Route = createFileRoute("/")({
  // First-time / signed-out visitors: skip "splash -> hydrate -> wait for auth ->
  // redirect" and go straight to sign-in. Runs in the browser only (the server
  // can't see localStorage); anyone with a saved session keeps the flow below,
  // which always opens their Home.
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

/**
 * App launch ("/", the installed app's start page): always the person's Home,
 * never the last screen they were on. When this device already knows the
 * account's role it goes there at once, so Home loads while sign-in finishes
 * (the signed-in area still checks the session and sends a stale one to
 * /auth); otherwise it waits for auth below.
 */
function IndexRedirect() {
  const { user, role, viewOnly, loading } = useAuth();
  const navigate = useNavigate();
  const { isImpersonating } = useClientImpersonation();
  const launched = useRef(false);

  useEffect(() => {
    forgetSavedLastRoutes();
    const home = cachedLaunchHome();
    if (!home || launched.current) return;
    launched.current = true;
    navigate({ to: home, replace: true });
  }, [navigate]);

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
    if (loading || !hydrated || launched.current) return;
    launched.current = true;
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
            if (data?.id) navigate({ to: "/portal" as any, replace: true });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            else navigate({ to: "/admin" as any, replace: true });
          });
          return;
        }
      }

      // Home for their role (never the last screen: a launch always starts fresh).
      const dest =
        role === "client" ? "/portal"
        : role === "member" ? "/portal"
        // The finance login starts at its desk, Taxes & Books (/finance redirects there).
        : viewOnly ? "/finance"
        : "/admin";
      navigate({ to: dest, replace: true });
    } else {
      navigate({ to: "/auth", replace: true });
    }
  }, [user, role, viewOnly, loading, navigate, isImpersonating, hydrated]);

  return <DashboardSplash />;
}
