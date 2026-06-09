import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { adminNav, coachNav } from "@/lib/admin-nav";
import { AdminPovMenu } from "@/components/admin-pov";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading || !role) return;
    if (role === "admin" || role === "coach") return;
    if (role === "member") {
      navigate({ to: "/m", replace: true });
      return;
    }
    // Any other role (client / unknown) → portal
    navigate({ to: "/portal", replace: true });
  }, [role, loading, navigate]);

  if (loading || !role) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }

  // While the effect-driven redirect is in flight, render nothing for non-admin/coach
  // so admin UI never flashes to members/clients.
  if (role !== "admin" && role !== "coach") {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Redirecting…</div>;
  }

  const isCoach = role === "coach";
  const nav = isCoach ? coachNav : adminNav;
  const title = isCoach ? "Coach" : "Admin";

  return (
    <AppShell items={nav} title={title}>
      {!isCoach && (
        <div className="flex justify-end border-b border-border bg-muted/30 px-4 py-1.5">
          <AdminPovMenu />
        </div>
      )}
      <Outlet />
    </AppShell>
  );
}