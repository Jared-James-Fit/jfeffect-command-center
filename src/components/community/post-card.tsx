import { memo, useState } from "react";
import { Lock, MessageCircle, MoreHorizontal, Play, Trash2 } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  REACTIONS,
  SCOPE_WORD,
  featuredLift,
  formatTopSet,
  pickCardStats,
  postTimeLabel,
  reactionEmoji,
  type CommunityAuthor,
  type CommunityPost,
  type ReactionKey,
} from "@/lib/community";
import { useFullMediaUrl } from "@/lib/community.queries";

export function CoachBadge({ className }: { className?: string }) {
  return (
    <span className={cn("rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.12em] text-primary", className)}>
      Coach
    </span>
  );
}

export function AuthorLine({ author, sub, onOpen }: { author: CommunityAuthor; sub?: string; onOpen?: () => void }) {
  const body = (
    <>
      <UserAvatar src={author.avatar_url} name={author.name} size={40} expandable={false} />
      <div className="min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold leading-tight">{author.name}</span>
          {author.is_coach && <CoachBadge />}
        </div>
        {sub ? <div className="text-[11px] leading-tight text-muted-foreground">{sub}</div> : null}
      </div>
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2.5 rounded-lg text-left" aria-label={`${author.name}'s shared workouts`}>
      {body}
    </button>
  ) : (
    <div className="flex min-w-0 items-center gap-2.5">{body}</div>
  );
}

type Props = {
  post: CommunityPost;
  /** Signed thumbnail URL (already resolved for the whole page). */
  thumbUrl: string | null;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpenComments: (post: CommunityPost) => void;
  onOpenAuthor?: (author: CommunityAuthor) => void;
  onReact: (post: CommunityPost, next: ReactionKey | null) => void;
  onDelete: (post: CommunityPost) => void;
};

function PostCardInner({ post, thumbUrl, unit, viewerIsStaff, onOpenComments, onOpenAuthor, onReact, onDelete }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const s = post.stats;
  const lift = s ? featuredLift(s) : null;
  const stats = s ? pickCardStats(s, unit) : [];
  const canDelete = post.is_mine || viewerIsStaff;
  const sub = [postTimeLabel(post.created_at), post.visibility === "private" ? "Only me" : null].filter(Boolean).join(" · ");

  return (
    <article className="rounded-2xl border border-border/80 bg-card shadow-sm">
      <header className="flex items-center justify-between gap-2 px-3.5 pt-3.5">
        <AuthorLine author={post.author} sub={sub} onOpen={onOpenAuthor && !post.is_mine ? () => onOpenAuthor(post.author) : undefined} />
        <div className="flex shrink-0 items-center gap-1">
          {post.visibility === "private" && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Only visible to you" />}
          {canDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Post options">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {post.is_mine ? "Delete post" : "Remove post"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {s && (
        <div className="px-3.5 pt-3">
          <h3 className="truncate text-[17px] font-black leading-tight tracking-tight">{s.workout_title}</h3>
          {lift && (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[15px] font-black tabular-nums">{formatTopSet(lift.detail, unit)}</span>
              <span className="text-sm font-semibold text-muted-foreground">{lift.name}</span>
              {lift.pr && (
                <span className="rounded-full bg-amber-500/15 px-2 py-px text-[10px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  {SCOPE_WORD[lift.pr]}
                </span>
              )}
            </div>
          )}
          {stats.length > 0 && (
            <div className="mt-1 text-[12px] font-semibold text-muted-foreground">
              {stats.map((x) => (x.label === "PR" || x.label === "PRs" ? `${x.value} ${x.label}` : x.label === "Time" ? x.value : `${x.value} ${x.label.toLowerCase()}`)).join(" · ")}
            </div>
          )}
        </div>
      )}

      {post.media_type && <PostMedia post={post} thumbUrl={thumbUrl} />}

      {post.caption && <p className="whitespace-pre-line px-3.5 pt-3 text-[14px] leading-snug">{post.caption}</p>}

      {(post.coach_reactions.length > 0 || post.coach_commented) && (
        <div className="px-3.5 pt-2.5">
          <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-2.5 py-1 text-[12px] font-bold text-primary">
            <span className="truncate">
              Coach {post.coach_reactions[0]?.name ?? ""}
              {post.coach_reactions[0] ? ` ${reactionEmoji(post.coach_reactions[0].emoji) ?? ""}` : ""}
              {post.coach_commented ? `${post.coach_reactions[0] ? " · " : " "}replied` : ""}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 px-2 pb-2 pt-2">
        {REACTIONS.map((r) => {
          const count = post.reactions[r.key] ?? 0;
          const mine = post.my_reaction === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => onReact(post, mine ? null : r.key)}
              aria-pressed={mine}
              aria-label={`${r.label}${count ? `, ${count}` : ""}`}
              className={cn(
                "flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2.5 text-[15px] transition-colors active:scale-95",
                mine ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted",
              )}
            >
              <span className={cn(!mine && count === 0 && "opacity-60")}>{r.emoji}</span>
              {count > 0 && <span className="text-[12px] font-bold tabular-nums text-muted-foreground">{count}</span>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onOpenComments(post)}
          className="ml-auto flex h-11 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold text-muted-foreground hover:bg-muted"
          aria-label={`Comments${post.comment_count ? `, ${post.comment_count}` : ""}`}
        >
          <MessageCircle className="h-4 w-4" />
          {post.comment_count > 0 ? post.comment_count : "Comment"}
        </button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{post.is_mine ? "Delete this post?" : "Remove this post?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {post.is_mine
                ? "It disappears from the community. Your workout itself isn't touched."
                : "It disappears from the community for everyone. The athlete's workout isn't touched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDelete(post)}>{post.is_mine ? "Delete" : "Remove"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

export const PostCard = memo(PostCardInner);

/** Feed media: the thumbnail only. Full-size image / video loads on tap. */
function PostMedia({ post, thumbUrl }: { post: CommunityPost; thumbUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const isVideo = post.media_type === "video";
  const w = post.media_width ?? 4;
  const h = post.media_height ?? 5;
  // Never taller than 4:5, never wider than 16:9 — keeps the feed rhythm steady.
  const ratio = Math.min(Math.max(w / h, 0.8), 1.78);
  const { data: fullUrl } = useFullMediaUrl(post.media_path, open || playing);

  return (
    <div className="mt-3">
      <div className="relative w-full overflow-hidden bg-muted" style={{ aspectRatio: String(ratio) }}>
        {isVideo && playing && fullUrl ? (
          <video src={fullUrl} poster={thumbUrl ?? undefined} className="h-full w-full object-cover" controls autoPlay playsInline />
        ) : (
          <button
            type="button"
            className="group absolute inset-0"
            onClick={() => (isVideo ? setPlaying(true) : setOpen(true))}
            aria-label={isVideo ? "Play video" : "Open photo"}
          >
            {thumbUrl ? (
              <img src={thumbUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full animate-pulse bg-muted" />
            )}
            {isVideo && (
              <span className="absolute inset-0 grid place-items-center bg-black/10">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                  <Play className="ml-0.5 h-6 w-6 fill-current" />
                </span>
              </span>
            )}
          </button>
        )}
      </div>

      {!isVideo && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-[min(96vw,720px)] border-0 bg-black p-0 [&>button]:text-white">
            <DialogTitle className="sr-only">Training photo</DialogTitle>
            <DialogDescription className="sr-only">Full-size photo</DialogDescription>
            {fullUrl ? <img src={fullUrl} alt="" className="max-h-[88dvh] w-full object-contain" /> : <div className="aspect-[4/5] w-full animate-pulse bg-muted/20" />}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
