import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { CoachesPage } from "./coaches.index";
import { StaffPage } from "./staff";
import { BusinessSystemsHub } from "./business-systems";

type TabKey = "people" | "staff-media" | "operations";
const TABS: { value: TabKey; label: string }[] = [
  { value: "people", label: "People" },
  { value: "staff-media", label: "Staff & Media" },
  { value: "operations", label: "Operations" },
];
const LAST_TAB_KEY = "jf-admin-team-last-tab";
const isTab = (v: unknown): v is TabKey => typeof v === "string" && TABS.some((t) => t.value === v);

export const Route = createFileRoute("/_authenticated/admin/team")({
  validateSearch: (raw: Record<string, unknown>): { tab: TabKey } => {
    const t = raw?.tab;
    if (isTab(t)) return { tab: t };
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try { const s = window.localStorage.getItem(LAST_TAB_KEY); if (isTab(s)) return { tab: s }; } catch {}
    }
    return { tab: "people" };
  },
  component: TeamWorkspace,
});

function TeamWorkspace() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  useMemo(() => { try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {} }, [tab]);
  const setTab = (n: TabKey) => navigate({ to: "/admin/team", search: { tab: n } as any });
  return (
    <>
      <PageHeader title="Team" subtitle="Coaches, staff, and internal operations." />
      <div className="border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button key={t.value} type="button" onClick={() => setTab(t.value)}
                className={cn("shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</button>
            );
          })}
        </div>
      </div>
      <div>
        {tab === "people" && <CoachesPage embedded />}
        {tab === "staff-media" && <StaffPage embedded />}
        {tab === "operations" && <BusinessSystemsHub embedded />}
      </div>
    </>
  );
}