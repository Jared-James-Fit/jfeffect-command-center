import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { adminNav, coachNav } from "@/lib/admin-nav";
import { PovQuickToggle } from "@/components/pov-quick-toggle";
import { TaskPopupGate } from "@/components/tasks/task-popup-gate";
import { ClipboardList } from "lucide-react";
import { useBarLayout, resolveLayout, withBarActionItems } from "@/lib/floating-bar";

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

  const isCoach = role === "coach";
  const nav = isCoach ? coachNav : adminNav;
  const title = isCoach ? "Coach" : "Admin";
  const customLayout = useBarLayout(isCoach ? "coach" : "admin");

  const defaultBottom = useMemo(() => {
    const source = isCoach ? coachNav : adminNav;
    const pick = (to: string) => source.find((i) => i.to === to)!;
    if (isCoach) {
      return [
        pick("/admin"),
        { ...pick("/admin/clients"), label: "Clients" },
        pick("/admin/messages"),
        { ...pick("/admin/lift-videos"), label: "Lifts" },
        { ...pick("/admin/tasks"), label: "Tasks" },
      ].filter(Boolean);
    }
    return [
      pick("/admin"),
      { ...pick("/admin/clients"), label: "Clients" },
      pick("/admin/messages"),
      {
        to: "/admin/check-in-reviews",
        label: "Reviews",
        icon: ClipboardList,
        children: [
          { ...pick("/admin/check-in-reviews"), label: "Check-Ins" },
          { ...pick("/admin/lift-videos"), label: "Lifts" },
        ],
      },
      { ...pick("/admin/tasks"), label: "Tasks" },
    ];
  }, [isCoach]);

  const bottomItems = useMemo(() => {
    if (customLayout && customLayout.slots.length > 0) {
      const resolved = resolveLayout(customLayout, withBarActionItems(nav));
      if (resolved.length) return resolved;
    }
    return defaultBottom;
  }, [customLayout, nav, defaultBottom]);

  if (loading || !role) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }

  // While the effect-driven redirect is in flight, render nothing for non-admin/coach
  // so admin UI never flashes to members/clients.
  if (role !== "admin" && role !== "coach") {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Redirecting…</div>;
  }

  return (
    <AppShell items={nav} bottomItems={bottomItems} title={title}>
      <PovQuickToggle variant="banner" />
      <Outlet />
      <TaskPopupGate />
    </AppShell>
  );
}