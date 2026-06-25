import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchContent, listComments, listReviewHistory, patchContent,
  submitForReview, requestChanges, approveContent, markPublished, returnToEditing,
  schedulePublish, addComment, archiveContent,
  PRODUCTION_STAGES, STAGE_LABELS, APPROVAL_LABELS, PRIORITY_LABELS,
  type ContentRecord, type ProductionStatus,
} from "@/lib/media-content";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertCircle, Send, MessageSquare, Archive, History, Loader2 } from "lucide-react";

type DrawerCtx = { open: (id: string) => void; close: () => void; openId: string | null };
const Ctx = createContext<DrawerCtx | null>(null);

export function useContentDrawer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ContentDrawerProvider missing");
  return ctx;
}

export function ContentDrawerProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo<DrawerCtx>(() => ({
    open: (id) => setOpenId(id),
    close: () => setOpenId(null),
    openId,
  }), [openId]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ContentDrawer id={openId} onClose={() => setOpenId(null)} />
    </Ctx.Provider>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function ContentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<ContentRecord | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tab, setTab] = useState("overview");
  const [commentBody, setCommentBody] = useState("");
  const [changesNote, setChangesNote] = useState("");

  const recordQ = useQuery({
    queryKey: ["media-content", id],
    queryFn: () => fetchContent(id!),
    enabled: !!id,
    staleTime: 0,
  });

  const commentsQ = useQuery({
    queryKey: ["media-content-comments", id],
    queryFn: () => listComments(id!),
    enabled: !!id,
  });

  const historyQ = useQuery({
    queryKey: ["media-content-history", id],
    queryFn: () => listReviewHistory(id!),
    enabled: !!id,
  });

  useEffect(() => {
    setLocal(recordQ.data ?? null);
    setSaveState("idle");
  }, [recordQ.data]);

  useEffect(() => { if (!id) { setLocal(null); setTab("overview"); } }, [id]);

  const save = useCallback(async (patch: Partial<ContentRecord>) => {
    if (!id || !local) return;
    const next = { ...local, ...patch } as ContentRecord;
    setLocal(next);
    setSaveState("saving");
    try {
      await patchContent(id, patch);
      setSaveState("saved");
      qc.invalidateQueries({ queryKey: ["media-content-records"] });
      qc.invalidateQueries({ queryKey: ["media-content", id] });
    } catch (e: any) {
      setSaveState("error");
      toast.error(e?.message ?? "Save failed");
    }
  }, [id, local, qc]);

  // Debounced field save
  const onField = (key: keyof ContentRecord, value: any) => {
    setLocal((cur) => cur ? { ...cur, [key]: value } : cur);
  };
  const flush = (key: keyof ContentRecord, value: any) => {
    if (!local) return;
    if ((local as any)[key] === value) return;
    save({ [key]: value } as any);
  };

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["media-content-records"] });
    qc.invalidateQueries({ queryKey: ["media-content", id] });
    qc.invalidateQueries({ queryKey: ["media-content-history", id] });
    qc.invalidateQueries({ queryKey: ["media-inbox"] });
  };

  const handleSubmit = async () => {
    try { await submitForReview(id!); toast.success("Submitted for review"); refreshAll(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const handleApprove = async () => {
    try { await approveContent(id!); toast.success("Approved"); refreshAll(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const handleRequestChanges = async () => {
    if (!changesNote.trim()) { toast.error("Add an explanation"); return; }
    try {
      await requestChanges(id!, changesNote);
      toast.success("Changes requested");
      setChangesNote("");
      refreshAll();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const handlePublished = async () => {
    try { await markPublished(id!); toast.success("Marked published"); refreshAll(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const handleReopen = async () => {
    try { await returnToEditing(id!); toast.success("Returned to editing"); refreshAll(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const handleSchedule = async () => {
    if (!local?.publish_date) { toast.error("Set a publish date first"); return; }
    try { await schedulePublish(id!, local.publish_date, local.publish_time); toast.success("Scheduled"); refreshAll(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const handleArchive = async () => {
    try { await archiveContent([id!], true); toast.success("Archived"); refreshAll(); onClose(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const submitComment = async () => {
    if (!commentBody.trim()) return;
    try {
      await addComment(id!, commentBody, local?.current_version ?? null);
      setCommentBody("");
      qc.invalidateQueries({ queryKey: ["media-content-comments", id] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-6">
            <span className="truncate">{local?.title ?? "Content"}</span>
            <SaveBadge state={saveState} />
          </SheetTitle>
        </SheetHeader>

        {!local ? (
          <div className="grid place-items-center p-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{STAGE_LABELS[local.production_status as ProductionStatus] ?? local.production_status}</Badge>
              <Badge variant={local.approval_status === "approved" ? "default" : "secondary"}>
                {APPROVAL_LABELS[local.approval_status as keyof typeof APPROVAL_LABELS] ?? local.approval_status}
              </Badge>
              <Badge variant="outline">v{local.current_version}</Badge>
              {local.priority >= 3 && <Badge variant="destructive">{PRIORITY_LABELS[local.priority]}</Badge>}
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="creative">Creative</TabsTrigger>
                <TabsTrigger value="assets">Assets</TabsTrigger>
                <TabsTrigger value="review">Review</TabsTrigger>
                <TabsTrigger value="collab">Collab</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3 pt-3">
                <div>
                  <Label>Title</Label>
                  <Input value={local.title} onChange={(e) => onField("title", e.target.value)}
                    onBlur={(e) => flush("title", e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FieldSelect label="Production status" value={local.production_status}
                    options={PRODUCTION_STAGES.map((s) => [s, STAGE_LABELS[s]])}
                    onChange={(v) => save({ production_status: v as any })} />
                  <FieldSelect label="Approval status" value={local.approval_status}
                    options={Object.entries(APPROVAL_LABELS)}
                    onChange={(v) => save({ approval_status: v as any })} />
                  <FieldText label="Content type" value={local.content_type ?? ""}
                    onCommit={(v) => flush("content_type", v || null)} />
                  <FieldText label="Platform" value={local.platform ?? ""}
                    onCommit={(v) => flush("platform", v || null)} />
                  <FieldText label="Pillar" value={local.pillar ?? ""}
                    onCommit={(v) => flush("pillar", v || null)} />
                  <FieldSelect label="Priority" value={String(local.priority)}
                    options={[["1","Low"],["2","Normal"],["3","High"],["4","Urgent"]]}
                    onChange={(v) => save({ priority: Number(v) })} />
                  <FieldDate label="Due date" value={local.due_date}
                    onChange={(v) => save({ due_date: v })} />
                  <FieldDate label="Publish date" value={local.publish_date}
                    onChange={(v) => save({ publish_date: v })} />
                  <FieldTime label="Publish time" value={local.publish_time}
                    onChange={(v) => save({ publish_time: v })} />
                  <FieldText label="Thumbnail URL" value={local.thumbnail_url ?? ""}
                    onCommit={(v) => flush("thumbnail_url", v || null)} />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea rows={3} value={local.description ?? ""}
                    onChange={(e) => onField("description", e.target.value)}
                    onBlur={(e) => flush("description", e.target.value || null)} />
                </div>
              </TabsContent>

              <TabsContent value="creative" className="space-y-3 pt-3">
                <FieldArea label="Hook" value={local.hook} onCommit={(v) => flush("hook", v)} />
                <FieldArea label="Script" value={local.script} rows={6} onCommit={(v) => flush("script", v)} />
                <FieldArea label="Caption" value={local.caption} rows={4} onCommit={(v) => flush("caption", v)} />
                <FieldArea label="CTA" value={local.cta} onCommit={(v) => flush("cta", v)} />
                <FieldArea label="Internal notes" value={local.internal_notes} rows={3}
                  onCommit={(v) => flush("internal_notes", v)} />
                <div>
                  <Label>Reference links (one per line)</Label>
                  <Textarea rows={3} defaultValue={(local.reference_links ?? []).join("\n")}
                    onBlur={(e) => {
                      const links = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                      flush("reference_links", links as any);
                    }} />
                </div>
              </TabsContent>

              <TabsContent value="assets" className="space-y-2 pt-3">
                <p className="text-sm text-muted-foreground">
                  Linked asset IDs: {(local.linked_asset_ids ?? []).length || "none"}.
                </p>
                <p className="text-xs text-muted-foreground">
                  Use the Asset Library to attach raw footage, final edits, images, audio, and documents.
                </p>
                <div>
                  <Label>Shared links (one per line)</Label>
                  <Textarea rows={3} defaultValue={(local.reference_links ?? []).join("\n")}
                    onBlur={(e) => {
                      const links = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                      flush("reference_links", links as any);
                    }} />
                </div>
              </TabsContent>

              <TabsContent value="review" className="space-y-3 pt-3">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleSubmit} disabled={local.approval_status === "awaiting_review"}>
                    <Send className="mr-1.5 h-4 w-4" /> Submit for Review
                  </Button>
                  <Button size="sm" variant="default" onClick={handleApprove}
                    disabled={local.approval_status !== "awaiting_review"}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleSchedule}
                    disabled={local.approval_status !== "approved"}>Schedule</Button>
                  <Button size="sm" variant="outline" onClick={handlePublished}>Mark Published</Button>
                  <Button size="sm" variant="ghost" onClick={handleReopen}>Return to Editing</Button>
                </div>
                {local.last_change_request && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                    <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200">
                      <AlertCircle className="h-4 w-4" /> Changes requested
                    </div>
                    <p className="whitespace-pre-wrap">{local.last_change_request}</p>
                  </div>
                )}
                <div>
                  <Label>Request changes (explanation required)</Label>
                  <Textarea rows={3} value={changesNote} onChange={(e) => setChangesNote(e.target.value)} />
                  <Button size="sm" variant="outline" className="mt-2" onClick={handleRequestChanges}
                    disabled={local.approval_status !== "awaiting_review"}>
                    Request Changes
                  </Button>
                </div>
                <Separator />
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4" /> Review history</h4>
                  <ul className="space-y-1.5 text-xs">
                    {(historyQ.data ?? []).map((h: any) => (
                      <li key={h.id} className="rounded border p-2">
                        <div className="font-medium capitalize">{h.kind.replace(/_/g, " ")} {h.version ? `· v${h.version}` : ""}</div>
                        <div className="text-muted-foreground">{new Date(h.created_at).toLocaleString()}</div>
                        {h.notes && <div className="mt-1 whitespace-pre-wrap">{h.notes}</div>}
                      </li>
                    ))}
                    {(historyQ.data ?? []).length === 0 && (
                      <li className="text-muted-foreground">No review events yet.</li>
                    )}
                  </ul>
                </div>
              </TabsContent>

              <TabsContent value="collab" className="space-y-3 pt-3">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="h-4 w-4" /> Comments</h4>
                <ul className="space-y-2">
                  {(commentsQ.data ?? []).map((c: any) => (
                    <li key={c.id} className="rounded border p-2 text-sm">
                      <div className="text-xs text-muted-foreground">
                        {new Date(c.created_at).toLocaleString()}{c.version ? ` · v${c.version}` : ""}
                      </div>
                      <p className="whitespace-pre-wrap">{c.body}</p>
                    </li>
                  ))}
                  {(commentsQ.data ?? []).length === 0 && (
                    <li className="text-sm text-muted-foreground">No comments yet.</li>
                  )}
                </ul>
                <Textarea rows={3} value={commentBody} onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Add a comment…" />
                <Button size="sm" onClick={submitComment}>Post comment</Button>
              </TabsContent>
            </Tabs>

            <Separator />
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={handleArchive}>
                <Archive className="mr-1.5 h-4 w-4" /> Archive
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "saving") return <Badge variant="secondary" className="text-xs">Saving…</Badge>;
  if (state === "saved") return <Badge variant="secondary" className="text-xs">Saved</Badge>;
  if (state === "error") return <Badge variant="destructive" className="text-xs">Failed to Save</Badge>;
  return null;
}

function FieldText({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <Label>{label}</Label>
      <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)} />
    </div>
  );
}
function FieldArea({ label, value, rows = 3, onCommit }: { label: string; value: string | null; rows?: number; onCommit: (v: string | null) => void }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <div>
      <Label>{label}</Label>
      <Textarea rows={rows} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v || null)} />
    </div>
  );
}
function FieldDate({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
    </div>
  );
}
function FieldTime({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="time" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
    </div>
  );
}
function FieldSelect({ label, value, options, onChange }:
  { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}