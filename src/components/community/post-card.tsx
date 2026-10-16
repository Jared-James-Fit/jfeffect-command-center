import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { LiveDot } from "@/components/live-indicator";
import { BadgeCheck, CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Dumbbell, Flame, Lock, MessageCircle, Pin, Send, Star, Trophy } from "lucide-react";
import { InlineVideo, toggleFeedSound } from "@/components/community/inline-video";
import { UserAvatar } from "@/components/user-avatar";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { cn } from "@/lib/utils";
import {
  REACTION,
  SCOPE_WORD,
  extraHoliday,
  extraScene,
  featuredLift,
  isRecapStats,
  isWinsStats,
  formatTopSet,
  formatWorkoutDuration,
  isTrainingNow,
  pickWorkoutWin,
  lockInTimeLabel,
  workoutHeadline,
  workoutStats,
  workoutSubtitle,
  postSlides,
  postTimeLabel,
  reactionEmoji,
  reactionKinds,
  reactorsLine,
  slideThumbPath,
  type CommunityAuthor,
  type CommunityPost,
  type PostSlide,
  type ReactionKey,
  type WorkoutShareStats,
  type WorkoutWin,
} from "@/lib/community";
import { useFullMediaUrl, useSlideThumbUrls } from "@/lib/community.queries";
import { feedAspect, focusPosition } from "@/lib/photo-frame";
import { WinsStatsCard } from "@/components/community/wins-stats";
import { SeriesExtraCard, SundayRecapCard } from "@/components/community/series-cards";
import { LessonDiagram } from "@/components/community/lesson-card";
import { SpiritScene, isSpiritScene } from "@/components/community/spirit-scenes";
import { ReactorsSheet } from "@/components/community/reactors-sheet";
import { ReactionsRise, useEngagementPop } from "@/components/community/engagement-pop";
import { PostViewsRow, usePostViewTracker } from "@/components/community/post-views";
import { PostActions } from "@/components/community/post-actions";
import { FeedCaption } from "@/components/community/feed-caption";
import { PostExtras } from "@/components/community/post-attach";
import { NoteCaption } from "@/components/community/note-caption";
import { PollCard } from "@/components/community/poll";
import { MessageAuthorSheet } from "@/components/community/message-author-sheet";
import { useAuth } from "@/lib/auth";
import { DoubleTapHint, ReactionBurst, ReactionButton } from "@/components/community/reaction-button";
import { SharedCommentCard, openCommunityPost } from "@/components/community/shared-comment";
import { CollaboratorsSheet } from "@/components/community/mentions";
import { InlineFollow } from "@/components/community/follow-button";
import { RepostButton, RepostedHeader, SaveButton, useRepostNote } from "@/components/community/repost-save";

/** "● Training now" — a lock-in whose session is still open (and recent). */
export function TrainingNowPill({ className }: { className?: string }) {
  return (
    <span className={cn("jf-live-pill inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-white", className)}>
      <LiveDot size={6} tone="white" ring={false} /> Training now
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

/** "Only me" · "Just my coach" (author) · "Just you" (the coach) · "Close friends" · "Followers" (author) · "Weights hidden" (author). */
export function audienceNote(post: Pick<CommunityPost, "visibility" | "is_mine" | "hide_loads">): string | null {
  const parts: string[] = [];
  if (post.visibility === "private") parts.push("Only me");
  else if (post.visibility === "coach") parts.push(post.is_mine ? "Just my coach" : "Just you");
  else if (post.visibility === "close_friends") parts.push("Close friends");
  else if (post.visibility === "followers" && post.is_mine) parts.push("Followers");
  if (post.is_mine && post.hide_loads) parts.push("Weights hidden");
  return parts.length ? parts.join(" · ") : null;
}

/**
 * A member's own photo / clip post (POST on the camera): shown like
 * Instagram's, the picture edge to edge at its own shape, the words under it
 * ("Name caption"). A coach's posts keep their note layout (words in the post
 * font, the picture set in), so they read like his own posts.
 */
export function isPhotoPost(post: Pick<CommunityPost, "kind" | "media_type" | "series" | "quote" | "author">): boolean {
  return post.kind === "note" && !!post.media_type && !post.series && !post.quote && !post.author.is_coach;
}

/** The coach mark next to a name: small, verified-style, never a banner. */
export function CoachBadge({ className }: { className?: string }) {
  return <BadgeCheck className={cn("h-4 w-4 shrink-0 fill-primary text-primary-foreground", className)} aria-label="Coach" role="img" />;
}

/**
 * A coach's note (Monday Motivation, Finish Strong Friday, or a one-off):
 * a quiet series label, the featured quote with its speaker, then the words.
 * `clamp` (the feed): the words show whole unless they're long, and then stop
 * at the end of a sentence with "… more" (NoteCaption); the detail shows
 * everything. Every coach post reads in the regular post font, with or
 * without a picture.
 */
export function NoteBody({ post, clamp = false, onOpenPerson, cover }: { post: CommunityPost; clamp?: boolean; onOpenPerson?: (a: CommunityAuthor) => void; cover?: ReactNode }) {
  // Saturday: the picture says it, the words just sit under it. A photo of
  // the coach's own (the note's cover) takes the drawn scene's place.
  const scene = post.series === "saturday_spirit" && !cover ? extraScene(post.series_extra) : null;
  // A holiday: its photo, unless the coach put their own on the post.
  const holiday = post.series === "holiday" && !cover ? extraHoliday(post.series_extra) : null;
  // A lesson: its diagram is the picture (over the words), or sits under them
  // when the coach put a photo on it. Nothing else: no label, no sources.
  const lesson = post.series === "lesson";
  return (
    <div className="px-4 pb-1 pt-1">
      {/* no "Saturday Spirit" style day label: the post speaks for itself */}
      {cover && <div className="-mx-1 mb-3 overflow-hidden rounded-2xl">{cover}</div>}
      {scene && isSpiritScene(scene) && <SpiritScene scene={scene} className="mb-3 rounded-2xl" />}
      {holiday && <HolidayPhoto src={holiday.image} alt={holiday.name} />}
      {lesson && !cover && <LessonDiagram post={post} className="mb-3" />}
      {post.quote && (
        <figure className="mb-3 border-l-[3px] border-primary pl-3.5">
          <blockquote className="whitespace-pre-line text-[18px] font-semibold leading-[1.32] tracking-[-0.01em]">“{post.quote}”</blockquote>
          {/* just the name; where it was said stays on file (every quote is checked) */}
          {post.quote_author && <figcaption className="mt-1.5 text-[12px] font-semibold text-muted-foreground">{post.quote_author}</figcaption>}
        </figure>
      )}
      {post.caption && <NoteCaption text={post.caption} mentions={post.mentions} onOpenPerson={onOpenPerson} clamp={clamp} />}
      {lesson && cover && <LessonDiagram post={post} className="mt-3" />}
      <PostExtras post={post} className="mt-3" />
      {post.poll && <PollCard post={post} onOpenPerson={onOpenPerson} className="mb-2" />}
    </div>
  );
}

/** Whatever a series post carries under its words: Sunday's report card, Wednesday's numbers, Tuesday's / Thursday's card (a lesson's diagram is in NoteBody). */
export function NoteExtras({ post, unit, className }: { post: CommunityPost; unit: "kg" | "lb"; className?: string }) {
  if (post.shared_comment) return <SharedCommentCard shared={post.shared_comment} className={className} onOpenPost={openCommunityPost} />;
  if (post.series === "lesson") return null;
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
  trailing,
}: {
  author: CommunityAuthor;
  sub?: string;
  onOpen?: () => void;
  size?: number;
  /** A collab post's other people: "Jared McIntyre and Dwayne" / "and 2 others". */
  collaborators?: CommunityAuthor[] | null;
  onOpenPerson?: (a: CommunityAuthor) => void;
  /** After the name, on its line: "· Follow" for someone you don't follow yet. */
  trailing?: React.ReactNode;
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

  const nameLine = (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm font-bold leading-tight">{author.name}</span>
      {author.is_coach && <CoachBadge />}
    </div>
  );
  if (!onOpen) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <UserAvatar src={author.avatar_url} name={author.name} size={size} expandable={false} />
        <div className="min-w-0 text-left">
          {nameLine}
          {subLine}
        </div>
      </div>
    );
  }
  // the photo and the name lines open the profile; "· Follow" sits on the name's line, its own button
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <button type="button" onClick={onOpen} className="shrink-0 rounded-full" aria-label={`${author.name}'s profile`}>
        <UserAvatar src={author.avatar_url} name={author.name} size={size} expandable={false} />
      </button>
      <div className="min-w-0 text-left">
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-1.5 rounded-md text-left" tabIndex={-1} aria-hidden>
            <span className="truncate text-sm font-bold leading-tight">{author.name}</span>
            {author.is_coach && <CoachBadge />}
          </button>
          {trailing}
        </div>
        {subLine && (
          <button type="button" onClick={onOpen} className="block w-full min-w-0 text-left" tabIndex={-1} aria-hidden>
            {subLine}
          </button>
        )}
      </div>
    </div>
  );
}

export { WIN_STYLE };

/**
 * Pulse: a finished workout, posted by itself. It leads with the session's
 * one real win (pickWorkoutWin: a PR, a milestone, the top set), tinted to
 * match. Celebrating it is the heart under it (or a double-tap), like any post.
 */
export function PulseHero({ stats, unit }: { post?: CommunityPost; stats: WorkoutShareStats; unit: "kg" | "lb" }) {
  const win = pickWorkoutWin(stats, unit);
  const style = WIN_STYLE[win.kind];
  const nums = [formatWorkoutDuration(stats.duration_min), stats.working_sets > 0 && win.kind !== "done" ? `${stats.working_sets} sets` : null, win.kind !== "pr" && stats.pr_count > 0 ? `${stats.pr_count} PR${stats.pr_count === 1 ? "" : "s"}` : null].filter(Boolean);
  return (
    <div data-pulse={win.kind} className={cn("mx-3.5 overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0e] p-4 text-white", style.tint)}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10", style.text)}>
          <style.Icon className="h-4 w-4" />
        </span>
        <span className={cn("truncate text-[10px] font-black uppercase tracking-[0.16em]", style.text)}>{win.label}</span>
        <span className="ml-auto min-w-0 truncate text-[11px] font-semibold text-white/50">{workoutHeadline(stats)}</span>
      </div>
      <div className="font-display mt-3 text-[28px] uppercase leading-[1.02]">{win.headline}</div>
      {win.detail && (
        <div className={cn("font-display mt-0.5 text-[24px] uppercase leading-none", win.kind === "pr" ? "bg-[linear-gradient(90deg,#fde68a,#f59e0b)] bg-clip-text text-transparent" : "text-white/85")}>{win.detail}</div>
      )}
      {nums.length > 0 && <div className="mt-3 min-w-0 truncate text-[11px] font-semibold text-white/55">{nums.join(" · ")}</div>}
    </div>
  );
}

/**
 * Workout "card" drawn in the DOM (posts without a photo, profile tiles,
 * detail header). Same look as the share card so the feed feels branded, but
 * every number is the live canonical stat.
 */
export function WorkoutHero({ stats, unit, size = "feed" }: { stats: WorkoutShareStats; unit: "kg" | "lb"; size?: "feed" | "detail" }) {
  const lift = featuredLift(stats);
  const nums = workoutStats(stats, unit);
  const pr = !!lift?.pr;
  const subtitle = workoutSubtitle(stats);
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
      <span data-workout-completed className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/55">
        <CheckCircle2 className="h-3 w-3" /> Workout completed
      </span>
      {/* what was trained, then where it sits in the program */}
      <div className={cn("font-display mt-1.5 uppercase leading-[0.98]", big ? "text-[40px]" : "text-[30px]")}>{workoutHeadline(stats)}</div>
      {subtitle && <div className="mt-1 truncate text-[12px] font-semibold text-white/60">{subtitle}</div>}
      {lift && (
        <div className="mt-3">
          <div className="flex min-w-0 items-center gap-2">
            {pr && lift.pr && (
              <span className="shrink-0 rounded-full bg-[linear-gradient(90deg,#fde68a,#f59e0b)] px-2 py-px text-[9px] font-black uppercase tracking-[0.14em] text-[#2b1700]">
                New {SCOPE_WORD[lift.pr]}
              </span>
            )}
            <span className="truncate text-[12px] font-semibold text-white/65">{lift.name}</span>
          </div>
          <div className={cn("font-display uppercase leading-none", big ? "text-[54px]" : "text-[42px]", pr ? "bg-[linear-gradient(90deg,#fde68a,#f59e0b)] bg-clip-text text-transparent" : "")}>
            {formatTopSet(lift.detail, unit)}
          </div>
        </div>
      )}
      {nums.length > 0 && (
        <div className={cn("mt-4 grid gap-2 border-t border-white/10 pt-3", nums.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
          {nums.map((n) => (
            <div key={n.label} className="min-w-0">
              <div className={cn("font-display truncate uppercase leading-none", big ? "text-[30px]" : "text-[24px]")}>{n.value}</div>
              <div className="mt-1 truncate text-[9px] font-black uppercase tracking-[0.14em] text-white/55">{n.label}</div>
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
  // half on screen for two seconds = a view (never your own)
  const articleRef = useRef<HTMLElement | null>(null);
  usePostViewTracker(articleRef, post);
  const singleTimer = useRef<number | null>(null);
  const s = post.stats;
  const lift = s ? featuredLift(s) : null;
  const stats = s ? workoutStats(s, unit) : [];
  const isNote = post.kind === "note";
  const lockedAt = !post.live ? lockInTimeLabel(post.locked_in_at) : null;
  const sub = [post.auto && s ? "Finished a session" : null, postTimeLabel(post.created_at), post.edited_at ? "Edited" : null, lockedAt ? `Locked in ${lockedAt}` : null, audienceNote(post)].filter(Boolean).join(" · ");
  // a repost's note floats on the post (yours: tap to change it; "Add a note…" right after reposting)
  const note = useRepostNote(post);
  const reposted = !!post.reposted_by?.length;

  // Instagram's taps: a tap on a picture does nothing (a post never opens from
  // its picture: "View full workout" and the comments are buttons of their own),
  // a tap on a clip turns the sound on or off, and two quick taps give ❤️.
  // Already reacted? It stays as it is (a double-tap never takes one back).
  const onHeroTap = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (singleTimer.current) window.clearTimeout(singleTimer.current);
      singleTimer.current = null;
      lastTap.current = 0;
      setBurst((b) => b + 1);
      if (!post.my_reaction) onReact(post, REACTION.key);
      onDoubleTap?.();
      return;
    }
    lastTap.current = now;
    // a clip: sound on / off, once it's clear this wasn't the first of two taps
    if ((e.target as Element | null)?.closest?.("[data-inline-video]")) {
      singleTimer.current = window.setTimeout(() => {
        singleTimer.current = null;
        toggleFeedSound();
      }, 300);
    }
  };
  useEffect(() => () => {
    if (singleTimer.current) window.clearTimeout(singleTimer.current);
  }, []);
  const photo = isPhotoPost(post);

  return (
    // Instagram-style on a phone: edge to edge, no card frame, a hairline between
    // posts. A wider screen keeps the soft card (the feed column is centred there).
    <article ref={articleRef} data-feed-post className="-mx-3 overflow-hidden border-b border-border/60 bg-background pb-2 sm:mx-0 sm:rounded-3xl sm:border sm:border-border/70 sm:bg-card sm:pb-0 sm:shadow-sm">
      <RepostedHeader post={post} onOpenAuthor={onOpenAuthor} />
      <header className={cn("flex items-center justify-between gap-2 px-3.5 pb-3", reposted ? "pt-1.5" : "pt-3")}>
        <AuthorLine
          author={post.author}
          sub={sub}
          onOpen={onOpenAuthor ? () => onOpenAuthor(post.author) : undefined}
          collaborators={post.collaborators}
          onOpenPerson={onOpenAuthor}
          trailing={!post.is_mine && onOpenAuthor ? <InlineFollow userId={post.author.user_id} name={post.author.name} /> : null}
        />
        <div className="flex shrink-0 items-center gap-1">
          {post.visibility === "close_friends" ? (
            <Star className="h-3.5 w-3.5 fill-emerald-500 text-emerald-500" aria-label="Close friends only" />
          ) : post.visibility !== "community" && (post.visibility !== "followers" || post.is_mine) && (
            // a private account's post looks like any other to its followers (as on Instagram); the author sees the lock
            <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label={post.visibility === "coach" ? "Only the athlete and their coach see this" : post.visibility === "followers" ? "Only your followers see this" : "Only visible to you"} />
          )}
          <PostActions post={post} viewerIsStaff={viewerIsStaff} />
        </div>
      </header>

      {/* on words or a workout card the note sits above it, never over the words */}
      {note.bubble && !post.media_type && <div className="px-3.5 pb-2.5" data-note-above>{note.bubble}</div>}
      {/* Hero: the photo, or the workout itself when there isn't one. Taps never open the post (see onHeroTap). */}
      <div onClick={onHeroTap} className="relative select-none" data-post-hero>
        {isNote && !photo ? (
          <>
            <NoteBody post={post} clamp onOpenPerson={onOpenAuthor} cover={post.media_type ? <PostMedia post={post} thumbUrl={thumbUrl} /> : undefined} />
            {/* a coach post's photos / videos, under its words */}
            <NoteExtras post={post} unit={unit} className="mx-4 mb-1 mt-2" />
          </>
        ) : post.media_type ? (
          <PostMedia post={post} thumbUrl={thumbUrl} />
        ) : s && post.auto ? (
          <PulseHero post={post} stats={s} unit={unit} />
        ) : s ? (
          <WorkoutHero stats={s} unit={unit} />
        ) : post.locked_in_at ? (
          <LockInHero post={post} />
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">Workout was reopened, numbers will be back once it's finished.</div>
        )}
        {doubleTapHint && burst === 0 && <DoubleTapHint onDone={onTipDone} />}
        <ReactionBurst n={burst} emoji={reactionEmoji(post.my_reaction) ?? REACTION.emoji} />
        {/* on a photo the note floats on its top-left corner, Instagram's spot */}
        {note.bubble && post.media_type && <div className={cn("pointer-events-none absolute z-[2]", isNote && !photo ? "left-6 top-3" : "left-3 top-3")} data-note-over>{note.bubble}</div>}
      </div>
      {note.sheet}

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
          <span data-workout-completed className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" /> Workout completed
          </span>
          <div className="mt-1 flex items-center gap-2">
            <h3 className="font-display min-w-0 flex-1 truncate text-[22px] uppercase leading-none">{workoutHeadline(s)}</h3>
            {lift?.pr && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-px text-[10px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">{SCOPE_WORD[lift.pr]}</span>
            )}
          </div>
          {workoutSubtitle(s) && <div className="mt-1 truncate text-[12px] font-semibold text-muted-foreground">{workoutSubtitle(s)}</div>}
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

      {post.caption && (!isNote || photo) && <FeedCaption name={post.author.name} caption={post.caption} mentions={post.mentions} onOpenPerson={onOpenAuthor} />}
      {(!isNote || photo) && <PostExtras post={post} className="px-3.5 pt-2.5" />}

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

      <ReactionBar post={post} onReact={onReact} onOpenComments={onOpenComments} onOpenAuthor={onOpenAuthor} onReposted={note.ask} />
      <PostViewsRow post={post} onOpenAuthor={onOpenAuthor} />
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
 * Instagram's row: the heart (tap for ❤️, hold for 👍 ‼️ 🔥 😂), comments,
 * repost, message, and save at the end. Under it, the faces of who reacted
 * ("Jared, Vicky and 3 others", with the kinds they gave), which opens the
 * full list.
 */
export function ReactionBar({
  post,
  onReact,
  onOpenComments,
  onOpenAuthor,
  onReposted,
}: {
  post: CommunityPost;
  onReact: (p: CommunityPost, next: ReactionKey | null) => void;
  onOpenComments?: (p: CommunityPost) => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  /** Just reposted: the card floats "Add a note…" on the post. */
  onReposted?: () => void;
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
  // People are reacting to this one: a moment after it's on screen, its
  // reactions float up out of the heart and who reacted pops (never over the post).
  const pop = useEngagementPop<HTMLDivElement>(post);
  const { on, done } = pop;
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(done, 2400);
    return () => window.clearTimeout(t);
  }, [on, done]);
  return (
    <div ref={pop.ref} data-engagement-pop={on ? "" : undefined} className="relative px-2 pb-2 pt-1.5">
      {/* Instagram's row: like, comment, repost, message ... save at the end */}
      <div className="relative flex items-center">
        <ReactionButton post={post} onReact={onReact} />
        {on && <ReactionsRise kinds={kinds.length ? kinds : ["💬"]} className="bottom-1/2 left-5" />}
        {onOpenComments && (
          <button
            type="button"
            onClick={() => onOpenComments(post)}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-2 text-[14px] font-black tabular-nums text-muted-foreground hover:bg-muted"
            aria-label={`Comments${post.comment_count ? `, ${post.comment_count}` : ""}`}
          >
            <MessageCircle className="h-[23px] w-[23px] text-foreground/80" strokeWidth={2} />
            {post.comment_count > 0 && post.comment_count}
          </button>
        )}
        <RepostButton post={post} onReposted={onReposted} />
        {canMessage && (
          <button
            type="button"
            onClick={() => setMessaging(true)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground/80 hover:bg-muted hover:text-foreground"
            aria-label={`Message ${post.author.name}`}
            title={`Message ${post.author.name}`}
          >
            <Send className="h-[22px] w-[22px] -rotate-12" />
          </button>
        )}
        <span className="ml-auto" />
        <SaveButton post={post} />
      </div>
      {/* who reacted, on its own line under the row, so names never get cut short */}
      {who && (
        <button
          type="button"
          onClick={() => setListFor(post.id)}
          className={cn("-mt-0.5 flex max-w-full min-w-0 items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2 text-left hover:bg-muted", on && "engage-chip")}
          aria-label={`See who reacted: ${who}`}
          data-who-reacted
        >
          {faces.length > 0 && (
            <span className="flex shrink-0 -space-x-1.5">
              {faces.map((r) => (
                <span key={r.user_id} className="rounded-full ring-2 ring-card">
                  <UserAvatar src={r.avatar_url} name={r.is_me ? "You" : r.name} size={22} expandable={false} />
                </span>
              ))}
            </span>
          )}
          {showKinds && <span className="shrink-0 text-[13px] leading-none tracking-[-0.15em]">{kinds.join("")}</span>}
          <span className="truncate text-[13px] text-muted-foreground">
            <span className="font-bold text-foreground">{who}</span>
          </span>
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
  // A picture framed in the studio is already exactly its shape; a clip (or an
  // older photo) is cropped to it, showing the part its focus says.
  const ratio = feedAspect(post.media_width, post.media_height);
  if (slides.length > 1) return <PostCarousel slides={slides} coverUrl={thumbUrl} ratio={ratio} full={full} />;
  return (
    <div className="relative w-full overflow-hidden bg-muted" style={{ aspectRatio: String(ratio) }}>
      {cover ? <SlideMedia slide={cover} thumbUrl={thumbUrl} full={full} /> : <div className="h-full w-full animate-pulse bg-muted" />}
    </div>
  );
}

/** One photo or video, filling its frame. A clip plays muted while it's on screen (InlineVideo). */
function SlideMedia({ slide, thumbUrl, full, active = true }: { slide: PostSlide; thumbUrl: string | null; full: boolean; active?: boolean }) {
  const isVideo = slide.type === "video";
  const { data: fullUrl } = useFullMediaUrl(slide.path, full && active && !isVideo);
  const src = (full && !isVideo ? fullUrl : null) ?? thumbUrl;
  // data-pinch-zoom: pinch lifts just this (the page never zooms), see useMediaPinchZoom
  const position = focusPosition(slide.focus);
  return isVideo ? (
    <div data-pinch-zoom className="absolute inset-0">
      <InlineVideo path={slide.path} poster={thumbUrl} active={active} position={position} />
    </div>
  ) : (
    <div data-pinch-zoom className="absolute inset-0">
      {src ? <FadeImg src={src} position={position} /> : <div className="h-full w-full animate-pulse bg-muted" />}
    </div>
  );
}

/** A holiday post's photo, 4:5 like a feed photo. If the file is missing the words stand alone. */
function HolidayPhoto({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="relative -mx-1 mb-3 overflow-hidden rounded-2xl bg-muted" style={{ aspectRatio: "4 / 5" }}>
      <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} className="h-full w-full object-cover" />
    </div>
  );
}

/** A photo that fades in once it has loaded (cached ones show at once), over a soft shimmer. */
function FadeImg({ src, position }: { src: string; position?: string }) {
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
        style={position ? { objectPosition: position } : undefined}
      />
    </>
  );
}

/**
 * Up to 10 photos / videos: swipe sideways (it snaps one at a time), "2/5"
 * and the dots say where you are. Only the slide you're on and its
 * neighbours load; the rest wait. Taps still reach the post (double-tap ❤️, a clip's sound).
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
