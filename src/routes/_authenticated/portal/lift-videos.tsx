import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Video, ChevronRight, MoreVertical, Pencil, Link2, MessageSquare } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { toast } from "sonner";
import { listLiftVideos, markClientViewed, statusTone, type LiftVideo } from "@/lib/lift-videos";
import { LiftVideoDialog } from "@/components/lift-video-dialog";
import { LiftVideoCard } from "@/components/lift-video-card";

export const Route = createFileRoute("/_authenticated/portal/lift-videos")({
  component: ClientLiftVideos,
});

function ClientLiftVideos() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LiftVideo | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const { data: client } = useQuery({
    queryKey: ["my-client-id", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: videos = [] } = useQuery({
    queryKey: ["lift-videos-client", client?.id],
    enabled: !!client?.id,
    queryFn: () => listLiftVideos({ clientId: client!.id }),
  });

  // Clear bell notifications: mark videos with new coach activity as viewed.
  useEffect(() => {
    if (!videos.length) return;
    const stale = videos.filter((v) => {
      const seen = v.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
      const latest = Math.max(
        v.watched_at ? +new Date(v.watched_at) : 0,
        v.liked_at ? +new Date(v.liked_at) : 0,
        v.reviewed_at ? +new Date(v.reviewed_at) : 0,
      );
      return latest > seen;
    });
    if (!stale.length) return;
    Promise.all(stale.map((v) => markClientViewed(v.id))).catch(() => {});
  }, [videos]);

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

  const openGroup = detailKey ? groups.find((g) => g.key === detailKey) : null;

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
                    userId={user?.id ?? null}
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
          userId={user?.id ?? null}
          initial={editing}
          onSaved={refresh}
          role="client"
        />
      )}
    </>
  );
}