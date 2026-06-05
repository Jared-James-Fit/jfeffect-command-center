import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Video, ChevronRight, MoreVertical, Pencil, Link2, MessageSquare, Trash2 } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { toast } from "sonner";
import { listLiftVideos, markClientViewed, statusTone, deleteLiftVideos, type LiftVideo } from "@/lib/lift-videos";
import { LiftVideoDialog } from "@/components/lift-video-dialog";
import { LiftVideoCard } from "@/components/lift-video-card";

export const Route = createFileRoute("/_authenticated/portal/lift-videos")({
  component: ClientLiftVideos,
});

function ClientLiftVideos() {
  const portalUserId = usePortalUserId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LiftVideo | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const { data: client } = useQuery({
    queryKey: ["my-client-id", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle();
      return data;
    },
  });

  const { data: videos = [] } = useQuery({
    queryKey: ["lift-videos-client", client?.id],
    enabled: !!client?.id,
    queryFn: () => listLiftVideos({ clientId: client!.id }),
  });

  // Mark only the clips inside the opened detail dialog as viewed — opening
  // the list alone should NOT clear unread feedback badges.
  useEffect(() => {
    if (!detailKey) return;
    const group = groupsRef.current.find((g) => g.key === detailKey);
    if (!group) return;
    Promise.all(group.clips.map((v) => markClientViewed(v.id))).catch(() => {});
  }, [detailKey]);

  useEffect(() => {
    if (!client?.id) return;
    const ch = supabase
      .channel(`lift-videos-${client.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos", filter: `client_id=eq.${client.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["lift-videos-client", client.id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_video_comments", filter: `client_id=eq.${client.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["lift-videos-client", client.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [client?.id, qc]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["lift-videos-client", client?.id] });

  // Group by batch_id; standalone videos get their own group keyed by id.
  const groups = useMemo(() => {
    const map = new Map<string, LiftVideo[]>();
    for (const v of videos) {
      const key = v.batch_id ?? v.id;
      const arr = map.get(key) ?? [];
      arr.push(v);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([key, clips]) => {
        const sorted = [...clips].sort((a, b) => (a.batch_index ?? 0) - (b.batch_index ?? 0));
        const head = sorted[0];
        const latest = sorted.reduce((acc, c) => (c.created_at > acc.created_at ? c : acc), head);
        return { key, clips: sorted, head, latest };
      })
      .sort((a, b) => (a.latest.created_at < b.latest.created_at ? 1 : -1));
  }, [videos]);

  // Keep a ref to current groups so the "mark viewed on open" effect can read
  // them without re-running every time the videos list re-fetches.
  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  const openGroup = detailKey ? groups.find((g) => g.key === detailKey) : null;

  const allSelected = groups.length > 0 && groups.every((g) => selected.has(g.key));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(groups.map((g) => g.key)));
  };
  const doDelete = async () => {
    const ids: string[] = [];
    for (const g of groups) if (selected.has(g.key)) ids.push(...g.clips.map((c) => c.id));
    if (!ids.length) return;
    setDeleting(true);
    try {
      await deleteLiftVideos(ids);
      toast.success(`Deleted ${selected.size} submission${selected.size === 1 ? "" : "s"}`);
      setSelected(new Set());
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  function feedbackLabel(clips: LiftVideo[]) {
    if (clips.some((c) => c.status === "Needs Follow-Up")) return "Needs Follow-Up";
    if (clips.some((c) => c.status === "Reviewed")) return "Reviewed by Jared";
    if (clips.some((c) => c.status === "Commented" || c.reviewed_at)) return "Feedback Added";
    if (clips.some((c) => c.status === "Watched")) return "Watched";
    return "Awaiting Review";
  }

  return (
    <>
      <PageHeader title="Lift Videos" subtitle="Upload your lifts for coach review." />
      <div className="space-y-4 p-6 pb-32 md:p-8 md:pb-32">
        <Card className="border-border bg-card p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Video className="h-6 w-6 text-primary" />
            <div>
              <div className="font-bold">Submit a lift video</div>
              <div className="text-xs text-muted-foreground">Attach a video link or upload a file from your phone.</div>
            </div>
          </div>
          <Button className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }} disabled={!client?.id}>
            <Plus className="mr-1 h-4 w-4" /> Upload Lift Video
          </Button>
        </Card>

        {!client && (
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
            Your coach hasn't set up your profile yet. Uploads will be available once they do.
          </Card>
        )}

        {client && videos.length === 0 && (
          <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No lift videos yet. Tap "Upload Lift Video" to send your first one.
          </Card>
        )}

        {groups.length > 0 && (
          <Card className="border-border bg-card p-3 flex items-center gap-3">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={toggleAll}
              aria-label="Select all"
            />
            <div className="text-sm">Select all</div>
            <div className="ml-auto flex items-center gap-2">
              <div className="text-xs text-muted-foreground">{selected.size} selected</div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" disabled={selected.size === 0 || deleting}>
                    <Trash2 className="mr-1 h-4 w-4" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selected.size} submission{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
                    <AlertDialogDescription>This removes them from your app. Videos in Google Drive are not affected.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </Card>
        )}

        {groups.length > 0 && (
          <div className="text-xs text-muted-foreground px-1">Lift videos auto-clear from your app after 14 days. Coach Jared keeps the originals.</div>
        )}

        <div className="space-y-2">
          {groups.map((g) => {
            const v = g.head;
            const count = g.clips.length;
            const fb = feedbackLabel(g.clips);
            const noteSnippet = (v.batch_note ?? v.client_notes ?? "").trim();
            const reviewed = fb !== "Awaiting Review" && fb !== "Watched";
            const canEdit = count === 1 && !v.reviewed_at;
            return (
              <Card
                key={g.key}
                className="cursor-pointer border-border bg-card p-3 transition hover:border-primary/50"
                onClick={() => setDetailKey(g.key)}
              >
                <div className="flex items-center gap-3">
                  <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <Checkbox
                      checked={selected.has(g.key)}
                      onCheckedChange={() => toggleOne(g.key)}
                      aria-label="Select submission"
                    />
                  </div>
                  <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-secondary">
                    {v.thumbnail_url ? (
                      <img src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-muted-foreground">
                        <Video className="h-5 w-5" />
                      </div>
                    )}
                    {count > 1 && (
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-background/80 px-1 text-[10px] font-bold">×{count}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-semibold">{v.exercise || "Lift video"}</div>
                      {v.is_urgent && <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-300">Urgent</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      Uploaded {formatDistanceToNow(parseISO(v.created_at), { addSuffix: true })}
                      {count > 1 ? ` · ${count} clips` : ""}
                    </div>
                    {noteSnippet && (
                      <div className="mt-1 line-clamp-1 text-xs text-muted-foreground/90">{noteSnippet}</div>
                    )}
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge variant="outline" className={statusTone(reviewed ? "Reviewed" : "Awaiting Review")}>
                        {fb}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-8" onClick={(e) => { e.stopPropagation(); setDetailKey(g.key); }}>
                      {reviewed ? (<><MessageSquare className="mr-1 h-3.5 w-3.5" /> View Feedback</>) : (<>View <ChevronRight className="ml-0.5 h-3.5 w-3.5" /></>)}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        {canEdit && (
                          <DropdownMenuItem onClick={() => { setEditing(v); setOpen(true); }}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit note
                          </DropdownMenuItem>
                        )}
                        {v.video_url && (
                          <DropdownMenuItem
                            onClick={async () => {
                              try { await navigator.clipboard.writeText(v.video_url!); toast.success("Link copied"); }
                              catch { toast.error("Couldn't copy link"); }
                            }}
                          >
                            <Link2 className="mr-2 h-4 w-4" /> Copy link
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={!!openGroup} onOpenChange={(o) => { if (!o) setDetailKey(null); }}>
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {openGroup?.head.exercise || "Lift video"}
              {openGroup && openGroup.clips.length > 1 ? ` · ${openGroup.clips.length} clips` : ""}
            </DialogTitle>
          </DialogHeader>
          {openGroup && (
            <div className="space-y-4">
              {openGroup.clips.map((clip, i) => (
                <div key={clip.id}>
                  {openGroup.clips.length > 1 && (
                    <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Clip {i + 1}</div>
                  )}
                  <LiftVideoCard
                    video={clip}
                    role="client"
                    userId={portalUserId ?? null}
                    onChanged={refresh}
                    onEdit={(vid) => { setEditing(vid); setOpen(true); setDetailKey(null); }}
                  />
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {client?.id && (
        <LiftVideoDialog
          open={open}
          onOpenChange={setOpen}
          clientId={client.id}
          clientName={(client as any).full_name}
          userId={portalUserId ?? null}
          initial={editing}
          onSaved={refresh}
          role="client"
        />
      )}
    </>
  );
}