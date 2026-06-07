import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Eye, ThumbsUp, CheckCircle2, AlertCircle, Archive, Zap, Send, Loader2,
  ExternalLink, AlertTriangle, MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { LiftVideoPlayer } from "@/components/lift-video-player";
import {
  type LiftVideo, type LiftVideoComment, LIFT_VIDEO_STATUSES, LIFT_VIDEO_QUICK_REPLIES,
  listComments, addComment, markWatched, toggleLike, markReviewed, setStatus,
  getSignedVideoUrl, isYouTube, isDrive, youTubeEmbed, drivePreview,
  liftVideoOpenUrl, liftVideoDriveFileId, statusTone,
} from "@/lib/lift-videos";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

type Props = {
  video: LiftVideo;
  userId: string | null;
  clientName?: string | null;
  clientAvatarPath?: string | null;
  onChanged?: () => void;
};

export function AdminLiftReviewThread({ video, userId, clientName, clientAvatarPath, onChanged }: Props) {
  const [comments, setComments] = useState<LiftVideoComment[]>([]);
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [posting, setPosting] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const openUrl = liftVideoOpenUrl(video);
  const driveFileId = liftVideoDriveFileId(video);

  const loadComments = async () => {
    const c = await listComments(video.id, { includeInternal: true });
    setComments(c);
  };
  useEffect(() => { loadComments(); }, [video.id]);

  useEffect(() => {
    let cancel = false;
    setSignedUrl(null);
    setEmbedUrl(null);
    (async () => {
      if (video.video_storage_path) {
        const u = await getSignedVideoUrl(video.video_storage_path);
        if (!cancel) setSignedUrl(u);
      } else if (video.video_url) {
        if (isYouTube(video.video_url)) setEmbedUrl(youTubeEmbed(video.video_url));
        else if (isDrive(video.video_url)) setEmbedUrl(drivePreview(video.video_url));
      }
      if (!cancel && !video.video_storage_path && driveFileId) {
        setEmbedUrl((p) => p ?? `https://drive.google.com/file/d/${driveFileId}/preview`);
      }
    })();
    return () => { cancel = true; };
  }, [video.id]);

  // Auto-scroll comments to bottom when new arrives
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [comments.length]);

  const send = async () => {
    if (!body.trim()) return;
    setPosting(true);
    try {
      await addComment({
        videoId: video.id,
        clientId: video.client_id,
        authorId: userId,
        authorRole: "admin",
        body: body.trim(),
        isInternalNote: isInternal,
      });
      setBody("");
      setIsInternal(false);
      await loadComments();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
    } finally {
      setPosting(false);
    }
  };

  const act = async (fn: () => Promise<void>, success: string) => {
    try { await fn(); toast.success(success); onChanged?.(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const dayLabel = video.training_day === "Custom" ? video.custom_training_day : video.training_day;
  const clientNote = video.client_notes?.trim();
  const question = video.question_for_coach?.trim();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card">
      {/* Video */}
      <div className="border-b border-border bg-black">
        {signedUrl ? (
          <LiftVideoPlayer
            src={signedUrl}
            fallbackUrl={openUrl}
            thumbnailUrl={video.thumbnail_url}
            title={video.exercise || "Lift video"}
          />
        ) : embedUrl ? (
          <div className="relative aspect-video w-full bg-black">
            <iframe
              key={embedUrl}
              src={embedUrl}
              className="h-full w-full"
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              title={video.exercise || "Lift video"}
            />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center text-sm text-muted-foreground">
            Preview unavailable.
          </div>
        )}
      </div>

      {/* Meta strip */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="font-semibold">{video.exercise || "Lift"}</span>
        {dayLabel && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{dayLabel}</Badge>}
        {video.is_urgent && (
          <Badge variant="outline" className="h-5 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] text-destructive">
            <AlertTriangle className="mr-1 h-3 w-3" /> Urgent
          </Badge>
        )}
        <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", statusTone(video.status))}>{video.status}</Badge>
        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" /> Drive
          </a>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <PillButton onClick={() => act(() => markWatched(video.id, userId), "Marked watched")} active={!!video.watched_at} icon={<Eye className="h-3 w-3" />}>
          Watched
        </PillButton>
        <PillButton onClick={() => act(() => toggleLike(video.id, userId, !video.liked_at), video.liked_at ? "Unliked" : "Liked")} active={!!video.liked_at} icon={<ThumbsUp className="h-3 w-3" />}>
          {video.liked_at ? "Liked" : "Like"}
        </PillButton>
        <PillButton onClick={() => act(() => markReviewed(video.id, userId), "Marked reviewed")} active={!!video.reviewed_at} icon={<CheckCircle2 className="h-3 w-3" />}>
          Reviewed
        </PillButton>
        <PillButton onClick={() => act(() => setStatus(video.id, "Needs Follow-Up"), "Marked needs follow-up")} icon={<AlertCircle className="h-3 w-3" />}>
          Follow-up
        </PillButton>
        <PillButton onClick={() => act(() => setStatus(video.id, "Archived"), "Archived")} icon={<Archive className="h-3 w-3" />}>
          Archive
        </PillButton>
        <div className="ml-auto">
          <Select value={video.status} onValueChange={(v) => act(() => setStatus(video.id, v as any), "Status updated")}>
            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LIFT_VIDEO_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-4 min-h-[240px]">
        {/* Client note as first incoming bubble */}
        {(clientNote || question) && (
          <Bubble side="left" name={clientName ?? "Client"} avatarSrc={clientAvatarPath} time={format(parseISO(video.created_at), "MMM d, h:mm a")}>
            {clientNote && <div className="whitespace-pre-wrap">{clientNote}</div>}
            {question && (
              <div className={cn("rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs text-foreground", clientNote && "mt-2")}>
                <span className="font-semibold text-primary">Question: </span>{question}
              </div>
            )}
          </Bubble>
        )}

        {comments.length === 0 && !clientNote && !question && (
          <div className="flex h-full flex-col items-center justify-center gap-1 py-10 text-center text-xs text-muted-foreground">
            <MessageSquare className="h-5 w-5 opacity-60" />
            No messages yet — send the first reply below.
          </div>
        )}

        {comments.map((c) => {
          const isAdmin = c.author_role === "admin";
          return (
            <Bubble
              key={c.id}
              side={isAdmin ? "right" : "left"}
              name={isAdmin ? "Coach Jared" : (clientName ?? "Client")}
              avatarSrc={isAdmin ? null : clientAvatarPath}
              tone={isAdmin ? "primary" : "neutral"}
              time={format(parseISO(c.created_at), "MMM d, h:mm a")}
              internal={c.is_internal_note}
            >
              <div className="whitespace-pre-wrap">{c.body}</div>
            </Bubble>
          );
        })}
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-card p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-2 py-1.5">
          <Textarea
            rows={1}
            placeholder="Reply to client…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            className="min-h-[36px] max-h-32 resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" title="Quick reply">
                <Zap className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {LIFT_VIDEO_QUICK_REPLIES.map((q) => (
                <DropdownMenuItem key={q} onClick={() => setBody((b) => (b ? `${b}\n${q}` : q))}>
                  <span className="text-xs">{q}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="icon"
            onClick={send}
            disabled={posting || !body.trim()}
            className="h-9 w-9 shrink-0 rounded-full"
            title="Send"
          >
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Switch checked={isInternal} onCheckedChange={setIsInternal} />
          Internal note (not visible to client)
        </label>
      </div>
    </div>
  );
}

function PillButton({
  children, onClick, active, icon,
}: { children: React.ReactNode; onClick: () => void; active?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Bubble({
  side, name, avatarSrc, time, tone = "neutral", internal, children,
}: {
  side: "left" | "right";
  name: string;
  avatarSrc?: string | null;
  time: string;
  tone?: "primary" | "neutral";
  internal?: boolean;
  children: React.ReactNode;
}) {
  const isRight = side === "right";
  return (
    <div className={cn("flex items-end gap-2", isRight ? "flex-row-reverse" : "flex-row")}>
      <UserAvatar src={avatarSrc} name={name} size={28} tone={tone} />
      <div className={cn("flex max-w-[78%] flex-col", isRight ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm shadow-sm",
            internal
              ? "border border-warning/40 bg-warning/10 text-foreground"
              : isRight
                ? "bg-primary text-primary-foreground rounded-br-md"
                : "bg-secondary text-foreground rounded-bl-md"
          )}
        >
          {internal && (
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-warning">Internal note</div>
          )}
          {children}
        </div>
        <div className="mt-1 px-1 text-[10px] text-muted-foreground">
          {name} · {time}
        </div>
      </div>
    </div>
  );
}