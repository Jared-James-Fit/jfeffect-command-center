import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Clock, CheckCircle2, MessageSquareWarning, Send, CalendarDays,
  UserX, Ban, ListChecks, Sparkles, FileImage, Activity, ChevronRight,
} from "lucide-react";
import { MediaHeader } from "@/components/media/media-header";
import { mediaHomeData } from "@/lib/media-home.functions";
import { toggleTaskDone } from "@/lib/tasks";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/media/")({
  component: MediaHomePage,
});

function MediaHomePage() {
  const fetchData = useServerFn(mediaHomeData);
  const { data, isLoading } = useQuery({ queryKey: ["media-home"], queryFn: () => fetchData() });
  const qc = useQueryClient();

  const counts = data?.counts ?? { dueToday: 0, overdue: 0, awaitingReview: 0, changesRequested: 0, readyToPublish: 0, scheduledThisWeek: 0, unassigned: 0, blocked: 0 };

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader title="Media Home" description="Today's priorities, approvals, and what needs your attention." />

      {/* Status cards */}
      <section className="mb-6 grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
        <StatusCard label="Due Today"        count={counts.dueToday}         icon={Clock}            tone="primary"  to="/media/work"       search={{ filter: "today" }} />
        <StatusCard label="Overdue"          count={counts.overdue}          icon={AlertTriangle}    tone="destructive" to="/media/work"    search={{ filter: "overdue" }} />
        <StatusCard label="Awaiting Review"  count={counts.awaitingReview}   icon={MessageSquareWarning} tone="warning" to="/media/inbox" />
        <StatusCard label="Changes Requested" count={counts.changesRequested} icon={MessageSquareWarning} tone="warning" to="/media/inbox" />
        <StatusCard label="Ready to Publish" count={counts.readyToPublish}   icon={Send}             tone="success" to="/media/publishing" />
        <StatusCard label="Scheduled (Week)" count={counts.scheduledThisWeek} icon={CalendarDays}    tone="primary" to="/media/publishing" />
        <StatusCard label="Unassigned"       count={counts.unassigned}       icon={UserX}            tone="muted"   to="/media/work"       search={{ filter: "unassigned" }} />
        <StatusCard label="Blocked"          count={counts.blocked}          icon={Ban}              tone="destructive" to="/media/work"  search={{ filter: "blocked" }} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* My Priorities */}
        <Card className="border-border p-4">
          <SectionHeader icon={ListChecks} title="My Priorities" linkTo="/media/work" />
          {isLoading && <Skeleton />}
          {!isLoading && (data?.myPriorities ?? []).length === 0 && <EmptyState text="Inbox zero. Add a task on My Work." />}
          <ul className="space-y-1.5">
            {(data?.myPriorities ?? []).map((t: any) => (
              <li key={t.id} className="flex items-center gap-2 rounded border border-border p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    {t.status_label && <Badge variant="outline">{t.status_label.replace("_", " ")}</Badge>}
                    {t.priority_label && <Badge variant="outline">{t.priority_label}</Badge>}
                    {t.due_at && <span>{new Date(t.due_at).toLocaleDateString()}</span>}
                    {t.assignee_name && <span>→ {t.assignee_name}</span>}
                  </div>
                </div>
                <Button asChild variant="ghost" size="sm"><Link to="/media/work">Open</Link></Button>
                {t.status !== "done" && (
                  <Button variant="outline" size="sm" onClick={async () => { await toggleTaskDone(t.id, true); qc.invalidateQueries({ queryKey: ["media-home"] }); }}>
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Complete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {/* Approval Queue */}
        <Card className="border-border p-4">
          <SectionHeader icon={MessageSquareWarning} title="Approval Queue" linkTo="/media/inbox" />
          {isLoading && <Skeleton />}
          {!isLoading && (data?.approvalQueue ?? []).length === 0 && (
            <EmptyState text="Nothing waiting on you. Pending broadcasts shown on the inbox." />
          )}
          <ul className="space-y-1.5">
            {(data?.approvalQueue ?? []).map((c: any) => (
              <li key={c.id} className="flex items-center gap-2 rounded border border-border p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.title || "Untitled"}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {c.content_type} {c.platform && `· ${c.platform}`}
                  </div>
                </div>
                <Button asChild variant="ghost" size="sm"><Link to="/media/inbox">Open</Link></Button>
                <Button variant="outline" size="sm" onClick={() => approve(c.id, qc)}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve</Button>
                <Button variant="outline" size="sm" onClick={() => requestChanges(c.id, qc)}>Changes</Button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Upcoming Content */}
        <Card className="border-border p-4">
          <SectionHeader icon={CalendarDays} title="Upcoming Content" linkTo="/media/calendar" />
          {isLoading && <Skeleton />}
          {!isLoading && (data?.upcoming ?? []).length === 0 && <EmptyState text="Nothing scheduled in the near term." />}
          <ul className="space-y-1.5">
            {(data?.upcoming ?? []).map((u: any) => (
              <li key={`${u.kind}-${u.id}`} className="flex items-center justify-between gap-2 rounded border border-border p-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline">{u.kind}</Badge>
                  <span className="truncate">{u.title}</span>
                </div>
                <span className="text-xs text-muted-foreground">{u.date}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Needs Attention */}
        <Card className="border-border p-4">
          <SectionHeader icon={AlertTriangle} title="Needs Attention" />
          {isLoading && <Skeleton />}
          {!isLoading && (data?.needsAttention ?? []).length === 0 && <EmptyState text="All clear." />}
          <ul className="space-y-1.5">
            {(data?.needsAttention ?? []).map((n: any, i: number) => (
              <li key={`${n.kind}-${n.id}-${i}`} className="flex items-center gap-2 rounded border border-border p-2 text-sm">
                <Badge variant="outline" className="text-destructive">{n.reason}</Badge>
                <span className="truncate flex-1">{n.title}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Active Campaigns */}
        <Card className="border-border p-4">
          <SectionHeader icon={Sparkles} title="Active Campaigns" linkTo="/media/campaigns" />
          <EmptyState text="No active campaigns yet. Create one from the Campaigns workspace." />
        </Card>

        {/* Recent Activity */}
        <Card className="border-border p-4">
          <SectionHeader icon={Activity} title="Recent Activity" />
          {isLoading && <Skeleton />}
          {!isLoading && (data?.recentActivity ?? []).length === 0 && <EmptyState text="Activity will appear here as the team works." />}
          <ul className="space-y-1.5">
            {(data?.recentActivity ?? []).map((a: any) => (
              <li key={a.id} className="flex items-start gap-2 rounded border border-border p-2 text-sm">
                <Badge variant="outline" className="text-[10px]">{a.kind?.replace(/_/g, " ")}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{a.summary}</div>
                  <div className="text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleString()}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, linkTo }: { icon: any; title: string; linkTo?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
        <Icon className="h-4 w-4" />{title}
      </h2>
      {linkTo && (
        <Button asChild variant="ghost" size="sm" className="h-7">
          <Link to={linkTo as any}>View all <ChevronRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      )}
    </div>
  );
}

function Skeleton() { return <div className="space-y-1.5">{[1,2,3].map((i) => <div key={i} className="h-10 animate-pulse rounded border border-border bg-muted/40" />)}</div>; }
function EmptyState({ text }: { text: string }) { return <p className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{text}</p>; }

const TONE: Record<string, string> = {
  primary:     "border-primary/40 hover:bg-primary/5",
  destructive: "border-destructive/40 hover:bg-destructive/5",
  warning:     "border-yellow-500/40 hover:bg-yellow-500/5",
  success:     "border-green-500/40 hover:bg-green-500/5",
  muted:       "border-border hover:bg-muted/40",
};
const TONE_TEXT: Record<string, string> = {
  primary: "text-primary", destructive: "text-destructive",
  warning: "text-yellow-600 dark:text-yellow-400", success: "text-green-600 dark:text-green-400",
  muted: "text-muted-foreground",
};

function StatusCard({ label, count, icon: Icon, tone, to, search }: { label: string; count: number; icon: any; tone: keyof typeof TONE; to: string; search?: any }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate({ to: to as any, search })}
      className={`flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition ${TONE[tone]}`}
    >
      <div className="flex w-full items-center justify-between">
        <Icon className={`h-4 w-4 ${TONE_TEXT[tone]}`} />
        <span className={`text-xl font-black tabular-nums ${TONE_TEXT[tone]}`}>{count}</span>
      </div>
      <span className="text-[11px] font-medium text-foreground/80">{label}</span>
    </button>
  );
}

async function approve(id: string, qc: ReturnType<typeof useQueryClient>) {
  const { error } = await (supabase.from("media_content_records") as any).update({ approval_status: "approved" }).eq("id", id);
  if (error) toast.error(error.message); else { toast.success("Approved"); qc.invalidateQueries({ queryKey: ["media-home"] }); }
}
async function requestChanges(id: string, qc: ReturnType<typeof useQueryClient>) {
  const { error } = await (supabase.from("media_content_records") as any).update({ approval_status: "changes_requested" }).eq("id", id);
  if (error) toast.error(error.message); else { toast.success("Changes requested"); qc.invalidateQueries({ queryKey: ["media-home"] }); }
}