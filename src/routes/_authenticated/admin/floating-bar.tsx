import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { FloatingBarCustomizer } from "@/components/floating-bar-customizer";
import { adminNav, coachNav } from "@/lib/admin-nav";
import { ClipboardList } from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/admin/floating-bar")({
  component: FloatingBarPage,
});

function FloatingBarPage() {
  const { role } = useAuth();
  const isCoach = role === "coach";
  const nav = isCoach ? coachNav : adminNav;
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