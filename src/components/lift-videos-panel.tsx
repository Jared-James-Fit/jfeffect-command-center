import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Video } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { listLiftVideos, type LiftVideo } from "@/lib/lift-videos";
import { LiftVideoCard } from "@/components/lift-video-card";
import { LiftVideoDialog } from "@/components/lift-video-dialog";

export function LiftVideosPanel({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LiftVideo | null>(null);

  const { data: videos = [] } = useQuery({
    queryKey: ["lift-videos-client-profile", clientId],
    queryFn: () => listLiftVideos({ clientId }),
  });

  useEffect(() => {
    const ch = supabase
      .channel(`lift-videos-profile-${clientId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos", filter: `client_id=eq.${clientId}` }, () => {
        qc.invalidateQueries({ queryKey: ["lift-videos-client-profile", clientId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_video_comments", filter: `client_id=eq.${clientId}` }, () => {
        qc.invalidateQueries({ queryKey: ["lift-videos-client-profile", clientId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [clientId, qc]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["lift-videos-client-profile", clientId] });

  return (
    <div className="md:col-span-3 space-y-4">
      <Card className="border-border bg-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Video className="h-5 w-5 text-primary" />
          <div>
            <div className="font-bold">Lift Videos</div>
            <div className="text-xs text-muted-foreground">{videos.length} submitted</div>
          </div>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-1 h-3 w-3" /> Upload for client
        </Button>
      </Card>

      {videos.length === 0 && (
        <Card className="border-border bg-card p-8 text-center text-sm text-muted-foreground">No lift videos yet.</Card>
      )}

      <div className="space-y-4">
        {videos.map((v) => (
          <LiftVideoCard
            key={v.id}
            video={v}
            role="admin"
            userId={user?.id ?? null}
            onChanged={refresh}
            onEdit={(vid) => { setEditing(vid); setOpen(true); }}
          />
        ))}
      </div>

      <LiftVideoDialog
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        userId={user?.id ?? null}
        initial={editing}
        onSaved={refresh}
      />
    </div>
  );
}