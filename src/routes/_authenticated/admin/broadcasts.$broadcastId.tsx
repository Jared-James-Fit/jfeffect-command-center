import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { getBroadcast, getBroadcastSeenList, effectiveStatus, statusTone, BROADCAST_AUDIENCE_LABELS } from "@/lib/broadcasts";
import { BroadcastVoicePlayer, BroadcastVideoPlayer } from "@/components/broadcast-media-player";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/broadcasts/$broadcastId")({
  component: AdminBroadcastDetail,
});

function AdminBroadcastDetail() {
  const { broadcastId } = Route.useParams();
  const { data: b } = useQuery({ queryKey: ["admin-broadcast", broadcastId], queryFn: () => getBroadcast(broadcastId) });
  const { data: seen = [] } = useQuery({ queryKey: ["admin-broadcast-seen", broadcastId], queryFn: () => getBroadcastSeenList(broadcastId) });

  if (!b) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const eff = effectiveStatus(b);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/admin/broadcasts"><ArrowLeft className="mr-1 h-4 w-4" /> All Broadcasts</Link>
      </Button>

      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{b.title}</h1>
          <Badge variant="outline">{b.type}</Badge>
          <Badge variant="outline" className={statusTone(eff)}>{eff}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          To {BROADCAST_AUDIENCE_LABELS[b.audience_scope]} · publish {format(new Date(b.publish_at), "MMM d, yyyy h:mm a")}
          {b.expires_at && <> · expires {format(new Date(b.expires_at), "MMM d, yyyy h:mm a")}</>}
        </div>
        {b.body && <p className="whitespace-pre-wrap text-sm leading-relaxed">{b.body}</p>}
        {b.type === "Voice Message" && <BroadcastVoicePlayer voicePath={b.voice_path} transcript={b.transcript} />}
        {b.type === "Video" && <BroadcastVideoPlayer videoPath={b.video_path} videoUrl={b.video_url} />}
        {b.link_url && (
          <a href={b.link_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
            {b.link_label || b.link_url}
          </a>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Seen</h2>
          <Badge variant="outline">{seen.length} marked complete</Badge>
        </div>
        {seen.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one has tapped "Got it" yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {seen.map((s) => (
              <li key={s.user_id} className="flex items-center justify-between py-2">
                <span className="font-mono text-xs">{s.user_id.slice(0, 8)}…</span>
                <span className="text-xs text-muted-foreground">{format(new Date(s.got_it_at), "MMM d, h:mm a")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}