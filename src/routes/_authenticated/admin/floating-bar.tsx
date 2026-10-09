import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { FloatingBarCustomizer } from "@/components/floating-bar-customizer";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { STAFF_BAR, buildInternalNav, resolveStaffRoleTag } from "@/lib/internal-nav";
import { withBarActionItems } from "@/lib/floating-bar";
import type { NavItem } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/admin/floating-bar")({
  component: FloatingBarPage,
});

function FloatingBarPage() {
  const { role } = useAuth();
  const isCoach = role === "coach";
  // Drive the picker from the same shared role-aware registry the sidebar
  // uses, so hidden / forbidden destinations never appear in the customizer.
  const roleTag = resolveStaffRoleTag(role);
  const nav = useMemo<NavItem[]>(() => withBarActionItems(roleTag ? buildInternalNav(roleTag) : []), [roleTag]);
  const scope = isCoach ? "coach" : "admin";

  // The standard bar every staff account starts with (More is in the header).
  const defaults: NavItem[] = STAFF_BAR;

  return (
    <>
      <SettingsTabs />
      <PageHeader
        title="Floating Bar"
        subtitle="Customize your mobile bottom navigation. Add toggles, reorder, and stack hold-to-open options."
      />
      <div className="p-4 md:p-6">
        <FloatingBarCustomizer scope={scope} nav={nav} defaults={defaults} />
      </div>
    </>
  );
}