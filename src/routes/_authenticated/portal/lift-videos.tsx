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
import { ActionButton } from "@/components/action-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Video, ChevronRight, MoreVertical, Pencil, Link2, Trash2, Settings2 } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { toast } from "sonner";
import { listLiftVideos, markClientViewed, statusTone, deleteLiftVideos, type LiftVideo } from "@/lib/lift-videos";
import { LiftVideoDialog } from "@/components/lift-video-dialog";
import { LiftVideoCard } from "@/components/lift-video-card";
import { ClientLiftVideoUploader } from "@/components/client-lift-video-uploader";
import { useLiftUploadActiveCount, useLiftUploadState } from "@/lib/lift-upload-queue";
import { useBlocker } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

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
  const [manageMode, setManageMode] = useState(false);

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
    // Live upload states take priority over normal status labels so the
    // client sees instant feedback while the file is still moving.
    if (clips.some((c) => c.upload_status === "Uploading")) return "Uploading — stay on screen";
    if (clips.some((c) => c.upload_status === "Upload Failed")) return "Upload Failed";
    if (clips.some((c) => c.status === "Needs Follow-Up")) return "Needs Follow-Up";
    if (clips.some((c) => c.status === "Reviewed")) return "Reviewed by Jared";
    if (clips.some((c) => c.status === "Commented" || c.reviewed_at)) return "Feedback Added";
    if (clips.some((c) => c.status === "Watched")) return "Watched";
    return "Awaiting Review";
  }

  return (
    <>
      <PageHeader title="Lift Videos" subtitle="Send lifts for coach review." />
      <UploadGuard />
      <div className="space-y-4 p-6 pb-32 md:p-8 md:pb-32">
        {!client && (
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
            Your coach hasn't set up your profile yet. Uploads will be available once they do.
          </Card>
        )}

        {client && (
          <ClientLiftVideoUploader
            clientId={client.id}
            clientName={(client as any).full_name}
            userId={portalUserId ?? null}
            onSaved={refresh}
          />
        )}

        {client && videos.length === 0 && (
          <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No lift videos yet. Upload your first lift above.
          </Card>
        )}

        {groups.length > 0 && (
          <div className="flex items-center justify-between px-1">
            <div className="text-xs text-muted-foreground">
              {groups.length} submission{groups.length === 1 ? "" : "s"}
            </div>
            {!manageMode ? (
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                onClick={() => setManageMode(true)}
              >
                <Settings2 className="h-3 w-3" /> Manage
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={toggleAll}
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="destructive" className="h-7" disabled={selected.size === 0 || deleting}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete{selected.size > 0 ? ` (${selected.size})` : ""}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {selected.size} submission{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
                      <AlertDialogDescription>This removes them from your app. Videos in Google Drive are not affected.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <ActionButton
                        onAction={doDelete}
                        loadingLabel="Deleting…"
                        successLabel="Deleted"
                        successToast={false}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </ActionButton>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setManageMode(false); setSelected(new Set()); }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          {groups.map((g) => {
            const v = g.head;
            const count = g.clips.length;
            const fb = feedbackLabel(g.clips);
            const isUploading = fb.startsWith("Uploading");
            const uploadFailed = fb === "Upload Failed";
            const reviewed = !isUploading && !uploadFailed && fb !== "Awaiting Review" && fb !== "Watched";
            const canEdit = count === 1 && !v.reviewed_at;
            return (
              <Card
                key={g.key}
                className="cursor-pointer border-border bg-card p-3 rounded-2xl transition hover:border-primary/50 active:scale-[0.99]"
                onClick={() => setDetailKey(g.key)}
              >
                <div className="flex items-center gap-3">
                  {manageMode && (
                    <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                      <Checkbox
                        checked={selected.has(g.key)}
                        onCheckedChange={() => toggleOne(g.key)}
                        aria-label="Select submission"
                      />
                    </div>
                  )}
                  <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-secondary">
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
                      <div className="truncate text-sm font-semibold">
                        {v.exercise || (count > 1 ? `Lift videos · ${count}` : "Lift video")}
                      </div>
                      {v.is_urgent && <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-400 text-[10px] px-1.5 py-0">Urgent</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {formatDistanceToNow(parseISO(v.created_at), { addSuffix: true })}
                    </div>
                    <div className="mt-1.5">
                      <Badge
                        variant="outline"
                        className={`${
                          uploadFailed
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : isUploading
                              ? "border-blue-500/40 bg-blue-500/10 text-blue-600"
                              : statusTone(reviewed ? "Reviewed" : "Awaiting Review")
                        } text-[10px] px-1.5 py-0`}
                      >
                        {fb}
                      </Badge>
                    </div>
                    {isUploading && (
                      <div className="mt-1.5 space-y-1">
                        {g.clips.map((c) => (
                          <ClipUploadRow key={c.id} videoId={c.id} fallbackName={c.exercise || c.client_notes?.slice(0, 30) || `Clip ${c.batch_index ?? ""}`} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setDetailKey(g.key); }}>
                      {reviewed ? "Feedback" : "View"}
                      <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
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
                        {!manageMode && (
                          <DropdownMenuItem onClick={() => { setManageMode(true); setSelected(new Set([g.key])); }} className="text-destructive focus:text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
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

/* ------------------------- Background upload UI ------------------------- */

function UploadGuard() {
  const active = useLiftUploadActiveCount();
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Your video is still uploading. Leaving now may cancel the upload.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);

  // Block in-app navigation (TanStack Router) with a confirm dialog when
  // any clip is still uploading. iPhone PWAs background-suspend tabs quickly
  // and can kill the XHR — staying on this screen is the only reliable path.
  const { status, proceed, reset } = useBlocker({
    shouldBlockFn: () => active > 0,
    withResolver: true,
  });

  if (!active && status !== "blocked") return null;

  return (
    <>
      {active > 0 && (
        <div className="sticky top-0 z-40 border-b-2 border-amber-500/50 bg-amber-500/15 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-sm font-bold text-amber-700 dark:text-amber-400">
                Do Not Leave This Screen
              </div>
              <div className="text-xs text-foreground/80">
                {active} clip{active === 1 ? "" : "s"} uploading. Do not close the app, lock your phone, or switch apps until all clips say <span className="font-semibold">Awaiting Review</span>.
              </div>
            </div>
          </div>
        </div>
      )}
      <AlertDialog open={status === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Upload still in progress
            </AlertDialogTitle>
            <AlertDialogDescription>
              Leaving now may cancel your video upload. Stay on this screen until it finishes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => reset?.()}>Stay Here</AlertDialogAction>
            <AlertDialogCancel onClick={() => proceed?.()} className="text-muted-foreground">
              Leave Anyway
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ClipUploadRow({ videoId, fallbackName }: { videoId: string; fallbackName: string }) {
  const state = useLiftUploadState(videoId);
  if (!state) return null;
  const name = state.fileName || fallbackName;
  if (state.status === "failed") {
    return (
      <div className="text-[10px] text-destructive truncate">
        Upload Failed — {state.error}. Please retry and stay on the screen.
      </div>
    );
  }
  const label =
    state.status === "uploading" ? `${state.progress}% — stay on screen` :
    state.status === "queued" ? "Queued — stay on screen" :
    "Uploaded";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">{name}</span>
        <span className={state.status !== "done" ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>{label}</span>
      </div>
      <Progress value={state.status === "done" ? 100 : state.progress} className="h-1" />
    </div>
  );
}