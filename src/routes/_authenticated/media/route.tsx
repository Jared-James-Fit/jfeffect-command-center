import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { buildInternalNav } from "@/lib/internal-nav";
import { DashboardModeSwitcher } from "@/components/dashboard-mode-switcher";
import { setDashboardMode, useDashboardMode } from "@/lib/dashboard-mode";
import { TaskPopupGate } from "@/components/tasks/task-popup-gate";
import { ContentDrawerProvider } from "@/components/media/content-drawer";
import { TeamPovBanner } from "@/components/team-pov-banner";
import { FullPageLoader } from "@/components/full-page-loader";

export const Route = createFileRoute("/_authenticated/media")({
  component: MediaLayout,
});

function MediaLayout() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const [mode] = useDashboardMode();
  useEffect(() => {
    if (role === "admin" && mode !== "media") setDashboardMode("media");
  }, [role, mode]);
  useEffect(() => {
    if (loading || !role) return;
    if (role !== "media_manager" && role !== "admin") {
      const dest = role === "client" ? "/portal" : role === "member" ? "/m" : "/admin";
      navigate({ to: dest, replace: true });
    }
  }, [role, loading, navigate]);

  if (loading || !role) {
    return <FullPageLoader />;
  }
  if (role !== "media_manager" && role !== "admin") {
    return <FullPageLoader label="Redirecting…" />;
  }

  const nav = useMemo(() => buildInternalNav("media_manager"), []);
  const bottomItems = useMemo(() => {
    const pick = (to: string) => nav.find((i) => i.to === to);
    return [
      pick("/media"),
      pick("/media/content"),
      pick("/media/communication"),
      pick("/media/calendar"),
      pick("/media/settings"),
    ].filter(Boolean) as typeof nav;
  }, [nav]);

  return (
    <AppShell items={nav} bottomItems={bottomItems} title="Media Manager">
      {role === "admin" && <DashboardModeSwitcher />}
      <TeamPovBanner />
      <ContentDrawerProvider>
        <Outlet />
        <TaskPopupGate scope="media_manager" />
      </ContentDrawerProvider>
    </AppShell>
  );
}