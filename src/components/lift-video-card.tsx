import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  type LiftVideo, type LiftVideoComment,
  LIFT_VIDEO_STATUSES, statusTone, clientFacingStatus,
  listComments, addComment, markWatched, toggleLike, markReviewed, setStatus,
  getSignedVideoUrl, deleteLiftVideo,
  isYouTube, isDrive, youTubeEmbed, drivePreview,
} from "@/lib/lift-videos";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import {
  Eye, ThumbsUp, CheckCircle2, MessageSquare, AlertTriangle, ExternalLink, Trash2, Edit3, Loader2,
} from "lucide-react";
import { toast } from "sonner";

type Props = {
  video: LiftVideo;
  role: "admin" | "client";
  userId: string | null;
  onChanged?: () => void;
  onEdit?: (v: LiftVideo) => void;
};

export function LiftVideoCard({ video, role, userId, onChanged, onEdit }: Props) {
  const [comments, setComments] = useState<LiftVideoComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [posting, setPosting] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const loadComments = async () => {
    const c = await listComments(video.id, { includeInternal: role === "admin" });
    setComments(c);
  };
  useEffect(() => { loadComments(); /* eslint-disable-next-line */ }, [video.id]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (video.video_storage_path) {
        const u = await getSignedVideoUrl(video.video_storage_path);
        if (!cancel) setSignedUrl(u);
      } else if (video.video_url) {
        if (isYouTube(video.video_url)) setEmbedUrl(youTubeEmbed(video.video_url));
        else if (isDrive(video.video_url)) setEmbedUrl(drivePreview(video.video_url));
      }
    })();
    return () => { cancel = true; };
  }, [video.video_storage_path, video.video_url]);

  const post = async () => {
    if (!commentBody.trim()) return;
    setPosting(true);
    try {
      await addComment({
        videoId: video.id,
        clientId: video.client_id,
        authorId: userId,
        authorRole: role,
        body: commentBody.trim(),
        isInternalNote: role === "admin" ? isInternal : false,
      });
      setCommentBody("");
      setIsInternal(false);
      await loadComments();
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to post");
    } finally {
      setPosting(false);
    }
  };

  const act = async (fn: () => Promise<void>, success: string) => {
    try { await fn(); toast.success(success); onChanged?.(); }
    catch (e: any) { toast.error(e.message ?? "Failed"); }
  };

  const dayLabel = video.training_day === "Custom" ? video.custom_training_day : video.training_day;
  const tagLabel = video.tag === "Custom" ? video.custom_tag : video.tag;
  const displayStatus = role === "client" ? clientFacingStatus(video) : video.status;

  return (
    <Card className="border-border bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold truncate">{video.exercise}</h3>
            {dayLabel && <Badge variant="outline">{dayLabel}</Badge>}
            {tagLabel && tagLabel !== "Normal Review" && (
              <Badge variant="outline" className={video.is_urgent ? "border-destructive/40 bg-destructive/10 text-destructive" : ""}>
                {video.is_urgent && <AlertTriangle className="mr-1 h-3 w-3" />}{tagLabel}
              </Badge>
            )}
            <Badge variant="outline" className={statusTone(video.status)}>{displayStatus}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {video.date_performed && <>Performed {format(parseISO(video.date_performed), "MMM d, yyyy")} · </>}
            Uploaded {formatDistanceToNow(parseISO(video.created_at), { addSuffix: true })}
            {video.program_day && <> · {video.program_day}</>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onEdit && (
            <Button size="sm" variant="ghost" onClick={() => onEdit(video)}><Edit3 className="h-3.5 w-3.5" /></Button>
          )}
          {(role === "admin" || video.uploaded_by === userId) && (
            <Button size="sm" variant="ghost" onClick={() => {
              if (confirm("Delete this video?")) act(() => deleteLiftVideo(video.id), "Deleted");
            }}><Trash2 className="h-3.5 w-3.5" /></Button>
          )}
        </div>
      </div>

      {(video.set_number || video.reps || video.load_text || video.rpe) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
          {video.set_number != null && <Stat label="Set" value={String(video.set_number)} />}
          {video.reps != null && <Stat label="Reps" value={String(video.reps)} />}
          {video.load_text && <Stat label="Load" value={video.load_text} />}
          {video.rpe != null && <Stat label="RPE" value={String(video.rpe)} />}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-black/40">
        {embedUrl ? (
          <iframe src={embedUrl} className="aspect-video w-full" allow="autoplay; encrypted-media" allowFullScreen />
        ) : signedUrl ? (
          <video src={signedUrl} controls className="w-full" />
        ) : video.video_url ? (
          <a href={video.video_url} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 p-6 text-sm text-primary">
            Open video link <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <div className="p-6 text-center text-xs text-muted-foreground">No video attached</div>
        )}
      </div>

      {video.client_notes && (
        <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm whitespace-pre-wrap">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Client notes</div>
          {video.client_notes}
        </div>
      )}
      {video.question_for_coach && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm whitespace-pre-wrap">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-primary">Question for coach</div>
          {video.question_for_coach}
        </div>
      )}

      {/* Watched / liked / reviewed indicators */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {video.watched_at && <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-600"><Eye className="mr-1 h-3 w-3" />Coach Jared watched · {formatDistanceToNow(parseISO(video.watched_at), { addSuffix: true })}</Badge>}
        {video.liked_at && <Badge variant="outline" className="border-pink-500/40 bg-pink-500/10 text-pink-600"><ThumbsUp className="mr-1 h-3 w-3" />Coach Jared liked</Badge>}
        {video.reviewed_at && <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" />Reviewed</Badge>}
      </div>

      {/* Admin actions */}
      {role === "admin" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => act(() => markWatched(video.id, userId), "Marked watched")}>
            <Eye className="mr-1 h-3 w-3" /> Watched
          </Button>
          <Button size="sm" variant="outline" onClick={() => act(() => toggleLike(video.id, userId, !video.liked_at), video.liked_at ? "Unliked" : "Liked")}>
            <ThumbsUp className="mr-1 h-3 w-3" /> {video.liked_at ? "Unlike" : "Like"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => act(() => markReviewed(video.id, userId), "Marked reviewed")}>
            <CheckCircle2 className="mr-1 h-3 w-3" /> Reviewed
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Label className="text-xs">Status</Label>
            <Select value={video.status} onValueChange={(v) => act(() => setStatus(video.id, v as any), "Status updated")}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIFT_VIDEO_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Comments */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <MessageSquare className="h-3 w-3" /> Comments
        </div>
        <div className="space-y-2">
          {comments.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
          {comments.map((c) => (
            <div key={c.id} className={`rounded-md border p-3 text-sm ${c.is_internal_note ? "border-warning/40 bg-warning/10" : c.author_role === "admin" ? "border-primary/30 bg-primary/5" : "border-border bg-secondary/30"}`}>
              <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>{c.author_role === "admin" ? "Coach Jared" : "Client"}</span>
                {c.is_internal_note && <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">Internal</Badge>}
                <span>· {format(parseISO(c.created_at), "MMM d, h:mm a")}</span>
              </div>
              <div className="whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
        </div>
        <Textarea rows={2} placeholder={role === "admin" ? "Reply to client…" : "Reply to coach…"} value={commentBody} onChange={(e) => setCommentBody(e.target.value)} />
        <div className="flex items-center justify-between">
          {role === "admin" ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={isInternal} onCheckedChange={setIsInternal} /> Internal note (hidden from client)
            </label>
          ) : <div />}
          <Button size="sm" onClick={post} disabled={posting || !commentBody.trim()}>
            {posting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Post
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}