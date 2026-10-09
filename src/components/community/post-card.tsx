import { memo, useRef, useState } from "react";
import { BadgeCheck, Lock, MessageCircle, Play, Send } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import {
  REACTION,
  SCOPE_WORD,
  SERIES_LABEL,
  extraScene,
  extraTipKind,
  featuredLift,
  isRecapStats,
  isWinsStats,
  formatTopSet,
  isTrainingNow,
  lockInTimeLabel,
  pickCardStats,
  postTimeLabel,
  reactionEmoji,
  reactionKinds,
  reactorsLine,
  sessionLine,
  type CommunityAuthor,
  type CommunityPost,
  type ReactionKey,
  type WorkoutShareStats,
} from "@/lib/community";
import { useFullMediaUrl } from "@/lib/community.queries";
import { WinsStatsCard } from "@/components/community/wins-stats";
import { SeriesExtraCard, SundayRecapCard } from "@/components/community/series-cards";
import { SpiritScene, isSpiritScene } from "@/components/community/spirit-scenes";
import { ReactorsSheet } from "@/components/community/reactors-sheet";
import { PostActions } from "@/components/community/post-actions";
import { FeedCaption } from "@/components/community/feed-caption";
import { MessageAuthorSheet } from "@/components/community/message-author-sheet";
import { useAuth } from "@/lib/auth";
import { DoubleTapHint, ReactionBurst, ReactionButton } from "@/components/community/reaction-button";

/** "● Training now" — a lock-in whose session is still open (and recent). */
export function TrainingNowPill({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-white", className)}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Training now
    </span>
  );
}

/**
 * A lock-in before its numbers exist: LOCKED IN, the session, the time.
 * Once the session is finished the post shows the workout instead.
 */
export function LockInHero({ post, size = "feed" }: { post: CommunityPost; size?: "feed" | "detail" | "tile" }) {
  const now = isTrainingNow(post);
  const time = lockInTimeLabel(post.locked_in_at);
  const bg = "bg-[radial-gradient(130%_90%_at_95%_0%,rgba(239,51,64,0.55),rgba(127,29,29,0.16)_45%,#0a0a0d_75%)]";
  if (size === "tile") {
    return (
      <div className={cn("flex h-full w-full flex-col justify-between p-2.5 text-white", bg)}>
        {now ? <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> : <span />}
        <div>
          <div className="font-display text-[17px] uppercase leading-none">Locked in</div>
          <div className="mt-0.5 line-clamp-2 text-[10px] font-bold text-white/70">{post.session_title}</div>
        </div>
      </div>
    );
  }
  const big = size === "detail";
  return (
    <div className={cn("relative overflow-hidden px-5 text-white", big ? "py-8" : "py-6", bg)}>
      {now ? <TrainingNowPill /> : time ? <span className="text-[10px] font-black uppercase tracking-[0.16em] text-red-400">{time}</span> : null}
      <div className={cn("font-display mt-2 uppercase leading-[0.95]", big ? "text-[60px]" : "text-[48px]")}>Locked in</div>
      <div className="mt-1.5 h-1.5 w-24 rounded-full bg-red-500" />
      {post.session_title && <div className="mt-3 truncate text-[15px] font-bold text-white/80">{post.session_title}</div>}
      {post.live && <div className="mt-1 text-[12px] text-white/55">Numbers land here when they finish.</div>}
    </div>
  );
}

/** "Only me" · "Just my coach" (author) · "Just you" (the coach) · "Weights hidden" (author). */
export function audienceNote(post: Pick<CommunityPost, "visibility" | "is_mine" | "hide_loads">): string | null {
  const parts: string[] = [];
  if (post.visibility === "private") parts.push("Only me");
  else if (post.visibility === "coach") parts.push(post.is_mine ? "Just my coach" : "Just you");
  if (post.is_mine && post.hide_loads) parts.push("Weights hidden");
  return parts.length ? parts.join(" · ") : null;
}

/** The coach mark next to a name: small, verified-style, never a banner. */
export function CoachBadge({ className }: { className?: string }) {
  return <BadgeCheck className={cn("h-4 w-4 shrink-0 fill-primary text-primary-foreground", className)} aria-label="Coach" role="img" />;
}

/**
 * A coach's note (Monday Motivation, Finish Strong Friday, or a one-off):
 * a quiet series label, the featured quote with its speaker, then the words.
 * `clamp` keeps long notes tidy in the feed; the detail shows everything.
 */
export function NoteBody({ post, clamp = false }: { post: CommunityPost; clamp?: boolean }) {
  const series = post.series ? SERIES_LABEL[post.series] ?? null : null;
  // Saturday: the picture says it, the words just sit under it
  const scene = post.series === "saturday_spirit" ? extraScene(post.series_extra) : null;
  return (
    <div className="px-4 pb-1 pt-1">
      {series && (
        <div className="mb-2.5 flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em]">
          <span className="shrink-0 whitespace-nowrap text-primary">{series.name}</span>
          <span className="truncate text-muted-foreground/70">· {extraTipKind(post.series_extra) ?? series.tagline}</span>
        </div>
      )}
      {scene && isSpiritScene(scene) && <SpiritScene scene={scene} className="mb-3 rounded-2xl" />}
      {post.quote && (
        <figure className="mb-3 border-l-[3px] border-primary pl-3.5">
          <blockquote className="whitespace-pre-line text-[18px] font-semibold leading-[1.32] tracking-[-0.01em]">“{post.quote}”</blockquote>
          {post.quote_author && (
            <figcaption className="mt-1.5 text-[12px] font-semibold text-muted-foreground">
              {post.quote_author}
              {post.quote_source ? <span className="font-normal">, {post.quote_source}</span> : null}
            </figcaption>
          )}
        </figure>
      )}
      {post.caption && (
        <p className={cn("whitespace-pre-line leading-[1.45]", scene ? "text-[17px] font-semibold" : "text-[15px]", clamp && "line-clamp-[8]")}>{post.caption}</p>
      )}
    </div>
  );
}

/** Whatever a series post carries under its words: Sunday's report card, Wednesday's numbers, Tuesday's / Thursday's card. */
export function NoteExtras({ post, unit, className }: { post: CommunityPost; unit: "kg" | "lb"; className?: string }) {
  if (post.series === "sunday_recap" && isRecapStats(post.series_data)) return <SundayRecapCard stats={post.series_data} unit={unit} className={className} />;
  if (isWinsStats(post.series_data)) return <WinsStatsCard stats={post.series_data} unit={unit} className={className} />;
  return <SeriesExtraCard post={post} className={className} />;
}

export function AuthorLine({ author, sub, onOpen, size = 40 }: { author: CommunityAuthor; sub?: string; onOpen?: () => void; size?: number }) {
  const body = (
    <>
      <UserAvatar src={author.avatar_url} name={author.name} size={size} expandable={false} />
      <div className="min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold leading-tight">{author.name}</span>
          {author.is_coach && <CoachBadge />}
        </div>
        {author.is_coach || sub ? (
          <div className="truncate text-[11px] leading-tight text-muted-foreground">
            {[author.is_coach ? author.title || "Coach · JF Effect" : null, sub].filter(Boolean).join(" · ")}
          </div>
        ) : null}
      </div>
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2.5 rounded-lg text-left" aria-label={`${author.name}'s profile`}>
      {body}
    </button>
  ) : (
    <div className="flex min-w-0 items-center gap-2.5">{body}</div>
  );
}

/**
 * Workout "card" drawn in the DOM (posts without a photo, profile tiles,
 * detail header). Same look as the share card so the feed feels branded, but
 * every number is the live canonical stat.
 */
export function WorkoutHero({ stats, unit, size = "feed" }: { stats: WorkoutShareStats; unit: "kg" | "lb"; size?: "feed" | "detail" | "tile" }) {
  const lift = featuredLift(stats);
  const nums = pickCardStats(stats, unit);
  const pr = !!lift?.pr;
  const session = sessionLine(stats);
  if (size === "tile") {
    return (
      <div className={cn("flex h-full w-full flex-col justify-between p-2.5 text-white", pr ? "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(245,158,11,0.45),#0b0b0e_60%)]" : "bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.5),#0b0b0e_60%)]")}>
        {pr ? <span className="w-max rounded-full bg-amber-400 px-1.5 text-[8px] font-black uppercase text-[#2b1700]">PR</span> : <span />}
        <div>
          <div className="font-display line-clamp-2 text-[15px] uppercase leading-[1.02]">{stats.workout_title}</div>
          {lift && <div className={cn("font-display mt-0.5 text-[13px] uppercase", pr ? "text-amber-300" : "text-white/80")}>{formatTopSet(lift.detail, unit)}</div>}
        </div>
      </div>
    );
  }
  const big = size === "detail";
  return (
    <div
      className={cn(
        "relative overflow-hidden px-5 text-white",
        big ? "py-7" : "py-5",
        pr
          ? "bg-[radial-gradient(130%_90%_at_95%_0%,rgba(245,158,11,0.42),rgba(120,53,15,0.12)_45%,#0a0a0d_75%)]"
          : "bg-[radial-gradient(130%_90%_at_95%_0%,rgba(239,51,64,0.45),rgba(127,29,29,0.14)_45%,#0a0a0d_75%)]",
      )}
    >
      {pr && lift?.pr ? (
        <span className="inline-block rounded-full bg-[linear-gradient(90deg,#fde68a,#f59e0b)] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#2b1700]">
          New {SCOPE_WORD[lift.pr]}
        </span>
      ) : session ? (
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-red-400">{session}</span>
      ) : null}
      <div className={cn("font-display mt-2 uppercase leading-[0.98]", big ? "text-[40px]" : "text-[30px]")}>{stats.workout_title}</div>
      {lift && (
        <div className="mt-2.5">
          <div className="text-[12px] font-semibold text-white/65">{lift.name}</div>
          <div className={cn("font-display uppercase leading-none", big ? "text-[54px]" : "text-[42px]", pr ? "bg-[linear-gradient(90deg,#fde68a,#f59e0b)] bg-clip-text text-transparent" : "")}>
            {formatTopSet(lift.detail, unit)}
          </div>
        </div>
      )}
      {nums.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
          {nums.map((n) => (
            <div key={n.label} className="min-w-0">
              <div className={cn("font-display truncate uppercase leading-none", big ? "text-[30px]" : "text-[24px]")}>{n.value}</div>
              <div className="mt-1 truncate text-[9px] font-black uppercase tracking-[0.14em] text-white/55">{shortLabel(n.label)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Narrow DOM tiles: "Working sets" → "Sets". Share cards keep the long form. */
function shortLabel(label: string) {
  return /working sets?/i.test(label) ? "Sets" : label;
}

type Props = {
  post: CommunityPost;
  /** Signed thumbnail URL (already resolved for the whole page). */
  thumbUrl: string | null;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpen: (post: CommunityPost) => void;
  onOpenComments: (post: CommunityPost) => void;
  onOpenAuthor?: (author: CommunityAuthor) => void;
  onReact: (post: CommunityPost, next: ReactionKey | null) => void;
  /** Show the "double-tap to like" tip on this post (until the first double-tap). */
  doubleTapHint?: boolean;
  /** Someone double-tapped this post (so the tip can go). */
  onDoubleTap?: () => void;
  /** The tip finished playing. */
  onTipDone?: () => void;
};

function PostCardInner({ post, thumbUrl, unit, viewerIsStaff, onOpen, onOpenComments, onOpenAuthor, onReact, doubleTapHint, onDoubleTap, onTipDone }: Props) {
  const [burst, setBurst] = useState(0);
  const lastTap = useRef(0);
  const singleTimer = useRef<number | null>(null);
  const s = post.stats;
  const lift = s ? featuredLift(s) : null;
  const stats = s ? pickCardStats(s, unit) : [];
  const isNote = post.kind === "note";
  const lockedAt = !post.live ? lockInTimeLabel(post.locked_in_at) : null;
  const sub = [postTimeLabel(post.created_at), post.edited_at ? "Edited" : null, lockedAt ? `Locked in ${lockedAt}` : null, audienceNote(post)].filter(Boolean).join(" · ");

  // Tap opens the workout; double-tap gives ❤️ (Instagram muscle memory).
  // Already reacted? It stays as it is (a double-tap never takes one back).
  const onHeroTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      if (singleTimer.current) window.clearTimeout(singleTimer.current);
      singleTimer.current = null;
      lastTap.current = 0;
      setBurst((b) => b + 1);
      if (!post.my_reaction) onReact(post, REACTION.key);
      onDoubleTap?.();
      return;
    }
    lastTap.current = now;
    singleTimer.current = window.setTimeout(() => {
      singleTimer.current = null;
      onOpen(post);
    }, 280);
  };

  return (
    <article className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
      <header className="flex items-center justify-between gap-2 px-3.5 py-3">
        <AuthorLine author={post.author} sub={sub} onOpen={onOpenAuthor ? () => onOpenAuthor(post.author) : undefined} />
        <div className="flex shrink-0 items-center gap-1">
          {post.visibility !== "community" && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label={post.visibility === "coach" ? "Only the athlete and their coach see this" : "Only visible to you"} />}
          <PostActions post={post} viewerIsStaff={viewerIsStaff} />
        </div>
      </header>

      {/* Hero: the photo, or the workout itself when there isn't one */}
      <div role="button" tabIndex={0} onClick={onHeroTap} onKeyDown={(e) => e.key === "Enter" && onOpen(post)} className="relative cursor-pointer select-none" aria-label="Open workout">
        {isNote ? (
          <>
            <NoteBody post={post} clamp />
            <NoteExtras post={post} unit={unit} className="mx-4 mb-1 mt-2" />
          </>
        ) : post.media_type ? (
          <PostMedia post={post} thumbUrl={thumbUrl} />
        ) : s ? (
          <WorkoutHero stats={s} unit={unit} />
        ) : post.locked_in_at ? (
          <LockInHero post={post} />
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">Workout was reopened, numbers will be back once it's finished.</div>
        )}
        {doubleTapHint && burst === 0 && <DoubleTapHint onDone={onTipDone} />}
        <ReactionBurst n={burst} emoji={reactionEmoji(post.my_reaction) ?? REACTION.emoji} />
      </div>

      {/* A photo lock-in: the stamp sits under it until the numbers arrive */}
      {post.media_type && !s && post.locked_in_at && (
        <button type="button" onClick={() => onOpen(post)} className="block w-full px-3.5 pt-3 text-left">
          <div className="flex items-center gap-2">
            <h3 className="font-display shrink-0 text-[24px] uppercase leading-none">Locked in</h3>
            {isTrainingNow(post) ? <TrainingNowPill /> : <span className="text-[12px] font-bold text-muted-foreground">{lockInTimeLabel(post.locked_in_at)}</span>}
          </div>
          {post.session_title && <div className="mt-1 truncate text-[12px] font-semibold text-muted-foreground">{post.session_title}</div>}
        </button>
      )}

      {/* With a photo, the numbers sit under it, Strava style */}
      {post.media_type && s && (
        <button type="button" onClick={() => onOpen(post)} className="block w-full px-3.5 pt-3 text-left">
          <div className="flex items-center gap-2">
            <h3 className="font-display min-w-0 flex-1 truncate text-[22px] uppercase leading-none">{s.workout_title}</h3>
            {lift?.pr && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-px text-[10px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">{SCOPE_WORD[lift.pr]}</span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {lift && (
              <div className="col-span-2 min-w-0">
                <div className="font-display truncate text-[22px] uppercase leading-none">{formatTopSet(lift.detail, unit)}</div>
                <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{lift.name}</div>
              </div>
            )}
            {stats.slice(0, lift ? 2 : 4).map((x) => (
              <div key={x.label} className="min-w-0">
                <div className="font-display truncate text-[22px] uppercase leading-none">{x.value}</div>
                <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{shortLabel(x.label)}</div>
              </div>
            ))}
          </div>
        </button>
      )}

      {post.caption && !isNote && <FeedCaption name={post.author.name} caption={post.caption} />}

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

      <ReactionBar post={post} onReact={onReact} onOpenComments={onOpenComments} onOpenAuthor={onOpenAuthor} />
    </article>
  );
}

export const PostCard = memo(PostCardInner);

/**
 * The heart (tap for ❤️, hold for 👍 ‼️ 🔥 😂) and how many, then the faces
 * of who reacted ("Jared, Vicky and 3 others", with the kinds they gave),
 * which opens the full list. Comments on the right.
 */
export function ReactionBar({
  post,
  onReact,
  onOpenComments,
  onOpenAuthor,
}: {
  post: CommunityPost;
  onReact: (p: CommunityPost, next: ReactionKey | null) => void;
  onOpenComments?: (p: CommunityPost) => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
}) {
  const [listFor, setListFor] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);
  const { role } = useAuth();
  // Message the person who posted (never yourself; coaches use team chat with each other).
  const canMessage = !post.is_mine && !(post.author.is_coach && (role === "admin" || role === "coach"));
  const who = reactorsLine(post);
  // the little ❤️🔥😂 beside the names, once it's not just hearts
  const kinds = reactionKinds(post);
  const showKinds = kinds.length > 1 || (kinds.length === 1 && kinds[0] !== REACTION.emoji);
  const faces = [...(post.reactors ?? [])].sort((a, b) => Number(!!b.is_me) - Number(!!a.is_me)).slice(0, 3);
  return (
    <div className="flex items-center gap-1 px-2 pb-2 pt-2">
      <ReactionButton post={post} onReact={onReact} />
      {who && (
        <button
          type="button"
          onClick={() => setListFor(post.id)}
          className="flex min-w-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-left hover:bg-muted"
          aria-label={`See who reacted: ${who}`}
        >
          {faces.length > 0 && (
            <span className="flex shrink-0 -space-x-1.5">
              {faces.map((r) => (
                <span key={r.user_id} className="rounded-full ring-2 ring-card">
                  <UserAvatar src={r.avatar_url} name={r.is_me ? "You" : r.name} size={24} expandable={false} />
                </span>
              ))}
            </span>
          )}
          {showKinds && <span className="shrink-0 text-[13px] leading-none tracking-[-0.15em]">{kinds.join("")}</span>}
          <span className="truncate text-[12px] text-muted-foreground">
            <span className="font-bold text-foreground">{who}</span>
          </span>
        </button>
      )}
      {onOpenComments && (
        <button
          type="button"
          onClick={() => onOpenComments(post)}
          className="ml-auto flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold text-muted-foreground hover:bg-muted"
          aria-label={`Comments${post.comment_count ? `, ${post.comment_count}` : ""}`}
        >
          <MessageCircle className="h-4 w-4" />
          {post.comment_count > 0 ? post.comment_count : "Comment"}
        </button>
      )}
      {canMessage && (
        <button
          type="button"
          onClick={() => setMessaging(true)}
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
            !onOpenComments && "ml-auto",
          )}
          aria-label={`Message ${post.author.name}`}
          title={`Message ${post.author.name}`}
        >
          <Send className="h-[18px] w-[18px] -rotate-12" />
        </button>
      )}
      <ReactorsSheet postId={listFor} onClose={() => setListFor(null)} onOpenAuthor={onOpenAuthor} />
      {canMessage && <MessageAuthorSheet post={post} open={messaging} onOpenChange={setMessaging} />}
    </div>
  );
}

/** Feed media: the thumbnail only. Full-size image / video loads on demand. */
export function PostMedia({ post, thumbUrl, full = false }: { post: CommunityPost; thumbUrl: string | null; full?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const isVideo = post.media_type === "video";
  const w = post.media_width ?? 4;
  const h = post.media_height ?? 5;
  // Never taller than 4:5, never wider than 16:9 — keeps the feed rhythm steady.
  const ratio = Math.min(Math.max(w / h, 0.8), 1.78);
  const { data: fullUrl } = useFullMediaUrl(post.media_path, full || playing);
  const src = (full && !isVideo ? fullUrl : null) ?? thumbUrl;

  return (
    <div className="relative w-full overflow-hidden bg-muted" style={{ aspectRatio: String(ratio) }}>
      {isVideo && playing && fullUrl ? (
        <video src={fullUrl} poster={thumbUrl ?? undefined} className="h-full w-full object-cover" controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
      ) : (
        <>
          {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" /> : <div className="h-full w-full animate-pulse bg-muted" />}
          {isVideo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPlaying(true);
              }}
              className="absolute inset-0 grid place-items-center bg-black/10"
              aria-label="Play video"
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                <Play className="ml-0.5 h-6 w-6 fill-current" />
              </span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
