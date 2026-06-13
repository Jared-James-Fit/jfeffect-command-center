import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { createBroadcastDraft, submitForReview, listMyDrafts } from "@/lib/media-manager.functions";

const TABS = ["drafts", "announcements"] as const;
type Tab = typeof TABS[number];

export const Route = createFileRoute("/_authenticated/media/communication")({
  validateSearch: (s) => z.object({ tab: z.enum(TABS).optional() }).parse(s),
  component: CommunicationWorkspace,
});

function CommunicationWorkspace() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const active: Tab = tab ?? "drafts";
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight">Communication</h1>
        <p className="text-sm text-muted-foreground">Broadcast drafts and announcements pending admin approval.</p>
      </header>
      <Tabs value={active} onValueChange={(v) => navigate({ to: "/media/communication", search: { tab: v as Tab }, replace: true })}>
        <TabsList>
          <TabsTrigger value="drafts">Broadcast Drafts</TabsTrigger>
          <TabsTrigger value="announcements">Announcements</TabsTrigger>
        </TabsList>
        <TabsContent value="drafts" className="mt-4"><DraftsTab /></TabsContent>
        <TabsContent value="announcements" className="mt-4">
          <Card className="p-4 text-sm text-muted-foreground">
            Announcements share the broadcast pipeline. Create an announcement-style draft below and admin will approve before publishing.
          </Card>
          <div className="mt-4"><DraftsTab /></div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DraftsTab() {
  const list = useServerFn(listMyDrafts);
  const create = useServerFn(createBroadcastDraft);
  const submit = useServerFn(submitForReview);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["media-my-drafts", "broadcast"],
    queryFn: () => list({ data: { kind: "broadcast" } }),
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"everyone" | "coaching_clients" | "app_members" | "program_members" | "selected_clients">("everyone");
  const items: any[] = Array.isArray(data) ? data : (data?.items ?? []);

  const submitNew = async () => {
    if (!title.trim()) return toast.error("Title is required");
    try {
      await create({ data: { title, body, audience_scope: scope } });
      setTitle(""); setBody("");
      qc.invalidateQueries({ queryKey: ["media-my-drafts", "broadcast"] });
      toast.success("Draft saved");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-sm">New {kind === "broadcast" ? "Broadcast" : "Announcement"} Draft</h3>
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
        <div className="flex items-center gap-2">
          <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="everyone">Everyone</SelectItem>
              <SelectItem value="coaching_clients">Coaching Clients</SelectItem>
              <SelectItem value="app_members">App Members</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={submitNew}>Save Draft</Button>
        </div>
      </Card>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      <div className="space-y-2">
        {items.map((d: any) => (
          <Card key={d.id} className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{d.title || "Untitled"}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">{d.body}</div>
              </div>
              <Badge variant={d.review_status === "needs_review" ? "default" : "outline"}>{d.review_status}</Badge>
            </div>
            <div className="flex gap-2">
              {d.review_status === "draft" && (
                <Button size="sm" variant="outline" onClick={async () => {
                  try { await submit({ data: { id: d.id, kind: "broadcast" } });
                    qc.invalidateQueries({ queryKey: ["media-my-drafts", "broadcast"] });
                    toast.success("Submitted for review");
                  } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}>Submit for Review</Button>
              )}
            </div>
          </Card>
        ))}
        {!isLoading && items.length === 0 && (
          <div className="text-sm text-muted-foreground">No drafts yet.</div>
        )}
      </div>
    </div>
  );
}