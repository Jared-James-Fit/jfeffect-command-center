import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { AdminCheckInReviews } from "./check-in-reviews";
import { AdminLiftVideos } from "./lift-videos";
import { TrainingIntelPage } from "./training-intelligence";
import { AdminClientActionRequests } from "./client-action-requests";

type TabKey = "check-ins" | "lift-reviews" | "training-intel" | "requests";
const TABS: { value: TabKey; label: string }[] = [
  { value: "check-ins", label: "Check-Ins" },
  { value: "lift-reviews", label: "Lift Reviews" },
  { value: "training-intel", label: "Training Intel" },
  { value: "requests", label: "Requests" },
];
const LAST_TAB_KEY = "jf-admin-coaching-last-tab";
const isTab = (v: unknown): v is TabKey => typeof v === "string" && TABS.some((t) => t.value === v);

type Search = { tab: TabKey; open?: string };

export const Route = createFileRoute("/_authenticated/admin/coaching")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const t = raw?.tab;
    const open = typeof raw?.open === "string" ? (raw.open as string) : undefined;
    if (isTab(t)) return { tab: t, open };
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try { const s = window.localStorage.getItem(LAST_TAB_KEY); if (isTab(s)) return { tab: s, open }; } catch {}
    }
    return { tab: "check-ins", open };
  },
  component: CoachingWorkspace,
});

function CoachingWorkspace() {
  const { tab, open } = Route.useSearch();
  const navigate = useNavigate();
  useMemo(() => { try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {} }, [tab]);
  const setTab = (n: TabKey) => navigate({ to: "/admin/coaching", search: { tab: n } as any });
  return (
    <>
      <PageHeader title="Coaching" subtitle="Check-ins, lift reviews, training intelligence, and client requests." />
      <div className="border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button key={t.value} type="button" onClick={() => setTab(t.value)}
                className={cn("shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                aria-current={active ? "page" : undefined}>{t.label}</button>
            );
          })}
        </div>
      </div>
      <div>
        {tab === "check-ins" && <AdminCheckInReviews embedded />}
        {tab === "lift-reviews" && <AdminLiftVideos embedded initialOpen={open} />}
        {tab === "training-intel" && <TrainingIntelPage embedded />}
        {tab === "requests" && <AdminClientActionRequests embedded />}
      </div>
    </>
  );
}