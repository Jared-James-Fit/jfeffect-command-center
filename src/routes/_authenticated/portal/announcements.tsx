import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { listHistoryBroadcastsForUser, listSeenIdsForUser } from "@/lib/broadcasts";
import { BroadcastVoicePlayer, BroadcastVideoPlayer } from "@/components/broadcast-media-player";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/portal/announcements")({ component: PortalAnnouncements });

function PortalAnnouncements() {
  const { user } = useAuth();
  const userId = user?.id;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["broadcasts-history", userId],
    enabled: !!userId,
    queryFn: () => listHistoryBroadcastsForUser(),
  });
  const { data: seen = new Set<string>() } = useQuery({
    queryKey: ["broadcasts-seen", userId],
    enabled: !!userId,
    queryFn: () => listSeenIdsForUser(userId!),
  });

  return (
    <>
      <PageHeader title="Announcements" subtitle="Messages, quotes, and updates from your coach." />
      <div className="space-y-3 p-4 md:p-6">
        {isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : rows.length === 0 ? (
          <Card className="p-12 text-center">
            <Megaphone className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No announcements yet.</p>
          </Card>
        ) : (
          rows.map((b) => (
            <Card key={b.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-base font-bold">{b.title}</span>
                    <Badge variant="outline" className="text-[10px]">{b.type}</Badge>
                    {!seen.has(b.id) && <Badge className="bg-primary text-primary-foreground text-[10px]">New</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{format(new Date(b.publish_at), "MMM d, yyyy h:mm a")}</div>
                </div>
              </div>
              {b.body && (
                <p className={b.type === "Quote" ? "text-base italic text-foreground/80" : "whitespace-pre-wrap text-sm leading-relaxed"}>
                  {b.body}
                </p>
              )}
              {b.type === "Voice Message" && <BroadcastVoicePlayer voicePath={b.voice_path} transcript={b.transcript} />}
              {b.type === "Video" && <BroadcastVideoPlayer videoPath={b.video_path} videoUrl={b.video_url} />}
              {b.link_url && (
                <a href={b.link_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                  {b.link_label || b.link_url}
                </a>
              )}
            </Card>
          ))
        )}
      </div>
    </>
  );
}