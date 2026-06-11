import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { mediaNav } from "@/lib/media-nav";

export const Route = createFileRoute("/_authenticated/media")({
  component: MediaLayout,
});

function MediaLayout() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading || !role) return;
    if (role !== "media_manager" && role !== "admin") {
      const dest = role === "client" ? "/portal" : role === "member" ? "/m" : "/admin";
      navigate({ to: dest, replace: true });
    }
  }, [role, loading, navigate]);

  if (loading || !role) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }
  if (role !== "media_manager" && role !== "admin") {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Redirecting…</div>;
  }

  return (
    <AppShell items={mediaNav} title="Media Manager">
      <Outlet />
    </AppShell>
  );
}