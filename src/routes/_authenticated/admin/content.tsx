import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { AdminMediaReview } from "./media-review";
import { ApprovalsPage } from "./approvals";
import { AdminTasksPanel } from "./tasks";
import { MemberResourcesAdmin } from "./member-resources.index";
import { ResourceLibrary } from "./resources";
import { MediaArchivesPage } from "./media-archives";

type TabKey = "inbox" | "approvals" | "tasks" | "member-resources" | "library" | "archive";
const TABS: { value: TabKey; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "approvals", label: "Approvals" },
  { value: "tasks", label: "Tasks" },
  { value: "member-resources", label: "Member Resources" },
  { value: "library", label: "Library" },
  { value: "archive", label: "Archive" },
];
const LAST_TAB_KEY = "jf-admin-content-last-tab";
const isTab = (v: unknown): v is TabKey => typeof v === "string" && TABS.some((t) => t.value === v);

export const Route = createFileRoute("/_authenticated/admin/content")({
  validateSearch: (raw: Record<string, unknown>): { tab: TabKey } => {
    const t = raw?.tab;
    if (isTab(t)) return { tab: t };
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try { const s = window.localStorage.getItem(LAST_TAB_KEY); if (isTab(s)) return { tab: s }; } catch {}
    }
    return { tab: "inbox" };
  },
  component: ContentWorkspace,
});

function ContentWorkspace() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  useMemo(() => { try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {} }, [tab]);
  const setTab = (n: TabKey) => navigate({ to: "/admin/content", search: { tab: n } as any });
  return (
    <>
      <PageHeader title="Content" subtitle="Media inbox, approvals, tasks, resources, and archive." />
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
        {tab === "inbox" && <AdminMediaReview embedded />}
        {tab === "approvals" && <ApprovalsPage embedded />}
        {tab === "tasks" && <AdminTasksPanel />}
        {tab === "member-resources" && <div className="p-4 md:p-6"><MemberResourcesAdmin embedded /></div>}
        {tab === "library" && <div className="p-4 md:p-6"><ResourceLibrary embedded /></div>}
        {tab === "archive" && <MediaArchivesPage embedded />}
      </div>
    </>
  );
}