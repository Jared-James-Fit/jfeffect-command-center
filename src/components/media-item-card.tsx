import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ExternalLink, MessageSquare, Heart, Eye, CheckCircle2, AlertTriangle, Send, Lock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  COMMENT_TYPES, MEDIA_STATUSES, addComment, fmtTimestamp, listMediaComments,
  markAdminViewed, markClientViewed, markLiked, markWatched, setMediaStatus, statusTone,
  type MediaStatus,
} from "@/lib/media";

export function MediaItemCard({
  item, role, userId, onChanged,
}: {
  item: any;
  role: "admin" | "client";
  userId: string | null;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ts, setTs] = useState<string>("");
  const [body, setBody] = useState("");
  const [ctype, setCtype] = useState<string>("General");
  const [internal, setInternal] = useState(false);

  const { data: comments = [] } = useQuery({
    queryKey: ["media-comments", item.id],
    queryFn: () => listMediaComments(item.id),
  });

  useEffect(() => {
    if (!userId) return;
    if (role === "admin") markAdminViewed(item.id).catch(() => {});
    else markClientViewed(item.id).catch(() => {});
  }, [item.id, role, userId]);

  useEffect(() => {
    const ch = supabase.channel(`media-${item.id}`).on("postgres_changes",
      { event: "*", schema: "public", table: "media_comments", filter: `media_item_id=eq.${item.id}` },
      () => qc.invalidateQueries({ queryKey: ["media-comments", item.id] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [item.id, qc]);

  function parseTs(v: string): number | null {
    if (!v.trim()) return null;
    const parts = v.split(":").map(Number);
    if (parts.some((n) => isNaN(n))) return null;
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  async function sendComment() {
    if (!body.trim() || !userId) return;
    try {
      await addComment({
        mediaItemId: item.id, clientId: item.client_id, authorId: userId, authorRole: role,
        body: body.trim(), timestampSeconds: parseTs(ts), commentType: ctype, isInternal: internal,
      });
      setBody(""); setTs(""); setInternal(false);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
  }

  const isVideo = item.mime_type?.startsWith("video/");
  const isImage = item.mime_type?.startsWith("image/");

  async function changeStatus(s: MediaStatus) {
    if (!userId) return;
    try { await setMediaStatus(item.id, s, userId); onChanged?.(); } catch (e: any) { toast.error(e?.message); }
  }

  return (
    <Card className="border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold truncate">{item.file_name || item.media_type}</span>
            <Badge variant="outline">{item.media_type}</Badge>
            <Badge variant="outline" className={statusTone(item.status)}>{item.status}</Badge>
            {item.urgent_flag && <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-300"><AlertTriangle className="mr-1 h-3 w-3" />Urgent</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            Uploaded {format(parseISO(item.created_at), "MMM d, yyyy · h:mma")}
          </div>
        </div>
        {item.drive_url && (
          <Button asChild size="sm" variant="ghost"><a href={item.drive_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3" /></a></Button>
        )}
      </div>

      {item.drive_file_id && (
        <div className="overflow-hidden rounded border border-border bg-black/40">
          {isImage ? (
            <img src={item.thumbnail_url ?? `https://drive.google.com/uc?id=${item.drive_file_id}`} alt={item.file_name} className="w-full max-h-[60vh] object-contain" />
          ) : (
            <iframe
              ref={iframeRef}
              src={item.drive_embed_url}
              className="aspect-video w-full"
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
            />
          )}
        </div>
      )}

      {item.clip_note && (
        <div className="rounded border border-border bg-secondary/30 p-2 text-sm">
          <div className="text-[10px] uppercase text-muted-foreground">Client note</div>
          {item.clip_note}
        </div>
      )}
      {item.pain_note && (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 p-2 text-sm">
          <div className="text-[10px] uppercase text-rose-300">Pain / discomfort</div>
          {item.pain_note}
        </div>
      )}

      {role === "admin" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select value={item.status} onValueChange={(v) => changeStatus(v as MediaStatus)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{MEDIA_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={async () => { if (userId) { await markWatched(item.id, userId); onChanged?.(); } }}><Eye className="mr-1 h-3 w-3" />Watched</Button>
          <Button size="sm" variant="outline" onClick={async () => { if (userId) { await markLiked(item.id, userId); onChanged?.(); } }}><Heart className="mr-1 h-3 w-3" />Like</Button>
          <Button size="sm" variant="outline" onClick={() => changeStatus("Reviewed")}><CheckCircle2 className="mr-1 h-3 w-3" />Mark reviewed</Button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MessageSquare className="h-3 w-3" /> Coach feedback ({comments.length})
        </div>
        <div className="space-y-2">
          {comments.map((c: any) => (
            <div key={c.id} className={`rounded border p-2 text-sm ${c.is_internal_note ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-secondary/30"}`}>
              <div className="flex items-center gap-2 text-[10px] uppercase text-muted-foreground">
                {c.video_timestamp_seconds != null && (
                  <span className="font-bold text-primary">{fmtTimestamp(c.video_timestamp_seconds)}</span>
                )}
                <span>{c.author_role === "admin" ? "Coach" : "Client"}</span>
                <span>· {c.comment_type}</span>
                {c.is_internal_note && <span className="flex items-center gap-1 text-amber-300"><Lock className="h-3 w-3" /> Internal</span>}
              </div>
              <div className="mt-1 whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
          {comments.length === 0 && <div className="text-xs text-muted-foreground">No feedback yet.</div>}
        </div>

        <div className="rounded border border-border bg-card p-2 space-y-2">
          {role === "admin" && isVideo && (
            <div className="flex items-center gap-2">
              <Input className="h-8 w-24 text-xs" placeholder="0:00" value={ts} onChange={(e) => setTs(e.target.value)} />
              <Select value={ctype} onValueChange={setCtype}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{COMMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <label className="ml-auto flex items-center gap-2 text-xs">Internal <Switch checked={internal} onCheckedChange={setInternal} /></label>
            </div>
          )}
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={role === "admin" ? "Add coach feedback…" : "Reply to coach…"} />
          <div className="flex justify-end">
            <Button size="sm" onClick={sendComment} disabled={!body.trim()}><Send className="mr-1 h-3 w-3" />Send</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}