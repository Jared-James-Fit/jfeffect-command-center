import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { coachingAdminNav, coachNav } from "@/lib/admin-nav";
import { FINANCE_BAR, STAFF_BAR, buildFinanceNav, buildInternalNav, buildInternalNavCollapsed, resolveStaffRoleTag } from "@/lib/internal-nav";
import { AdminTopBar } from "@/components/admin-top-bar";
import { TaskPopupGate } from "@/components/tasks/task-popup-gate";
import { SummerAssistant } from "@/components/summer/summer-assistant";
import { ReturnToDashboardPill } from "@/components/return-to-dashboard";
import { useIsBusinessOwner, withoutOwnerOnly } from "@/lib/business-owner";
import { useBarLayout, resolveLayout, withBarActionItems, mergeNavSources } from "@/lib/floating-bar";
import { FullPageLoader } from "@/components/full-page-loader";
import { StaffMfaGate } from "@/components/staff-mfa-gate";
import { ViewOnlyStrip } from "@/components/view-only-strip";
import { TeamPreviewBanner } from "@/components/team-preview-banner";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { role, viewOnly, preview, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading || !role) return;
    if (role === "admin" || role === "coach") return;
    if (role === "member") {
      navigate({ to: "/m", replace: true });
      return;
    }
    // Any other role (client / unknown / the retired media_manager) → portal
    navigate({ to: "/portal", replace: true });
  }, [role, loading, navigate]);

  const isCoach = role === "coach";
  // Build the sidebar from the shared role-aware internal-nav registry.
  // Falls back to the legacy per-role registries if the role isn't yet
  // mapped (defensive — keeps existing behaviour for unknown future roles).
  // Membership is a section of this one menu; there is no separate mode.
  const roleTag = resolveStaffRoleTag(role);
  const isOwner = useIsBusinessOwner();
  const fullNav = roleTag ? buildInternalNavCollapsed(roleTag) : (isCoach ? coachNav : coachingAdminNav);
  // Owner-only pages (Taxes & Books) stay out of other admins' menus. The
  // finance login keeps them, with its money pages first and the whole admin
  // menu after.
  const nav = viewOnly
    ? [...buildFinanceNav(), ...fullNav]
    : isOwner === false ? withoutOwnerOnly(fullNav) : fullNav;
  const title = preview ? `${preview.name.split(" ")[0]} · Finance` : viewOnly ? "Finance" : isCoach ? "Coach" : "Admin";
  const barScope = isCoach ? "coach" : "admin";
  const customLayout = useBarLayout(barScope);

  // Every staff phone bar is five plain tabs with the League raised in the
  // middle; More opens from the header (AppShell `moreInHeader`), the same as
  // the client app.
  // The finance login's bar starts on its home (snap, record, collect, Cleo).
  const defaultBottom = viewOnly ? FINANCE_BAR : STAFF_BAR;

  const bottomItems = useMemo(() => {
    if (customLayout && customLayout.slots.length > 0) {
      // Resolve against the FULL flat registry merged with the collapsed
      // shell nav. The customizer picks from the full registry, so resolving
      // against the collapsed nav alone dropped slots whose route is folded
      // into a workspace group (the real cause of the "5th slot won't save").
      const source = withBarActionItems(
        mergeNavSources(nav, roleTag ? buildInternalNav(roleTag) : []),
      );
      const resolved = resolveLayout(customLayout, source);
      if (resolved.length) return resolved;
    }
    return defaultBottom;
  }, [customLayout, nav, defaultBottom, roleTag]);

  if (loading || !role) {
    return <FullPageLoader />;
  }

  // While the effect-driven redirect is in flight, render nothing for non-admin/coach
  // so admin UI never flashes to members/clients.
  if (role !== "admin" && role !== "coach") {
    return <FullPageLoader label="Redirecting…" />;
  }

  return (
    <StaffMfaGate>
      <AppShell items={nav} bottomItems={bottomItems} title={title} moreInHeader>
        <AdminTopBar />
        <TeamPreviewBanner />
        {viewOnly && !preview && <ViewOnlyStrip />}
        <Outlet />
        {!viewOnly && <TaskPopupGate />}
        <ReturnToDashboardPill />
        {role === "admin" && <SummerAssistant />}
      </AppShell>
    </StaffMfaGate>
  );
}