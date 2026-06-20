import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { DashboardSplash } from "@/components/dashboard-splash";
import { useClientImpersonation } from "@/lib/client-impersonation";

export const Route = createFileRoute("/")({
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
      const dest =
        role === "client" ? "/portal"
        : role === "member" ? "/m"
        : role === "media_manager" ? "/media"
        : "/admin";
      navigate({ to: dest, replace: true });
    } else {
      navigate({ to: "/auth", replace: true });
    }
  }, [user, role, loading, navigate, isImpersonating, hydrated]);

  return <DashboardSplash />;
}
