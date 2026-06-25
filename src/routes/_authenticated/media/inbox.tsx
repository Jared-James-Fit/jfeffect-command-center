import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaHeader } from "@/components/media/media-header";
import { useContentDrawer } from "@/components/media/content-drawer";
import { useAuth } from "@/lib/auth";
import { approveContent, archiveContent, type ContentRecord } from "@/lib/media-content";
import { CheckCircle2, MessageSquare, Archive, AlertCircle, Inbox as InboxIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/media/inbox")({
  component: InboxPage,
});

const CATEGORIES = [
  { id: "needs_review", label: "Needs My Review" },
  { id: "changes_requested", label: "Changes Requested" },
  { id: "mentions", label: "Mentions" },
  { id: "comments", label: "Comments" },
  { id: "new_uploads", label: "New Uploads" },
  { id: "unassigned", label: "Unassigned" },
  { id: "resolved", label: "Resolved" },
] as const;
type CatId = typeof CATEGORIES[number]["id"];

type InboxItem = {
  id: string; kind: string; summary: string; created_at: string;
  content_id: string | null; content?: ContentRecord | null;
  actor_id: string | null; required_action: string;
  unread?: boolean;
};

function InboxPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { open } = useContentDrawer();
  const [cat, setCat] = useState<CatId>("needs_review");

  const { data, isLoading } = useQuery({
    queryKey: ["media-inbox", user?.id],
    enabled: !!user?.id,
    staleTime: 15_000,
    queryFn: async () => {
      const sb = supabase as any;
      const [content, comments, history, notifs] = await Promise.all([
        sb.from("media_content_records").select("*").eq("archived", false).limit(500),
        sb.from("media_content_comments").select("*").order("created_at", { ascending: false }).limit(100),
        sb.from("media_content_review_events").select("*").order("created_at", { ascending: false }).limit(100),
        sb.from("notification_state").select("*").eq("user_id", user!.id).is("archived_at", null).order("created_at", { ascending: false }).limit(200),
      ]);
      const recs: ContentRecord[] = content.data ?? [];
      const recById = new Map(recs.map((r) => [r.id, r]));
      return { recs, recById, comments: comments.data ?? [], history: history.data ?? [], notifs: notifs.data ?? [] };
    },
  });

  const items = useMemo<Record<CatId, InboxItem[]>>(() => {
    const out: Record<CatId, InboxItem[]> = {
      needs_review: [], changes_requested: [], mentions: [], comments: [],
      new_uploads: [], unassigned: [], resolved: [],
    };
    if (!data) return out;
    const { recs, recById, comments, history, notifs } = data as any;
    const readSet = new Set(notifs.filter((n: any) => n.read_at).map((n: any) => `${n.kind}:${n.source_id}`));

    for (const r of recs as ContentRecord[]) {
      const base = {
        id: r.id, content_id: r.id, content: r,
        created_at: r.submitted_at ?? r.updated_at,
        actor_id: r.submitted_by, summary: r.title, kind: "content",
        required_action: "", unread: !readSet.has(`media_content_submitted:${r.id}`),
      };
      if (r.approval_status === "awaiting_review" && (!r.reviewer_id || r.reviewer_id === user?.id)) {
        out.needs_review.push({ ...base, summary: `${r.title} — awaiting your review`, required_action: "Review" });
      }
      if (r.approval_status === "changes_requested") {
        out.changes_requested.push({ ...base, summary: `${r.title} — changes requested`, required_action: "Revise",
          created_at: r.last_change_requested_at ?? r.updated_at });
      }
      if (!r.assignee_id) {
        out.unassigned.push({ ...base, summary: `${r.title} — no assignee`, required_action: "Assign" });
      }
      if (r.approval_status === "approved") {
        out.resolved.push({ ...base, summary: `${r.title} — approved`, required_action: "" });
      }
    }
    for (const c of comments) {
      const rec = recById.get(c.content_id);
      if (!rec) continue;
      out.comments.push({
        id: c.id, content_id: c.content_id, content: rec,
        created_at: c.created_at, actor_id: c.author_id,
        summary: `Comment on ${rec.title}: ${String(c.body).slice(0, 120)}`,
        kind: "comment", required_action: "Reply",
        unread: !readSet.has(`media_content_comment:${c.id}`),
      });
      const mentions = Array.isArray(c.mentions) ? c.mentions : [];
      if (user?.id && mentions.includes(user.id)) {
        out.mentions.push({
          id: c.id, content_id: c.content_id, content: rec,
          created_at: c.created_at, actor_id: c.author_id,
          summary: `You were mentioned on ${rec.title}`,
          kind: "mention", required_action: "Open",
        });
      }
    }
    for (const h of history) {
      const rec = recById.get(h.content_id);
      if (!rec) continue;
      if (h.kind === "submitted") {
        out.new_uploads.push({
          id: h.id, content_id: h.content_id, content: rec,
          created_at: h.created_at, actor_id: h.actor_id,
          summary: `${rec.title} — submitted${h.version ? ` v${h.version}` : ""}`,
          kind: "submission", required_action: "Review",
        });
      }
    }
    return out;
  }, [data, user]);

  const list = items[cat] ?? [];

  const markRead = async (kind: string, source_id: string) => {
    if (!user?.id) return;
    await (supabase as any).from("notification_state").upsert(
      { user_id: user.id, kind, source_id, read_at: new Date().toISOString() },
      { onConflict: "user_id,kind,source_id" });
    qc.invalidateQueries({ queryKey: ["media-inbox"] });
  };

  const approveItem = async (item: InboxItem) => {
    if (!item.content_id) return;
    try { await approveContent(item.content_id); toast.success("Approved"); qc.invalidateQueries({ queryKey: ["media-inbox"] }); qc.invalidateQueries({ queryKey: ["media-content-records"] }); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const archiveItem = async (item: InboxItem) => {
    if (!item.content_id) return;
    try { await archiveContent([item.content_id], true); toast.success("Archived"); qc.invalidateQueries({ queryKey: ["media-inbox"] }); qc.invalidateQueries({ queryKey: ["media-content-records"] }); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <MediaHeader title="Inbox & Approvals" description="Reviews, comments, mentions, and uploads needing your attention." />

      <Tabs value={cat} onValueChange={(v) => setCat(v as CatId)}>
        <TabsList className="flex flex-wrap h-auto justify-start gap-1 bg-muted/40">
          {CATEGORIES.map((c) => {
            const count = items[c.id].length;
            return (
              <TabsTrigger key={c.id} value={c.id} className="gap-1.5">
                {c.label}
                {count > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{count}</Badge>}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="mt-4 space-y-2">
        {isLoading ? <Skeleton className="h-24" /> : list.length === 0 ? (
          <Card className="grid place-items-center gap-2 p-10 text-sm text-muted-foreground">
            <InboxIcon className="h-6 w-6" />
            <span>Nothing here.</span>
          </Card>
        ) : list.map((item) => (
          <Card key={item.id} className="p-3">
            <div className="flex items-start gap-3">
              {item.content?.thumbnail_url && (
                <img src={item.content.thumbnail_url} alt="" className="h-12 w-16 rounded object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {item.unread && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  <span className="truncate font-medium text-sm">{item.summary}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                  {item.content?.campaign_id && <Badge variant="outline" className="text-[10px]">Campaign</Badge>}
                  {item.required_action && <Badge variant="secondary" className="text-[10px]">{item.required_action}</Badge>}
                </div>
                {item.content?.last_change_request && cat === "changes_requested" && (
                  <div className="mt-1 flex items-start gap-1 rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                    <span className="whitespace-pre-wrap">{item.content.last_change_request}</span>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button size="sm" variant="outline" onClick={() => { item.content_id && open(item.content_id); markRead(item.kind, item.id); }}>Open</Button>
                {(cat === "needs_review" || cat === "new_uploads") && (
                  <Button size="sm" onClick={() => approveItem(item)}>
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => archiveItem(item)}>
                  <Archive className="mr-1 h-3 w-3" /> Archive
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
