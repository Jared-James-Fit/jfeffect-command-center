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

// Phase 4A — the underlying broadcast model has no distinction between
// drafts and announcements (both read from the same listMyDrafts source),
// so the duplicate Announcements tab was removed. The /media/announcements
// route now redirects here (see announcements.tsx) and the old
// ?tab=announcements query param is treated as "drafts".
const TABS = ["drafts"] as const;
type Tab = typeof TABS[number];

export const Route = createFileRoute("/_authenticated/media/communication")({
  validateSearch: (s) =>
    z
      .object({
        // Accept the legacy "announcements" value but normalise to "drafts"
        // so old bookmarks keep working without showing a duplicate tab.
        tab: z.enum(["drafts", "announcements"]).optional(),
      })
      .parse(s),
  component: CommunicationWorkspace,
});

function CommunicationWorkspace() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  // Always normalise to the single supported tab.
  const active: Tab = "drafts";
  // If the URL still carries ?tab=announcements, rewrite it once.
  if (tab === "announcements" && typeof window !== "undefined") {
    navigate({ to: "/media/communication", search: { tab: "drafts" }, replace: true });
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight">Communication</h1>
        <p className="text-sm text-muted-foreground">
          Broadcast drafts pending admin approval.
        </p>
      </header>
      <Tabs value={active} onValueChange={() => { /* single tab */ }}>
        <TabsList>
          <TabsTrigger value="drafts">Broadcast Drafts</TabsTrigger>
        </TabsList>
        <TabsContent value="drafts" className="mt-4"><DraftsTab /></TabsContent>
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
        <h3 className="font-semibold text-sm">New Draft</h3>
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