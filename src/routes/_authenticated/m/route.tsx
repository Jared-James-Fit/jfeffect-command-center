import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { memberNav } from "@/lib/admin-nav";

function MemberLayout() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (role === "client") navigate({ to: "/portal", replace: true });
    else if (role === "admin" || role === "coach") navigate({ to: "/admin", replace: true });
  }, [role, loading, navigate]);
  if (loading || !role) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }
  return (
    <AppShell items={memberNav} title="Member">
      <Outlet />
    </AppShell>
  );
}

export const Route = createFileRoute("/_authenticated/m")({ component: MemberLayout });