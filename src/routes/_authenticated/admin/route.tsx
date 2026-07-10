import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { coachingAdminNav, coachNav } from "@/lib/admin-nav";
import { buildInternalNavCollapsed, buildMembershipAdminNav, resolveStaffRoleTag } from "@/lib/internal-nav";
import { useDashboardMode, setDashboardMode } from "@/lib/dashboard-mode";
import { AdminTopBar } from "@/components/admin-top-bar";
import { TaskPopupGate } from "@/components/tasks/task-popup-gate";
import { ClipboardList, LayoutDashboard, Users, MessagesSquare, BookOpen, Library } from "lucide-react";
import { useBarLayout, resolveLayout, withBarActionItems } from "@/lib/floating-bar";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const search = useRouterState({ select: (r) => r.location.search as { tab?: string } | undefined });
  const [mode] = useDashboardMode();
  const isMembershipWorkspacePath =
    pathname.startsWith("/admin/membership") ||
    pathname.startsWith("/admin/members") ||
    pathname.startsWith("/admin/member-plans") ||
    pathname.startsWith("/admin/member-resources") ||
    pathname === "/admin/sales/membership" ||
    pathname === "/admin/legal" ||
    (pathname === "/admin/communication" && search?.tab === "support-inbox");
  // Only auto-activate Membership mode when the user lands on a
  // membership-scoped path. Do NOT auto-exit to Coaching on shared routes —
  // the top mode switcher (and the sidebar's single "Back to Coaching"
  // action) are the only ways out. This lets Membership mode persist across
  // routes like /admin/messages or /admin/programming while an admin is
  // running the membership workspace.
  useEffect(() => {
    if (isMembershipWorkspacePath && mode !== "membership") setDashboardMode("membership");
    if (mode === "media") setDashboardMode(isMembershipWorkspacePath ? "membership" : "coaching");
  }, [isMembershipWorkspacePath, mode]);
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
  const nav = isMembership && roleTag === "admin"
    ? buildMembershipAdminNav()
    : roleTag
      ? buildInternalNavCollapsed(roleTag, { mode: "coaching" })
      : (isCoach ? coachNav : coachingAdminNav);
  const title = isCoach ? "Coach" : isMembership ? "Membership Admin" : "Admin";
  // Use a dedicated "membership" bar scope when in membership mode so the
  // admin can customize a different floating bar for member-facing ops.
  const barScope = isCoach ? "coach" : (isMembership ? "admin" : "admin");
  const customLayout = useBarLayout(barScope);

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
    if (isMembership) {
      // Membership-optimized quick bar: Home, Members, Support Inbox,
      // Programs library, Plan library — the routes admins actually need
      // when running the JF Membership day-to-day.
      return [
        { to: "/admin/membership", label: "Home", icon: LayoutDashboard },
        { to: "/admin/members", label: "Members", icon: Users },
        { to: "/admin/communication?tab=support-inbox", label: "Support", icon: MessagesSquare },
        { to: "/admin/programming", label: "Programs", icon: BookOpen },
        { to: "/admin/member-plans", label: "Plans", icon: Library },
      ];
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
    ];
  }, [isCoach, isMembership, nav]);

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
      <AdminTopBar showDashboardMode={!isCoach} />
      <Outlet />
      <TaskPopupGate />
    </AppShell>
  );
}