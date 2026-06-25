import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * One-shot data fetch for the Media Home dashboard.
 * Returns every section the dashboard renders, so the page makes a single
 * round-trip and the UI stays snappy.
 */
export const mediaHomeData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const today = new Date().toISOString().slice(0, 10);
    const weekAhead = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

    const [
      mediaTasksAll, contentAll, eventsUpcoming, activityRecent, broadcastsReview,
    ] = await Promise.all([
      supabase.from("tasks").select("*").eq("scope", "media").is("archived_at", null),
      supabase.from("media_content_records").select("*").eq("archived", false),
      supabase.from("events").select("id, name, event_date").gte("event_date", today).order("event_date").limit(10),
      supabase.from("media_activity_events").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("broadcasts").select("id, title, review_status, updated_at").eq("review_status", "needs_review").order("updated_at", { ascending: false }).limit(20),
    ]);

    const tasks = (mediaTasksAll.data ?? []) as any[];
    const content = (contentAll.data ?? []) as any[];

    const openTasks = tasks.filter((t) => t.status !== "done");
    const overdue = openTasks.filter((t) => t.due_at && t.due_at < today);
    const dueToday = openTasks.filter((t) => t.due_at?.slice(0, 10) === today);
    const unassignedContent = content.filter((c) => !c.assignee_id);
    const blockedTasks = openTasks.filter((t) => t.status_label === "blocked");
    const awaitingReview = content.filter((c) => c.approval_status === "pending");
    const changesRequested = content.filter((c) => c.approval_status === "changes_requested");
    const readyToPublish = content.filter((c) => c.production_status === "approved" || c.production_status === "ready");
    const scheduledThisWeek = content.filter((c) => c.publish_date && c.publish_date >= today && c.publish_date <= weekAhead);

    // My priorities: overdue + due today + important, filtered to me when possible.
    const mine = [...overdue, ...dueToday, ...openTasks.filter((t) => t.important)]
      .filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i)
      .filter((t) => !t.assigned_to || t.assigned_to === userId)
      .slice(0, 8);

    // Approval queue for me as reviewer (falls back to broadcasts needs_review).
    const approvalQueue = content
      .filter((c) => c.reviewer_id === userId && c.approval_status === "pending")
      .slice(0, 10);

    // Needs attention: rule-based scan over content.
    const needsAttention: { id: string; title: string; reason: string; kind: "content" | "task" }[] = [];
    for (const c of content) {
      if (c.production_status === "ready" && !c.thumbnail_url) needsAttention.push({ id: c.id, title: c.title || "Untitled", reason: "Missing final asset", kind: "content" });
      if (c.production_status === "ready" && !c.caption) needsAttention.push({ id: c.id, title: c.title || "Untitled", reason: "Missing caption", kind: "content" });
      if (c.production_status === "ready" && !c.cta) needsAttention.push({ id: c.id, title: c.title || "Untitled", reason: "Missing CTA", kind: "content" });
      if (c.production_status === "approved" && !c.publish_date) needsAttention.push({ id: c.id, title: c.title || "Untitled", reason: "Missing publish date", kind: "content" });
      if (!c.assignee_id) needsAttention.push({ id: c.id, title: c.title || "Untitled", reason: "Unassigned content", kind: "content" });
    }
    for (const t of overdue) needsAttention.push({ id: t.id, title: t.title, reason: "Overdue task", kind: "task" });
    for (const t of blockedTasks) needsAttention.push({ id: t.id, title: t.title, reason: "Blocked task", kind: "task" });
    const needsAttentionTop = needsAttention.slice(0, 12);

    return {
      counts: {
        dueToday: dueToday.length,
        overdue: overdue.length,
        awaitingReview: awaitingReview.length,
        changesRequested: changesRequested.length,
        readyToPublish: readyToPublish.length,
        scheduledThisWeek: scheduledThisWeek.length,
        unassigned: unassignedContent.length,
        blocked: blockedTasks.length,
      },
      myPriorities: mine.map((t) => ({
        id: t.id, title: t.title, status: t.status, status_label: t.status_label,
        priority_label: t.priority_label, due_at: t.due_at, important: t.important,
        assignee_name: t.assignee_name, campaign_id: t.campaign_id, linked_content_id: t.linked_content_id,
      })),
      approvalQueue: approvalQueue.map((c) => ({
        id: c.id, title: c.title, content_type: c.content_type, platform: c.platform,
        thumbnail_url: c.thumbnail_url,
      })),
      upcoming: [
        ...content.filter((c) => c.publish_date && c.publish_date >= today)
          .sort((a, b) => (a.publish_date < b.publish_date ? -1 : 1))
          .slice(0, 10)
          .map((c) => ({ id: c.id, title: c.title, date: c.publish_date, kind: "Publish" as const })),
        ...(eventsUpcoming.data ?? []).map((e: any) => ({ id: e.id, title: e.name, date: e.event_date, kind: "Event" as const })),
      ].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 10),
      needsAttention: needsAttentionTop,
      activeCampaigns: [] as { id: string; name: string; owner: string; date_range: string; content_count: number; task_count: number; overdue_count: number; approval_count: number }[],
      recentActivity: (activityRecent.data ?? []) as any[],
      pendingBroadcastReview: broadcastsReview.data ?? [],
    };
  });