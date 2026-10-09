import { memo, useEffect, useRef, useState } from "react";
import { BadgeCheck, ChevronLeft, ChevronRight, Lock, MessageCircle, Pin, Play, Send } from "lucide-react";
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
  postSlides,
  postTimeLabel,
  reactionEmoji,
  reactionKinds,
  reactorsLine,
  sessionLine,
  slideThumbPath,
  type CommunityAuthor,
  type CommunityPost,
  type PostSlide,
  type ReactionKey,
  type WorkoutShareStats,
} from "@/lib/community";
import { useFullMediaUrl, useSlideThumbUrls } from "@/lib/community.queries";
import { WinsStatsCard } from "@/components/community/wins-stats";
import { SeriesExtraCard, SundayRecapCard } from "@/components/community/series-cards";
import { SpiritScene, isSpiritScene } from "@/components/community/spirit-scenes";
import { ReactorsSheet } from "@/components/community/reactors-sheet";
import { PostActions } from "@/components/community/post-actions";
import { FeedCaption } from "@/components/community/feed-caption";
import { PollCard } from "@/components/community/poll";
import { MessageAuthorSheet } from "@/components/community/message-author-sheet";
import { useAuth } from "@/lib/auth";
import { DoubleTapHint, ReactionBurst, ReactionButton } from "@/components/community/reaction-button";
import { SharedCommentCard, openCommunityPost } from "@/components/community/shared-comment";
import { CollaboratorsSheet, MentionText } from "@/components/community/mentions";

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
export function LockInHero({ post, size = "feed" }: { post: CommunityPost; size?: "feed" | "detail" }) {
  const now = isTrainingNow(post);
  const time = lockInTimeLabel(post.locked_in_at);
  const bg = "bg-[radial-gradient(130%_90%_at_95%_0%,rgba(239,51,64,0.55),rgba(127,29,29,0.16)_45%,#0a0a0d_75%)]";
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
export function NoteBody({ post, clamp = false, onOpenPerson }: { post: CommunityPost; clamp?: boolean; onOpenPerson?: (a: CommunityAuthor) => void }) {
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
          {/* just the name; where it was said stays on file (every quote is checked) */}
          {post.quote_author && <figcaption className="mt-1.5 text-[12px] font-semibold text-muted-foreground">{post.quote_author}</figcaption>}
        </figure>
      )}
      {post.caption && (
        <p className={cn("whitespace-pre-line leading-[1.45]", scene ? "text-[17px] font-semibold" : "text-[15px]", clamp && "line-clamp-[8]")}>
          <MentionText text={post.caption} mentions={post.mentions} onOpen={onOpenPerson} />
        </p>
      )}
      {post.poll && <PollCard post={post} onOpenPerson={onOpenPerson} className="mb-2" />}
    </div>
  );
}

/** Whatever a series post carries under its words: Sunday's report card, Wednesday's numbers, Tuesday's / Thursday's card. */
export function NoteExtras({ post, unit, className }: { post: CommunityPost; unit: "kg" | "lb"; className?: string }) {
  if (post.shared_comment) return <SharedCommentCard shared={post.shared_comment} className={className} onOpenPost={openCommunityPost} />;
  if (post.series === "sunday_recap" && isRecapStats(post.series_data)) return <SundayRecapCard stats={post.series_data} unit={unit} className={className} />;
  if (isWinsStats(post.series_data)) return <WinsStatsCard stats={post.series_data} unit={unit} className={className} />;
  return <SeriesExtraCard post={post} className={className} />;
}

export function AuthorLine({
  author,
  sub,
  onOpen,
  size = 40,
  collaborators,
  onOpenPerson,
}: {
  author: CommunityAuthor;
  sub?: string;
  onOpen?: () => void;
  size?: number;
  /** A collab post's other people: "Jared McIntyre and Dwayne" / "and 2 others". */
  collaborators?: CommunityAuthor[] | null;
  onOpenPerson?: (a: CommunityAuthor) => void;
}) {
  const collabs = collaborators ?? [];
  const [listOpen, setListOpen] = useState(false);
  const subLine =
    author.is_coach || sub ? (
      <div className="truncate text-[11px] leading-tight text-muted-foreground">
        {[author.is_coach ? author.title || "Coach · JF Effect" : null, sub].filter(Boolean).join(" · ")}
      </div>
    ) : null;

  if (collabs.length) {
    const small = Math.round(size * 0.74);
    const people = [author, ...collabs];
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <button type="button" onClick={() => setListOpen(true)} className="relative shrink-0" style={{ width: size, height: size }} aria-label="Who's on this post">
          <span className="absolute left-0 top-0">
            <UserAvatar src={author.avatar_url} name={author.name} size={small} expandable={false} />
          </span>
          <span className="absolute bottom-0 right-0 rounded-full ring-2 ring-card">
            <UserAvatar src={collabs[0].avatar_url} name={collabs[0].name} size={small} expandable={false} />
          </span>
        </button>
        <div className="min-w-0 text-left">
          <div className="flex min-w-0 items-center gap-1 text-sm leading-tight">
            {/* the poster's name stays whole where it can; the other name gives way first */}
            <button type="button" onClick={onOpen} className="max-w-[60%] shrink-0 truncate font-bold" aria-label={`${author.name}'s profile`}>
              {author.name}
            </button>
            {author.is_coach && <CoachBadge />}
            <span className="shrink-0 text-muted-foreground">and</span>
            {collabs.length === 1 ? (
              <button type="button" onClick={() => onOpenPerson?.(collabs[0])} className="min-w-0 truncate font-bold" aria-label={`${collabs[0].name}'s profile`}>
                {collabs[0].name}
              </button>
            ) : (
              <button type="button" onClick={() => setListOpen(true)} className="shrink-0 font-bold">
                {collabs.length} others
              </button>
            )}
          </div>
          {subLine}
        </div>
        <CollaboratorsSheet people={people} open={listOpen} onClose={() => setListOpen(false)} onOpen={(a) => (a.user_id === author.user_id ? onOpen?.() : onOpenPerson?.(a))} />
      </div>
    );
  }

  const body = (
    <>
      <UserAvatar src={author.avatar_url} name={author.name} size={size} expandable={false} />
      <div className="min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold leading-tight">{author.name}</span>
          {author.is_coach && <CoachBadge />}
        </div>
        {subLine}
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
export function WorkoutHero({ stats, unit, size = "feed" }: { stats: WorkoutShareStats; unit: "kg" | "lb"; size?: "feed" | "detail" }) {
  const lift = featuredLift(stats);
  const nums = pickCardStats(stats, unit);
  const pr = !!lift?.pr;
  const session = sessionLine(stats);
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
  /** First-time demo on "View full workout" (until they open one). */
  openHint?: boolean;
};

function PostCardInner({ post, thumbUrl, unit, viewerIsStaff, onOpen, onOpenComments, onOpenAuthor, onReact, doubleTapHint, onDoubleTap, onTipDone, openHint }: Props) {
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
        <AuthorLine author={post.author} sub={sub} onOpen={onOpenAuthor ? () => onOpenAuthor(post.author) : undefined} collaborators={post.collaborators} onOpenPerson={onOpenAuthor} />
        <div className="flex shrink-0 items-center gap-1">
          {post.visibility !== "community" && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label={post.visibility === "coach" ? "Only the athlete and their coach see this" : "Only visible to you"} />}
          <PostActions post={post} viewerIsStaff={viewerIsStaff} />
        </div>
      </header>

      {/* Hero: the photo, or the workout itself when there isn't one */}
      <div role="button" tabIndex={0} onClick={onHeroTap} onKeyDown={(e) => e.key === "Enter" && onOpen(post)} className="relative cursor-pointer select-none" aria-label="Open workout">
        {isNote ? (
          <>
            <NoteBody post={post} clamp onOpenPerson={onOpenAuthor} />
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

      {/* Every workout has more than the card shows: say so, plainly. */}
      {!isNote && s && <ViewWorkoutRow post={post} onOpen={() => onOpen(post)} hint={!!openHint} />}

      {post.caption && !isNote && <FeedCaption name={post.author.name} caption={post.caption} mentions={post.mentions} onOpenPerson={onOpenAuthor} />}

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
      <CommentPreviewList post={post} onOpenComments={() => onOpenComments(post)} />
    </article>
  );
}

export const PostCard = memo(PostCardInner);

/**
 * "View full workout ›" under a workout. The first time someone sees the feed it pulses with
 * a "Tap to see every set" bubble until they open a workout (remembered on the account).
 */
export function ViewWorkoutRow({ post, onOpen, hint }: { post: CommunityPost; onOpen: () => void; hint: boolean }) {
  const prs = post.stats?.pr_count ?? 0;
  return (
    <div className={cn("relative px-3.5 pt-3", hint && "z-[1]")}>
      {hint && (
        <div className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 animate-bounce" aria-hidden>
          <div className="relative whitespace-nowrap rounded-full bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground shadow-lg">
            👇 Tap to see every set & rep
            <span className="absolute left-1/2 top-full -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 bg-primary" />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-2xl px-3.5 text-left transition active:scale-[0.99]",
          hint ? "bg-primary/10 ring-2 ring-primary" : "bg-muted/60 hover:bg-muted",
        )}
        aria-label="View full workout"
      >
        {hint && <span className="pointer-events-none absolute inset-x-3.5 bottom-0 top-3 animate-pulse rounded-2xl bg-primary/15" aria-hidden />}
        <span className="text-[13px] font-bold">View full workout</span>
        <span className="flex min-w-0 items-center gap-1 text-[12px] font-semibold text-muted-foreground">
          <span className="truncate">{prs > 0 ? `Every set · ${prs} PR${prs === 1 ? "" : "s"}` : "Every set & rep"}</span>
          <ChevronRight className="h-4 w-4 shrink-0" />
        </span>
      </button>
    </div>
  );
}

/**
 * Instagram-style comments under a post: "View all N comments", then at most two lines (the
 * pinned one first). One line each, so a busy post never turns into a wall of chat.
 */
export function CommentPreviewList({ post, onOpenComments }: { post: CommunityPost; onOpenComments: () => void }) {
  const preview = post.comment_preview ?? [];
  if (!preview.length) return null;
  const more = post.comment_count > preview.length;
  return (
    <button type="button" onClick={onOpenComments} className="-mt-1 block w-full space-y-0.5 px-3.5 pb-3 text-left" aria-label={`Open comments (${post.comment_count})`}>
      {more && <div className="text-[13px] font-medium text-muted-foreground">View all {post.comment_count} comments</div>}
      {preview.map((c) => (
        <div key={c.id} className="flex min-w-0 items-baseline gap-1 text-[13px] leading-snug">
          {c.pinned && <Pin className="h-3 w-3 shrink-0 translate-y-[1px] rotate-45 text-muted-foreground" aria-label="Pinned" />}
          <span className="line-clamp-1 min-w-0">
            <span className="font-bold">{c.author.name}</span>
            {c.author.is_coach && <CoachBadge className="mx-0.5 inline h-3.5 w-3.5 -translate-y-px" />}{" "}
            <span className="text-foreground/85">{c.body || (c.media ? "📷 Photo" : "")}</span>
          </span>
        </div>
      ))}
    </button>
  );
}

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
  const slides = postSlides(post);
  const cover = slides[0] ?? null;
  // Never taller than 4:5, never wider than 16:9 — keeps the feed rhythm steady.
  // A carousel takes its cover's shape for every slide (Instagram does too).
  const ratio = Math.min(Math.max((post.media_width ?? 4) / (post.media_height ?? 5), 0.8), 1.78);
  if (slides.length > 1) return <PostCarousel slides={slides} coverUrl={thumbUrl} ratio={ratio} full={full} />;
  return (
    <div className="relative w-full overflow-hidden bg-muted" style={{ aspectRatio: String(ratio) }}>
      {cover ? <SlideMedia slide={cover} thumbUrl={thumbUrl} full={full} /> : <div className="h-full w-full animate-pulse bg-muted" />}
    </div>
  );
}

/** One photo or video, filling its frame. Video bytes only load when it's played. */
function SlideMedia({ slide, thumbUrl, full, active = true }: { slide: PostSlide; thumbUrl: string | null; full: boolean; active?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const isVideo = slide.type === "video";
  const { data: fullUrl } = useFullMediaUrl(slide.path, (full && active && !isVideo) || playing);
  const src = (full && !isVideo ? fullUrl : null) ?? thumbUrl;
  // swiping away stops it
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  // data-pinch-zoom: pinch lifts just this (the page never zooms), see useMediaPinchZoom
  return isVideo && playing && fullUrl ? (
    <div data-pinch-zoom className="absolute inset-0">
      <video src={fullUrl} poster={thumbUrl ?? undefined} className="h-full w-full object-cover" controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
    </div>
  ) : (
    <div data-pinch-zoom className="absolute inset-0">
      {src ? <FadeImg src={src} /> : <div className="h-full w-full animate-pulse bg-muted" />}
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
    </div>
  );
}

/** A photo that fades in once it has loaded (cached ones show at once), over a soft shimmer. */
function FadeImg({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    setLoaded(!!ref.current?.complete && (ref.current?.naturalWidth ?? 0) > 0);
  }, [src]);
  return (
    <>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />}
      <img
        ref={ref}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        data-loaded={loaded ? "" : undefined}
        className="media-fade relative h-full w-full object-cover"
      />
    </>
  );
}

/**
 * Up to 10 photos / videos: swipe sideways (it snaps one at a time), "2/5"
 * and the dots say where you are. Only the slide you're on and its
 * neighbours load; the rest wait. Taps still reach the post (open / double-tap).
 */
function PostCarousel({ slides, coverUrl, ratio, full }: { slides: PostSlide[]; coverUrl: string | null; ratio: number; full: boolean }) {
  const [index, setIndex] = useState(0);
  const [seen, setSeen] = useState(1);
  const track = useRef<HTMLDivElement | null>(null);
  const urls = useSlideThumbUrls(slides.slice(1));
  const onScroll = () => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    const i = Math.max(0, Math.min(slides.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
    if (i !== index) setIndex(i);
    if (i + 1 > seen) setSeen(i + 1);
  };
  const go = (dir: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };
  return (
    <div className="group/carousel relative w-full overflow-hidden bg-muted" style={{ aspectRatio: String(ratio) }} aria-roledescription="carousel" aria-label={`${slides.length} photos and videos`}>
      <div
        ref={track}
        onScroll={onScroll}
        data-carousel
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ overscrollBehaviorX: "none", WebkitOverflowScrolling: "touch" }}
      >
        {slides.map((sl, i) => {
          const near = Math.abs(i - index) <= 1 || i < seen;
          const url = i === 0 ? coverUrl : (urls[slideThumbPath(sl) ?? ""] ?? null);
          return (
            <div key={`${sl.path}-${i}`} className="relative h-full w-full shrink-0 snap-center snap-always" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
              {near ? <SlideMedia slide={sl} thumbUrl={url} full={full} active={i === index} /> : <div className="h-full w-full bg-muted" />}
            </div>
          );
        })}
      </div>
      <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white backdrop-blur">
        {index + 1}/{slides.length}
      </span>
      <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1" aria-hidden>
        {slides.map((_, i) => (
          <span key={i} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-white" : "w-1.5 bg-white/55")} />
        ))}
      </div>
      {/* mouse users get arrows (touch swipes) */}
      {index > 0 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); go(-1); }} className="absolute left-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-black shadow [@media(hover:hover)]:group-hover/carousel:grid" aria-label="Previous">
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {index < slides.length - 1 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); go(1); }} className="absolute right-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-black shadow [@media(hover:hover)]:group-hover/carousel:grid" aria-label="Next">
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
