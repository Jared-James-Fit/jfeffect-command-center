import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { createBroadcastDraft, updateBroadcastDraft, submitForReview, listMyDrafts } from "@/lib/media-manager.functions";

export const Route = createFileRoute("/_authenticated/media/broadcasts")({
  component: BroadcastDraftsPage,
});

function BroadcastDraftsPage() {
  const list = useServerFn(listMyDrafts);
  const create = useServerFn(createBroadcastDraft);
  const update = useServerFn(updateBroadcastDraft);
  const submit = useServerFn(submitForReview);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["media-my-drafts", "broadcast"],
    queryFn: () => list({ data: { kind: "broadcast" } }),
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState("everyone");

  async function handleCreate() {
    if (!title.trim()) return toast.error("Title required");
    try {
      await create({ data: { title, body, audience_scope: scope as any } });
      setTitle(""); setBody("");
      qc.invalidateQueries({ queryKey: ["media-my-drafts"] });
      toast.success("Draft created");
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-black tracking-tight">Broadcast Drafts</h1>
        <p className="text-sm text-muted-foreground">Create drafts and submit them to admin for approval.</p>
      </header>

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">New Draft</h2>
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Message body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="everyone">Everyone</SelectItem>
              <SelectItem value="coaching_clients">Coaching Clients</SelectItem>
              <SelectItem value="app_members">App Members</SelectItem>
              <SelectItem value="program_members">Program Members</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleCreate}>Save Draft</Button>
        </div>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">My Drafts</h2>
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && (data?.items?.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">No drafts yet.</div>}
        {data?.items?.map((d: any) => (
          <DraftRow key={d.id} draft={d} onUpdate={update} onSubmit={submit} onChanged={() => qc.invalidateQueries({ queryKey: ["media-my-drafts"] })} />
        ))}
      </section>
    </div>
  );
}

function DraftRow({ draft, onUpdate, onSubmit, onChanged }: any) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(draft.title || "");
  const [body, setBody] = useState(draft.body || "");
  const locked = draft.review_status !== "draft" && draft.review_status !== "needs_review";

  async function save() {
    try { await onUpdate({ data: { id: draft.id, title, body } }); setEditing(false); onChanged(); toast.success("Saved"); }
    catch (e: any) { toast.error(e.message); }
  }
  async function send() {
    try { await onSubmit({ data: { kind: "broadcast", id: draft.id } }); onChanged(); toast.success("Submitted for review"); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          ) : (
            <div className="font-medium truncate">{draft.title || "Untitled"}</div>
          )}
        </div>
        <Badge variant={draft.review_status === "approved" ? "default" : "outline"}>{draft.review_status}</Badge>
      </div>
      {editing ? (
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{draft.body || <span className="italic">(empty)</span>}</p>
      )}
      {draft.review_notes && (
        <p className="text-xs text-amber-600">Admin notes: {draft.review_notes}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {!locked && !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
        {!locked && editing && <Button size="sm" onClick={save}>Save</Button>}
        {draft.review_status === "draft" && <Button size="sm" onClick={send}>Submit for Review</Button>}
      </div>
    </Card>
  );
}