import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaHeader } from "@/components/media/media-header";

export const Route = createFileRoute("/_authenticated/media/team")({
  component: TeamPage,
});

type Member = {
  id: string;
  name: string;
  email: string | null;
  roles: string[];
  openTasks: number;
  overdueTasks: number;
  assignedContent: number;
  reviewsWaiting: number;
  dueThisWeek: number;
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  media_manager: "Media Manager",
  coach: "Reviewer",
  contributor: "Contributor",
  reviewer: "Reviewer",
};

function TeamPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-team-roster"],
    queryFn: async (): Promise<Member[]> => {
      const db: any = supabase;
      const { data: roles } = await db.from("user_roles")
        .select("user_id, role")
        .in("role", ["admin", "media_manager", "coach"]);
      const userIds = Array.from(new Set((roles ?? []).map((r: any) => r.user_id))) as string[];
      if (userIds.length === 0) return [];

      const now = new Date();
      const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
      const nowIso = now.toISOString();
      const weekIso = weekEnd.toISOString();

      const [profiles, openTasks, overdueTasks, dueWeekTasks, assignedContent, reviews] = await Promise.all([
        db.from("profiles").select("id, full_name, email, avatar_url").in("id", userIds),
        db.from("tasks").select("id, assignee_id").in("assignee_id", userIds).is("archived_at", null).neq("status", "done"),
        db.from("tasks").select("id, assignee_id").in("assignee_id", userIds).is("archived_at", null).neq("status", "done").lt("due_at", nowIso),
        db.from("tasks").select("id, assignee_id").in("assignee_id", userIds).is("archived_at", null).neq("status", "done").gte("due_at", nowIso).lte("due_at", weekIso),
        db.from("media_content_records").select("id, assignee_id").in("assignee_id", userIds).eq("archived", false),
        db.from("media_content_records").select("id, reviewer_id").in("reviewer_id", userIds).eq("approval_status", "awaiting_review").eq("archived", false),
      ]);

      const rolesByUser = new Map<string, string[]>();
      for (const r of roles ?? []) {
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push(r.role); rolesByUser.set(r.user_id, list);
      }
      const count = (rows: any[] | null | undefined, key: string) => {
        const m = new Map<string, number>();
        for (const r of rows ?? []) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
        return m;
      };
      const openByU = count(openTasks.data, "assignee_id");
      const overdueByU = count(overdueTasks.data, "assignee_id");
      const weekByU = count(dueWeekTasks.data, "assignee_id");
      const contentByU = count(assignedContent.data, "assignee_id");
      const reviewByU = count(reviews.data, "reviewer_id");

      return (profiles.data ?? []).map((p: any) => ({
        id: p.id,
        name: p.full_name || p.email || "Unnamed",
        email: p.email,
        roles: rolesByUser.get(p.id) ?? [],
        openTasks: openByU.get(p.id) ?? 0,
        overdueTasks: overdueByU.get(p.id) ?? 0,
        assignedContent: contentByU.get(p.id) ?? 0,
        reviewsWaiting: reviewByU.get(p.id) ?? 0,
        dueThisWeek: weekByU.get(p.id) ?? 0,
      }));
    },
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <MediaHeader
        title="Team"
        description="Members with Media Manager access, their current workload, and what's due this week."
      />
      {isLoading ? (
        <div className="grid gap-2 md:grid-cols-2">
          {[0,1,2,3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No team members found.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((m) => (
            <Card key={m.id} className="p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{m.name}</div>
                  {m.email && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {m.roles.map((r) => (
                    <Badge key={r} variant="secondary">{ROLE_LABEL[r] ?? r}</Badge>
                  ))}
                  <Badge variant="outline" className="text-green-600 dark:text-green-400">Available</Badge>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <Stat label="Open" value={m.openTasks} />
                <Stat label="Overdue" value={m.overdueTasks} tone={m.overdueTasks > 0 ? "destructive" : undefined} />
                <Stat label="Due 7d" value={m.dueThisWeek} />
                <Stat label="Content" value={m.assignedContent} />
                <Stat label="To review" value={m.reviewsWaiting} tone={m.reviewsWaiting > 0 ? "warning" : undefined} />
                <Stat label="Total" value={m.openTasks + m.assignedContent + m.reviewsWaiting} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "destructive" | "warning" }) {
  const cls = tone === "destructive" ? "text-destructive"
    : tone === "warning" ? "text-yellow-600 dark:text-yellow-400"
    : "text-foreground";
  return (
    <div className="rounded border border-border p-2">
      <div className={`text-base font-bold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}