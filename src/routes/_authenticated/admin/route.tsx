import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { adminNav, coachNav } from "@/lib/admin-nav";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && role === "client") navigate({ to: "/portal", replace: true });
  }, [role, loading, navigate]);

  if (loading || !role) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }

  const isCoach = role === "coach";
  const nav = isCoach ? coachNav : adminNav;
  const title = isCoach ? "Coach" : "Admin";

  return (
    <AppShell items={nav} title={title}>
      <Outlet />
    </AppShell>
  );
}