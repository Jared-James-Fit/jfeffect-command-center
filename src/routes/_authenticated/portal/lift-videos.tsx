import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Video } from "lucide-react";
import { listLiftVideos, markClientViewed, type LiftVideo } from "@/lib/lift-videos";
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

  const { data: client } = useQuery({
    queryKey: ["my-client-id", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id").eq("user_id", user!.id).maybeSingle();
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

  return (
    <>
      <PageHeader title="Lift Videos" subtitle="Upload your lifts for coach review." />
      <div className="space-y-4 p-6 md:p-8">
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

        <div className="space-y-4">
          {videos.map((v) => (
            <LiftVideoCard
              key={v.id}
              video={v}
              role="client"
              userId={user?.id ?? null}
              onChanged={refresh}
              onEdit={(vid) => { setEditing(vid); setOpen(true); }}
            />
          ))}
        </div>
      </div>

      {client?.id && (
        <LiftVideoDialog
          open={open}
          onOpenChange={setOpen}
          clientId={client.id}
          userId={user?.id ?? null}
          initial={editing}
          onSaved={refresh}
          role="client"
        />
      )}
    </>
  );
}