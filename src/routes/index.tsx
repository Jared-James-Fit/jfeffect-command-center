import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { DashboardSplash } from "@/components/dashboard-splash";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { CLIENT_VIEW_HOME, cachedLaunchTarget, launchTarget } from "@/lib/launch-home";
import { getViewMode } from "@/lib/view-mode";
import { supabase } from "@/integrations/supabase/client";
import { hasPersistedAuthSession } from "@/lib/session-hint";
import { shareMeta } from "@/lib/share-meta";
import { LandingPage } from "@/components/landing/landing-page";
import { currentLaunchMode, installedApp } from "@/lib/landing-launch";

const DESCRIPTION =
  "A free training app and crew built by Team Canada powerlifter Jared McIntyre: coach-written programs, a log that tracks every set and PR, progress, nutrition and a community that keeps you honest.";

export const Route = createFileRoute("/")({
  // The installed app, signed out: straight to sign-in (it never shows the
  // landing page). Everyone else signed out gets jfeffect.com's front door;
  // anyone with a saved session keeps the launch flow below, which opens Crew
  // (or the workout they were in the middle of). landing-launch.ts.
  beforeLoad: () => {
    if (typeof window !== "undefined" && !hasPersistedAuthSession() && installedApp()) {
      throw redirect({ to: "/auth", replace: true });
    }
  },
  head: () => ({
    meta: [
      { title: "JF Effect | Free Training App, Programs & Crew" },
      { name: "description", content: DESCRIPTION },
      ...shareMeta({ title: "JF Effect", description: "Programs, a training log and a crew to train with. Free to join.", path: "/" }),
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/" }],
  }),
  component: IndexPage,
});

/**
 * The server renders both the landing page and the launch splash; a head
 * script (LAUNCH_BOOT_SCRIPT, __root.tsx) has already shown the right one
 * before the first paint, so this only starts the launch for the app.
 */
function IndexPage() {
  const [mode, setMode] = useState<"unknown" | "app" | "landing">("unknown");
  useEffect(() => {
    const m = currentLaunchMode();
    // a client-side visit to "/" never ran the head script
    if (m === "app") document.documentElement.setAttribute("data-launch", "app");
    else document.documentElement.removeAttribute("data-launch");
    setMode(m);
  }, []);
  return (
    <>
      {mode !== "app" && (
        <div data-landing>
          <LandingPage />
        </div>
      )}
      <div data-launch-splash>{mode === "app" ? <IndexRedirect /> : <DashboardSplash />}</div>
    </>
  );
}

/**
 * App launch ("/", the installed app's start page): a fresh launch opens Crew,
 * or the workout they were in the middle of (launch-home.ts). Switching apps
 * never comes through here. When this device already knows the account's role
 * it goes there at once, so the page loads while sign-in finishes (the
 * signed-in area still checks the session and sends a stale one to /auth);
 * otherwise it waits for auth below.
 */
function IndexRedirect() {
  const { user, role, viewOnly, loading } = useAuth();
  const navigate = useNavigate();
  const { isImpersonating } = useClientImpersonation();
  const launched = useRef(false);

  useEffect(() => {
    const target = cachedLaunchTarget();
    if (!target || launched.current) return;
    launched.current = true;
    navigate({ href: target, replace: true });
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
      // land where the client's app opens (Crew), not their own dashboard.
      if (isImpersonating && (role === "admin" || role === "coach")) {
        navigate({ to: CLIENT_VIEW_HOME, replace: true });
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
            // their client side's Crew (or the workout they were logging)
            if (data?.id) navigate({ href: launchTarget(user.id, role, "client"), replace: true });
            else navigate({ href: launchTarget(user.id, role), replace: true });
          });
          return;
        }
      }

      // Crew (or the workout they were in the middle of). The finance login
      // starts at its desk, Taxes & Books (/finance redirects there).
      navigate({ href: viewOnly ? "/finance" : launchTarget(user.id, role), replace: true });
    } else {
      navigate({ to: "/auth", replace: true });
    }
  }, [user, role, viewOnly, loading, navigate, isImpersonating, hydrated]);

  return <DashboardSplash />;
}
