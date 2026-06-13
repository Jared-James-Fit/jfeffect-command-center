import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { coachingAdminNav, coachNav } from "@/lib/admin-nav";
import { buildInternalNav, resolveStaffRoleTag } from "@/lib/internal-nav";
import { useDashboardMode, setDashboardMode } from "@/lib/dashboard-mode";
import { DashboardModeSwitcher } from "@/components/dashboard-mode-switcher";
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
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [mode] = useDashboardMode();
  // If user lands on /admin/membership, force membership mode; conversely auto-switch back when leaving.
  useEffect(() => {
    const inMembership = pathname.startsWith("/admin/membership");
    if (inMembership && mode !== "membership") setDashboardMode("membership");
    if (!inMembership && mode === "membership") setDashboardMode("coaching");
    if (mode === "media") setDashboardMode(inMembership ? "membership" : "coaching");
  }, [pathname, mode]);
  useEffect(() => {
    if (loading || !role) return;
    if (role === "admin" || role === "coach") return;
    if (role === "member") {
      navigate({ to: "/m", replace: true });
      return;
    }
    if (role === "media_manager") {
      navigate({ to: "/media", replace: true });
      return;
    }
    // Any other role (client / unknown) → portal
    navigate({ to: "/portal", replace: true });
  }, [role, loading, navigate]);

  const isCoach = role === "coach";
  const isMembership = !isCoach && mode === "membership";
  // Build the sidebar from the shared role-aware internal-nav registry.
  // Falls back to the legacy per-role registries if the role isn't yet
  // mapped (defensive — keeps existing behaviour for unknown future roles).
  const roleTag = resolveStaffRoleTag(role);
  const nav = roleTag
    ? buildInternalNav(roleTag, { mode: isMembership ? "membership" : "coaching" })
    : (isCoach ? coachNav : coachingAdminNav);
  const title = isCoach ? "Coach" : isMembership ? "Membership Admin" : "Admin";
  const customLayout = useBarLayout(isCoach ? "coach" : "admin");

  const defaultBottom = useMemo(() => {
    // Derive the mobile bottom bar from the SAME role-aware registry that
    // drives the sidebar — keeps desktop + mobile permission rules in sync.
    // Falls back to the legacy registries only if a route isn't present
    // (defensive — should not happen for these five core destinations).
    const legacy = isCoach ? coachNav : coachingAdminNav;
    const pick = (to: string) =>
      nav.find((i) => i.to === to) ?? legacy.find((i) => i.to === to)!;
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
  }, [isCoach, nav]);

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
      {!isCoach && <DashboardModeSwitcher />}
      <PovQuickToggle variant="banner" />
      <Outlet />
      <TaskPopupGate />
    </AppShell>
  );
}