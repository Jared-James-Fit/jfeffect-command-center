import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { TrainingIntelPage } from "@/route-pages/_authenticated/admin/training-intelligence";
import { ProgressReviewQueue } from "@/components/progress/progress-review-queue";
import { AdminCoachingSchedules } from "@/components/admin/coaching-schedules";
import { CoachingManagementBoard } from "@/components/admin/coaching-management-board";

type TabKey = "management" | "progress" | "training-intel" | "schedules";
// Training Intel first and the default. Check-ins are reviewed in Forms →
// Submissions; the old queue (unused since August) is gone, its old links open
// Forms, and a client's manual reviews stay on their Forms tab. Requests
// (asking a client for something) was never used and is gone; ?tab=requests
// falls back to Training Intel.
const TABS: { value: TabKey; label: string }[] = [
  { value: "training-intel", label: "Training Intel" },
  { value: "progress", label: "Progress" },
  { value: "schedules", label: "Schedules" },
  { value: "management", label: "Management" },
];
const DEFAULT_TAB: TabKey = "training-intel";
const isTab = (v: unknown): v is TabKey => typeof v === "string" && TABS.some((t) => t.value === v);

// "check-ins" is only the old tab's address: beforeLoad sends it to Forms.
type Search = { tab: TabKey | "check-ins"; open?: string };

export const Route = createFileRoute("/_authenticated/admin/coaching")({
  beforeLoad: ({ search }) => {
    if (search.tab === "check-ins") throw redirect({ to: "/admin/forms", search: { tab: "submissions" } as any, replace: true });
  },
  // A link that names a tab opens it; the menu (no tab) always opens Training Intel.
  validateSearch: (raw: Record<string, unknown>): Search => {
    const t = raw?.tab;
    const open = typeof raw?.open === "string" ? (raw.open as string) : undefined;
    return { tab: t === "check-ins" ? "check-ins" : isTab(t) ? t : DEFAULT_TAB, open };
  },
  component: CoachingWorkspace,
});

function CoachingWorkspace() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const setTab = (n: TabKey) => navigate({ to: "/admin/coaching", search: { tab: n } as any });
  return (
    <>
      <PageHeader title="Coaching" subtitle="Training intel, progress and check-in schedules." />
      <div className="border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button key={t.value} type="button" onClick={() => setTab(t.value)}
                className={cn("min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors",
                  active ? "border-foreground font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground")}
                aria-current={active ? "page" : undefined}>{t.label}</button>
            );
          })}
        </div>
      </div>
      <div>
        {tab === "management" && <CoachingManagementBoard />}
        {tab === "progress" && <ProgressReviewQueue />}
        {tab === "training-intel" && <TrainingIntelPage embedded />}
        {tab === "schedules" && <AdminCoachingSchedules />}
      </div>
    </>
  );
}