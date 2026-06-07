import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
  getSignedVideoUrl, deleteLiftVideo, setPlaybackError,
  isYouTube, isDrive, youTubeEmbed, liftVideoOpenUrl, liftVideoDriveFileId,
  LIFT_VIDEO_QUICK_REPLIES,
} from "@/lib/lift-videos";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import {
  Eye, ThumbsUp, CheckCircle2, MessageSquare, AlertTriangle, ExternalLink, Trash2, Edit3, Loader2,
  AlertCircle, Archive, Zap, MoreVertical, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { LiftVideoPlayer } from "@/components/lift-video-player";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { refreshLiftVideoDriveDiagnostics } from "@/lib/lift-videos.functions";

type Props = {
  video: LiftVideo;
  role: "admin" | "client";
  userId: string | null;
  onChanged?: () => void;
  onEdit?: (v: LiftVideo) => void;
  /** Optional: client name/avatar for nicer comment attribution. */
  clientName?: string | null;
  clientAvatarPath?: string | null;
};

export function LiftVideoCard({ video, role, userId, onChanged, onEdit, clientName, clientAvatarPath }: Props) {
  const [comments, setComments] = useState<LiftVideoComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [posting, setPosting] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [embedStatus, setEmbedStatus] = useState<"idle" | "loading" | "ready" | "slow" | "error">("idle");
  const [embedRetry, setEmbedRetry] = useState(0);
  const [lastPlaybackError, setLastPlaybackError] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const refreshDiagnostics = useServerFn(refreshLiftVideoDriveDiagnostics);

  const loadComments = async () => {
    const c = await listComments(video.id, { includeInternal: role === "admin" });
    setComments(c);
  };
  useEffect(() => { loadComments(); }, [video.id]);

  useEffect(() => {
    let cancel = false;
    setEmbedUrl(null);
    setSignedUrl(null);
    setEmbedStatus("idle");
    (async () => {
      if (video.video_storage_path) {
        const u = await getSignedVideoUrl(video.video_storage_path);
        if (!cancel) setSignedUrl(u);
      } else if (video.video_url) {
        if (isYouTube(video.video_url)) setEmbedUrl(youTubeEmbed(video.video_url));
      }
    })();
    return () => { cancel = true; };
  }, [video.video_storage_path, video.video_url]);

  useEffect(() => {
    if (!embedUrl) return;
    setEmbedStatus("loading");
    const slowTimer = window.setTimeout(() => setEmbedStatus((s) => (s === "loading" ? "slow" : s)), 5000);
    const errorTimer = window.setTimeout(() => setEmbedStatus((s) => (s === "loading" || s === "slow" ? "error" : s)), 10000);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(errorTimer);
    };
  }, [embedUrl, embedRetry]);

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
  const isReviewed = !!video.reviewed_at;
  const clientCanDelete = role === "client" && video.uploaded_by === userId && !isReviewed;
  const clientCanEdit = role === "client" && video.uploaded_by === userId && !isReviewed;
  const driveFileId = liftVideoDriveFileId(video);
  const openUrl = liftVideoOpenUrl(video);
  const playablePreviewUrl = signedUrl ?? (video.preview_status === "ready" && video.preview_url && !isDrive(video.preview_url) ? video.preview_url : null);
  const previewReason = playablePreviewUrl
    ? null
    : video.preview_error || video.playback_error || (driveFileId ? "Preview not ready yet." : openUrl ? "Preview URL missing." : "Original video link missing.");

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
        {(role === "admin" || clientCanEdit || clientCanDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (role === "admin" || clientCanEdit) && (
                <DropdownMenuItem onClick={() => onEdit(video)}>
                  <Edit3 className="mr-2 h-4 w-4" /> Edit
                </DropdownMenuItem>
              )}
              {(role === "admin" || clientCanDelete) && (
                <>
                  {onEdit && (role === "admin" || clientCanEdit) && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      if (confirm("Delete this video?")) act(() => deleteLiftVideo(video.id), "Deleted");
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {(video.set_number || video.reps || video.load_text || video.rpe) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
          {video.set_number != null && <Stat label="Set" value={String(video.set_number)} />}
          {video.reps != null && <Stat label="Reps" value={String(video.reps)} />}
          {video.load_text && <Stat label="Load" value={video.load_text} />}
          {video.rpe != null && <Stat label="RPE" value={String(video.rpe)} />}
        </div>
      )}

      {/* Primary Drive action — always visible, never blocked by preview load */}
      {openUrl && (
        <Button asChild className="w-full sm:w-auto">
          <a href={openUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            Watch in {isDrive(video.video_url ?? "") ? "Drive" : "new tab"} (original quality)
          </a>
        </Button>
      )}

      {/* Client context — shown BEFORE the preview so reviewers always
          see notes/questions even if the embed is slow or broken. */}
      <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm whitespace-pre-wrap">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Client notes</div>
        {video.client_notes ? video.client_notes : <span className="text-muted-foreground italic">No notes added.</span>}
      </div>
      {video.question_for_coach && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm whitespace-pre-wrap">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-primary">Question for coach</div>
          {video.question_for_coach}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        {playablePreviewUrl ? (
          <LiftVideoPlayer
            src={playablePreviewUrl}
            fallbackUrl={openUrl}
            embedFallbackUrl={null}
            thumbnailUrl={video.thumbnail_url}
            title={video.exercise || "Lift video"}
            onPlaybackError={(message) => {
              setLastPlaybackError(message);
              if (role === "admin") setPlaybackError(video.id, message).catch(() => {});
            }}
          />
        ) : embedUrl ? (
          <div className="space-y-2">
            <div
              className="relative aspect-video w-full overflow-hidden rounded-md bg-black"
              style={
                video.thumbnail_url && embedStatus !== "ready"
                  ? { backgroundImage: `url(${video.thumbnail_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : undefined
              }
            >
              {embedStatus !== "ready" && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 p-4 text-center text-white">
                  {embedStatus === "error" ? <AlertTriangle className="h-6 w-6" /> : <Loader2 className="h-5 w-5 animate-spin" />}
                  <div>
                    <div className="text-sm font-medium">
                      {embedStatus === "error" ? (isDrive(video.video_url ?? "") ? "Preview unavailable (Drive permissions)." : "Preview unavailable.") : "Loading preview…"}
                    </div>
                    {(embedStatus === "slow" || embedStatus === "error") && (
                      <div className="mt-1 text-xs text-white/70">
                        {embedStatus === "slow" ? "Taking longer than expected — watch in Drive instead." : "Watch the original in Google Drive."}
                      </div>
                    )}
                  </div>
                  {(embedStatus === "slow" || embedStatus === "error") && (
                    <div className="flex flex-wrap justify-center gap-2">
                      {openUrl && (
                        <Button size="sm" asChild>
                          <a href={openUrl} target="_blank" rel="noreferrer">
                            Watch in Drive <ExternalLink className="ml-1 h-3 w-3" />
                          </a>
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setEmbedRetry((r) => r + 1)}>
                        <RefreshCw className="mr-1 h-3 w-3" /> Retry Preview
                      </Button>
                    </div>
                  )}
                </div>
              )}
            <iframe
              key={`${embedUrl}-${embedRetry}`}
              src={embedUrl}
              className={cn("h-full w-full bg-secondary/40", embedStatus !== "ready" && "opacity-0")}
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              loading="lazy"
              onLoad={() => setEmbedStatus("ready")}
            />
            </div>
          </div>
        ) : openUrl ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 bg-secondary/30 p-6 text-center text-sm">
            <div>
              <div className="font-medium text-foreground">{previewReason}</div>
              <div className="mt-1 text-xs text-muted-foreground">Use the original Drive video for review.</div>
            </div>
            <Button asChild>
              <a href={openUrl} target="_blank" rel="noreferrer">
                Watch in Drive <ExternalLink className="ml-2 h-3 w-3" />
              </a>
            </Button>
          </div>
        ) : (
          <div className="min-h-48 p-6 text-center text-xs text-muted-foreground">Google Drive link missing for this video.</div>
        )}
      </div>

      {role === "admin" && (
        <details className="rounded-md border border-border bg-secondary/20 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">Video diagnostics</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <DebugLine label="Original Drive file ID" value={driveFileId ?? "Missing"} good={!!driveFileId} />
            <DebugLine label="Original Drive URL" value={openUrl ?? "Missing"} good={!!openUrl} />
            <DebugLine label="Open in Drive" value={openUrl ? "Available" : "Missing"} good={!!openUrl} />
            <DebugLine label="Preview URL" value={video.preview_url || "Missing"} good={!!video.preview_url} />
            <DebugLine label="Preview status" value={video.preview_status || (playablePreviewUrl ? "ready" : "not_generated")} good={!!playablePreviewUrl || video.preview_status === "ready"} />
            <DebugLine label="Thumbnail URL" value={video.thumbnail_url || "Missing"} good={!!video.thumbnail_url} />
            <DebugLine label="File type" value={video.file_type || "Unknown"} good={!!video.file_type} />
            <DebugLine label="File size" value={formatBytes(video.file_size_bytes)} good={!!video.file_size_bytes} />
            <DebugLine label="Upload status" value={video.upload_status || "Unknown"} good={video.upload_status === "Drive uploaded" || video.upload_status === "App storage fallback"} />
            <DebugLine label="Playback error" value={lastPlaybackError || video.playback_error || "None"} good={!(lastPlaybackError || video.playback_error)} />
          </div>
        </details>
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
          <Button size="sm" variant="outline" onClick={() => act(() => setStatus(video.id, "Needs Follow-Up"), "Marked needs follow-up")}>
            <AlertCircle className="mr-1 h-3 w-3" /> Needs Follow-Up
          </Button>
          <Button size="sm" variant="outline" onClick={() => act(() => setStatus(video.id, "Archived"), "Archived")}>
            <Archive className="mr-1 h-3 w-3" /> Archive
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

      {/* Coach Feedback */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <MessageSquare className="h-3 w-3" /> Coach Feedback
        </div>
        <div className="space-y-2">
          {comments.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {role === "admin" ? "No comments yet." : "No coach feedback yet."}
            </p>
          )}
          {comments.map((c) => (
            <div key={c.id} className={`rounded-md border p-3 text-sm ${c.is_internal_note ? "border-warning/40 bg-warning/10" : c.author_role === "admin" ? "border-primary/30 bg-primary/5" : "border-border bg-secondary/30"}`}>
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {(() => {
                  const isAdmin = c.author_role === "admin";
                  const name = isAdmin
                    ? "Coach Jared"
                    : (role === "admin" ? (clientName ?? "Client") : "You");
                  const avatarPath = isAdmin ? null : (role === "admin" ? clientAvatarPath ?? null : null);
                  return (
                    <>
                      <UserAvatar
                        src={avatarPath}
                        name={name}
                        size={22}
                        tone={isAdmin ? "primary" : "neutral"}
                      />
                      <span className="text-foreground">{name}</span>
                    </>
                  );
                })()}
                {c.is_internal_note && <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">Internal</Badge>}
                <span>· {format(parseISO(c.created_at), "MMM d, h:mm a")}</span>
              </div>
              <div className="whitespace-pre-wrap text-foreground">{c.body}</div>
            </div>
          ))}
        </div>
        <Textarea
          rows={2}
          placeholder={role === "admin" ? "Reply to client…" : "Reply to Coach Jared…"}
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          {role === "admin" ? (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={isInternal} onCheckedChange={setIsInternal} /> Internal note
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" type="button">
                    <Zap className="mr-1 h-3 w-3" /> Quick reply
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  {LIFT_VIDEO_QUICK_REPLIES.map((q) => (
                    <DropdownMenuItem key={q} onClick={() => setCommentBody((b) => (b ? `${b}\n${q}` : q))}>
                      <span className="text-xs">{q}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : <div />}
          <Button size="sm" onClick={post} disabled={posting || !commentBody.trim()}>
            {posting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            {role === "admin" ? "Send Feedback" : "Send Reply"}
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

function DebugLine({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="min-w-0 rounded border border-border bg-card p-2">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("break-all", good ? "text-foreground" : "text-destructive")}>{value}</div>
    </div>
  );
}

function formatBytes(value: number | null | undefined) {
  if (!value) return "Unknown";
  if (value < 1024) return `${value} B`;
  const mb = value / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}