import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { FloatingBarCustomizer } from "@/components/floating-bar-customizer";
import { buildInternalNav, resolveStaffRoleTag } from "@/lib/internal-nav";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { withBarActionItems } from "@/lib/floating-bar";
import { ClipboardList } from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/admin/floating-bar")({
  component: FloatingBarPage,
});

function FloatingBarPage() {
  const { role } = useAuth();
  const [mode] = useDashboardMode();
  const isCoach = role === "coach";
  // Drive the picker from the same shared role-aware registry the sidebar
  // uses, scoped to the current dashboard mode — so hidden / forbidden
  // destinations never appear in the customizer.
  const roleTag = resolveStaffRoleTag(role);
  const nav = useMemo<NavItem[]>(() => {
    const items = roleTag
      ? buildInternalNav(roleTag, { mode: mode === "membership" ? "membership" : "coaching" })
      : [];
    return withBarActionItems(items);
  }, [roleTag, mode]);
  const scope = isCoach ? "coach" : "admin";

  const defaults: NavItem[] = (() => {
    const pick = (to: string) => nav.find((i) => i.to === to)!;
    if (isCoach) {
      return [
        pick("/admin"),
        { ...pick("/admin/clients"), label: "Clients" },
        pick("/admin/messages"),
        { ...pick("/admin/lift-videos"), label: "Lifts" },
        { ...pick("/admin/tasks"), label: "Tasks" },
      ].filter(Boolean) as NavItem[];
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
  })();

  return (
    <>
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