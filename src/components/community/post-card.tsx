import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { LiveDot } from "@/components/live-indicator";
import { BadgeCheck, CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, Flame, Lock, MessageCircle, Pin, Send, Star, Target, Trophy } from "lucide-react";
import { CLIP_HOLD_EVENT, InlineVideo, toggleFeedSound } from "@/components/community/inline-video";
import { CLIP_SCRUB_EVENT, inClipScrubBand } from "@/lib/video-scrub";
import { justGaveSound, justStartedPlay } from "@/lib/video-pool";
import { UserAvatar } from "@/components/user-avatar";
import { StoryAvatar } from "@/components/community/story-ring";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { cn } from "@/lib/utils";
import {
  REACTION,
  SCOPE_WORD,
  canShareToStory,
  featuredLift,
  isAutoPost,
  isRecapStats,
  formatTopSet,
  formatWorkoutDuration,
  topSetOther,
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
  reactionTotal,
  slideThumbPath,
  type CommunityAuthor,
  type CommunityPost,
  type PostSlide,
  type ReactionKey,
  type WorkoutShareStats,
  type WorkoutWin,
} from "@/lib/community";
import { useFullMediaUrl, usePrefetchPostReactors, useSlideThumbUrls } from "@/lib/community.queries";
import { AMBIENT_SIZE, paintAmbient } from "@/lib/ambient-fill";
import { whenStill } from "@/lib/post-art";
import { carouselPlace, rememberCarouselPlace } from "@/lib/carousel-places";
import { FEED_MAX_ASPECT, FEED_VIDEO_MAX_HEIGHT, VIDEO_MIN_ASPECT, cleanFocus, clipFrame, feedAspect, focusPosition, photoZoomBox, screenFit, slideAspect, videoAspect, type MediaFocus } from "@/lib/photo-frame";
import { LikedBy, ReactorsSheet } from "@/components/community/reactors-sheet";
import { ReactionsRise, useEngagementPop } from "@/components/community/engagement-pop";
import { PostViewsRow, usePostViewTracker } from "@/components/community/post-views";
import { PostActions } from "@/components/community/post-actions";
import { FeedCaption } from "@/components/community/feed-caption";
import { PostExtras } from "@/components/community/post-attach";
import { NoteCaption, PICTURE_CAPTION_LIMITS } from "@/components/community/note-caption";
import { PollCard } from "@/components/community/poll";
import { InstagramShareSheet, PostShareSheet, preloadShareSheets } from "@/components/community/lazy-sheets";
import { PostArtImage } from "@/components/community/post-art";
import { instagramPlan, type IgCard } from "@/lib/instagram-export";
import { PostScoreChip, PostScoreRow } from "@/components/community/post-score";
import { openStoryShare, useStoryShareReady } from "@/lib/story-reply";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { DoubleTapHint, ReactionBurst, ReactionButton, useBurst } from "@/components/community/reaction-button";
import { useHoldToPause, useSoundFlash } from "@/components/community/clip-gestures";
import { SharedCommentCard, openCommunityPost } from "@/components/community/shared-comment";
import { CollaboratorsSheet } from "@/components/community/mentions";
import { InlineFollow } from "@/components/community/follow-button";
import { PageCaption } from "@/components/community/page-caption";
import { isFilmSummary, isOwnFilmCaption } from "@/lib/workout-film";
import { POST_SHEET_HEIGHT } from "@/lib/post-sheet";
import { RepostButton, RepostedHeader, SaveButton, useRepostNote } from "@/components/community/repost-save";
import { WeightOther } from "@/components/dual-weight";
import { WorkoutRecap } from "@/components/community/workout-recap";
import { FitScale } from "@/components/community/fit-scale";
import { recapIndex } from "@/lib/workout-recap";
import { splitAtWeight } from "@/lib/dual-weight";

/** "● Training now" — a lock-in whose session is still open (and recent). */
export function TrainingNowPill({ className }: { className?: string }) {
  return (
    <span className={cn("jf-live-pill inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white", className)}>
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
  const big = size === "detail";
  // a plain surface with the theme (never a glow), so it reads apart from the feed in light and dark
  return (
    <div className={cn("relative overflow-hidden bg-muted px-5 text-foreground", big ? "py-8" : "py-6")}>
      {now ? <TrainingNowPill /> : time ? <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{time}</span> : null}
      <div className={cn("font-display mt-2 uppercase leading-[0.95]", big ? "text-[60px]" : "text-[48px]")}>Locked in</div>
      <div className="mt-1.5 h-1.5 w-24 rounded-full bg-primary" />
      {post.session_title && <div className="mt-3 truncate text-[15px] font-bold text-foreground/80">{post.session_title}</div>}
      {post.live && <div className="mt-1 text-[12px] text-muted-foreground">Numbers land here when they finish.</div>}
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

/**
 * An automated post (the daily series, a lesson, a holiday, a birthday) is
 * an Instagram post: its picture edge to edge at 4:5, then the words. The
 * picture is its own card (a lesson's diagram, the week's numbers, a quote
 * in type, the holiday's photo, the one Save image and Share to Instagram
 * send); a photo on it (Saturday's made scene, or one the coach added) is the
 * picture instead, with a numbers card after it and a lesson's card before it.
 */
export function AutoPostHero({ post, thumbUrl, unit, full = false, page = false }: { post: CommunityPost; thumbUrl: string | null; unit: "kg" | "lb"; full?: boolean; page?: boolean }) {
  const plan = instagramPlan(post);
  const card = isAutoPost(post) ? plan.card : null;
  if (card === "deck" || ((card === "wins" || card === "recap") && (plan.cards ?? 1) > 1)) return <DeckHero post={post} card={card} thumbUrl={thumbUrl} unit={unit} full={full} page={page} count={plan.cards ?? 1} />;
  // `page`: a post's own screen in the feed, where the card it opens on holds the post's words until it's ready (all at once)
  if (post.media_type && card && !plan.cardLast) return <PostMedia post={post} thumbUrl={thumbUrl} full={full} ratio={0.8} lead={<PostArtImage post={post} card={card} unit={unit} fill eager={full} page={page} hold={page} />} />;
  if (post.media_type) return <PostMedia post={post} thumbUrl={thumbUrl} full={full} ratio={0.8} trail={card ? <PostArtImage post={post} card={card} unit={unit} fill page={page} /> : undefined} />;
  return card ? <PostArtImage post={post} card={card} unit={unit} eager={full} page={page} hold={page} /> : null;
}

/**
 * A deck's slides (post-decks.ts) as the post's picture: one painted card,
 * or a carousel of them that swipes like a photo post's (PostCarousel: the
 * browser keeps a vertical swipe the feed's), with a photo of its own after
 * the slides. The cover is painted first and holds the post's words on its
 * screen (all at once); once the post is within three screens every slide is
 * asked for (`near`), so a swipe never lands on a slide still being drawn
 * (a slide off to the side is clipped by the carousel, which an observer on
 * the slide itself would never call near).
 */
function DeckHero({ post, card = "deck", thumbUrl, unit, full, page, count }: { post: CommunityPost; card?: IgCard; thumbUrl: string | null; unit: "kg" | "lb"; full: boolean; page: boolean; count: number }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(full);
  useEffect(() => {
    if (near || count < 2) return;
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: "300%" });
    io.observe(el);
    return () => io.disconnect();
  }, [near, count]);
  if (count < 2 && !post.media_type) return <PostArtImage post={post} card={card} unit={unit} eager={full} page={page} hold={page} />;
  const slides = Array.from({ length: count }, (_, i) => (
    <PostArtImage key={i} post={post} card={card} slide={i} unit={unit} fill eager={i === 0 ? full : near} page={page} hold={page && i === 0} />
  ));
  return (
    <div ref={box} data-deck={count}>
      <PostMedia post={post} thumbUrl={thumbUrl} full={full} ratio={0.8} lead={slides} />
    </div>
  );
}

/**
 * An automated post's words under its picture, Instagram's way: the coach's
 * name, then his words in the post font, a short preview that ends at a
 * clean stop with "… more" (NoteCaption, PICTURE_CAPTION_LIMITS), then
 * anything else on it. The Recap's "work on this week" stays in the app (it's never
 * on the picture that can go public).
 */
export function AutoPostCaption({ post, clamp, onOpenPerson, className, named = true }: {
  post: CommunityPost;
  clamp: boolean;
  onOpenPerson?: (a: CommunityAuthor) => void;
  className?: string;
  /** The name in bold before the words (Instagram's caption); off where the author's row is right above (the feed's post sheet). */
  named?: boolean;
}) {
  const improve = isRecapStats(post.series_data) ? post.series_data.improve : null;
  return (
    <div className={cn("px-3.5 pt-3", className)} data-auto-caption>
      {post.caption?.trim() && <NoteCaption text={post.caption} mentions={post.mentions} onOpenPerson={onOpenPerson} clamp={clamp} lead={named ? post.author.name : null} limits={PICTURE_CAPTION_LIMITS} />}
      {improve && (
        <div className="mt-2.5 flex items-start gap-2.5 rounded-2xl bg-muted/60 px-3 py-2.5" data-recap-improve>
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Work on this week</div>
            <div className="text-[13px] font-semibold leading-snug">{improve.text}</div>
          </div>
        </div>
      )}
      {post.poll && <PollCard post={post} onOpenPerson={onOpenPerson} className="mt-3" />}
      <PostExtras post={post} className="mt-2.5" />
    </div>
  );
}

/** The coach mark next to a name: small, verified-style, never a banner. */
export function CoachBadge({ className }: { className?: string }) {
  return <BadgeCheck className={cn("h-4 w-4 shrink-0 fill-primary text-primary-foreground", className)} aria-label="Coach" role="img" />;
}

/**
 * A coach's own note ("+ Post", a shared comment): the featured quote with
 * its speaker, then the words, a photo of his own set in above them.
 * `clamp` (the feed): the words show whole unless they're long, and then stop
 * at the end of a sentence with "… more" (NoteCaption); the detail shows
 * everything. Every coach post reads in the regular post font. Automated
 * posts (the series, lessons, holidays, birthdays) aren't notes: they're a
 * picture with the words under it (AutoPostHero, AutoPostCaption).
 */
export function NoteBody({ post, clamp = false, onOpenPerson, cover }: { post: CommunityPost; clamp?: boolean; onOpenPerson?: (a: CommunityAuthor) => void; cover?: ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-1">
      {cover && <div className="-mx-1 mb-3 overflow-hidden rounded-2xl">{cover}</div>}
      {post.quote && (
        <figure className="mb-3 border-l-[3px] border-primary pl-3.5">
          <blockquote className="whitespace-pre-line text-[18px] font-semibold leading-[1.32] tracking-[-0.01em]">“{post.quote}”</blockquote>
          {/* just the name; where it was said stays on file (every quote is checked) */}
          {post.quote_author && <figcaption className="mt-1.5 text-[12px] font-semibold text-muted-foreground">{post.quote_author}</figcaption>}
        </figure>
      )}
      {post.caption && <NoteCaption text={post.caption} mentions={post.mentions} onOpenPerson={onOpenPerson} clamp={clamp} />}
      <PostExtras post={post} className="mt-3" />
      {post.poll && <PollCard post={post} onOpenPerson={onOpenPerson} className="mb-2" />}
    </div>
  );
}

/** What a coach's note carries under its words: a comment he shared. */
export function NoteExtras({ post, className }: { post: CommunityPost; unit?: "kg" | "lb"; className?: string }) {
  if (post.shared_comment) return <SharedCommentCard shared={post.shared_comment} className={className} onOpenPost={openCommunityPost} />;
  return null;
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
        {/* their story ring when they have one up (a tap plays it); else a plain photo */}
        <StoryAvatar userId={author.user_id} src={author.avatar_url} name={author.name} size={size} />
        <div className="min-w-0 text-left">
          {nameLine}
          {subLine}
        </div>
      </div>
    );
  }
  // the photo plays their story when they have one up (Instagram's), else it and the name lines open the
  // profile; "· Follow" sits on the name's line, its own button
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <StoryAvatar userId={author.user_id} src={author.avatar_url} name={author.name} size={size} onPress={onOpen} pressLabel={`${author.name}'s profile`} />
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
 * match. Liking it is the heart under it (or a double-tap), like any post.
 */
export function PulseHero({ stats, unit }: { post?: CommunityPost; stats: WorkoutShareStats; unit: "kg" | "lb" }) {
  const win = pickWorkoutWin(stats, unit);
  const style = WIN_STYLE[win.kind];
  const nums = [formatWorkoutDuration(stats.duration_min), stats.working_sets > 0 && win.kind !== "done" ? `${stats.working_sets} sets` : null, win.kind !== "pr" && stats.pr_count > 0 ? `${stats.pr_count} PR${stats.pr_count === 1 ? "" : "s"}` : null].filter(Boolean);
  return (
    <div data-pulse={win.kind} className="mx-3.5 overflow-hidden rounded-2xl bg-muted p-4 text-foreground">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full bg-background", style.tone)}>
          <style.Icon className="h-4 w-4" />
        </span>
        <span className={cn("truncate text-[10px] font-bold uppercase tracking-[0.16em]", style.tone)}>{win.label}</span>
        <span className="ml-auto min-w-0 truncate text-[11px] font-semibold text-muted-foreground">{workoutHeadline(stats)}</span>
      </div>
      <div className="font-display mt-3 text-[28px] uppercase leading-[1.02]">{win.headline}</div>
      {win.detail && <div className={cn("font-display mt-0.5 text-[24px] uppercase leading-none", win.kind === "pr" ? "text-warning" : "text-foreground/85")}>{win.detail}</div>}
      {/* the same weight in the other unit, quieter: the lift as typed stays the hero */}
      {win.other && <WeightOther className="mt-1 block text-[13px]">{win.other}</WeightOther>}
      {nums.length > 0 && <div className="mt-3 min-w-0 truncate text-[11px] font-semibold text-muted-foreground">{nums.join(" · ")}</div>}
    </div>
  );
}

/**
 * Workout "card" drawn in the DOM (posts without a photo, profile tiles,
 * detail header): a plain surface with the theme, the session, its best lift
 * (amber for a PR) and the numbers; never a glow or gradient. Every number is
 * the live canonical stat.
 */
export function WorkoutHero({ stats, unit, size = "feed" }: { stats: WorkoutShareStats; unit: "kg" | "lb"; size?: "feed" | "detail" }) {
  const lift = featuredLift(stats);
  const nums = workoutStats(stats, unit);
  const pr = !!lift?.pr;
  const subtitle = workoutSubtitle(stats);
  const big = size === "detail";
  return (
    <div className={cn("@container relative overflow-hidden bg-muted px-5 text-foreground", big ? "py-7" : "py-5")} data-workout-hero={pr ? "pr" : "done"}>
      <span data-workout-completed className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-success">
        <CheckCircle2 className="h-3 w-3" /> Workout completed
      </span>
      {/* what was trained, then where it sits in the program */}
      <div className={cn("font-display mt-1.5 uppercase leading-[0.98]", big ? "text-[40px]" : "text-[30px]")}>{workoutHeadline(stats)}</div>
      {subtitle && <div className="mt-1 truncate text-[12px] font-semibold text-muted-foreground">{subtitle}</div>}
      {lift && (
        <div className="mt-3">
          <div className="flex min-w-0 items-center gap-2">
            {pr && lift.pr && (
              <span className="shrink-0 rounded-full bg-warning/15 px-2 py-px text-[9px] font-bold uppercase tracking-[0.14em] text-warning">
                New {SCOPE_WORD[lift.pr]}
              </span>
            )}
            <span className="truncate text-[12px] font-semibold text-muted-foreground">{lift.name}</span>
          </div>
          <div className={cn("font-display uppercase leading-none", big ? "text-[54px] @max-[16rem]:text-[44px]" : "text-[42px]", pr && "text-warning")}>{formatTopSet(lift.detail, unit)}</div>
          <WeightOther className={cn("mt-1 block", big ? "text-[15px]" : "text-[13px]")}>{topSetOther(lift.detail, unit)}</WeightOther>
        </div>
      )}
      {nums.length > 0 && (
        // three numbers sit at their own widths across the card (a step smaller on a narrow one, and a line of their own before
        // anything's cut), so a long volume ("17,902 LB") shows whole instead of "17,902 …"
        <div className={cn("mt-4 gap-2 border-t border-border pt-3", nums.length === 3 ? "flex flex-wrap justify-between gap-x-3 gap-y-3" : "grid grid-cols-2")} data-workout-nums>
          {nums.map((n) => (
            <div key={n.label} className="min-w-0">
              <div className={cn("font-display truncate uppercase leading-none", big ? "text-[30px] @max-[16rem]:text-[24px]" : "text-[24px] @max-[15rem]:text-[20px]")}>{n.value}</div>
              <SubLine sub={n.sub} row={nums} className="mt-0.5 block truncate text-[11px]" />
              <div className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{n.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A number's other unit under it ("8,120 kg" under "17,902 lb"). In a row
 * where any number has one, the others keep the line empty, so every label
 * still sits on one line across the row.
 */
function SubLine({ sub, row, className }: { sub?: string | null; row: { sub?: string | null }[]; className: string }) {
  if (sub) return <WeightOther className={className}>{sub}</WeightOther>;
  if (!row.some((r) => r.sub)) return null;
  return (
    <span aria-hidden className={cn(className, "font-semibold")}>
      {"\u00a0"}
    </span>
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
  /**
   * First-time tip on the workout: on a post's screen, "Swipe for workout" on
   * its recap (until they reach one); on the card feed, "View full workout".
   */
  openHint?: boolean;
  /** They reached a workout's recap (the swipe tip can go). */
  onRecapSeen?: () => void;
  /** A tap on one of its clips: open the clips full screen there (the feed's ReelsViewer). Without it, a tap toggles the sound. */
  onOpenReel?: (post: CommunityPost, path: string) => void;
  /**
   * "page": the post as one screen of the Crew feed, swiped one at a time
   * (TikTok's): its picture or clip as big as the screen allows, the name and
   * words over the bottom, ❤️ 💬 🔁 ✈️ 🔖 down the right. "card" (the
   * default): Instagram's card, the words and buttons under the picture.
   */
  layout?: "card" | "page";
  /**
   * "page" only: a tap on the words opens the post's sheet (PostSheet: the
   * whole caption with the comments under it, Reels'); the words show as a
   * two-line preview with "… more" (PageCaption).
   */
  onOpenCaption?: (post: CommunityPost) => void;
  /** "page" only: this post's sheet is open, so the post shrinks into the space above it and its words and buttons step aside. */
  sheetOpen?: boolean;
  /** "page" only: the feed's first post, under the stories (TikTok's Friends): its top corners are rounded, like a card coming up. */
  pageFirst?: boolean;
  /**
   * "page" only: a workout's every set, from its recap (the last swipe): the
   * post's sheet on its Workout tab, over the post, so closing it lands back on
   * the same slide. Without it the recap opens the workout page (`onOpen`).
   */
  onOpenWorkout?: (post: CommunityPost) => void;
};

function PostCardInner({ post, thumbUrl, unit, viewerIsStaff, onOpen, onOpenComments, onOpenAuthor, onReact, doubleTapHint, onDoubleTap, onTipDone, openHint, onRecapSeen, onOpenReel, layout = "card", onOpenCaption, sheetOpen = false, pageFirst = false, onOpenWorkout }: Props) {
  const [burst, fireBurst] = useBurst();
  const lastTap = useRef(0);
  // half on screen for two seconds = a view (never your own)
  const articleRef = useRef<HTMLElement | null>(null);
  usePostViewTracker(articleRef, post);
  // the feed's first post while the stories sit over it (TikTok's Friends): its words and buttons
  // wait until it's up whole, the way TikTok's sit below the screen there
  const [under, setUnder] = useState(false);
  useEffect(() => {
    if (layout !== "page" || !pageFirst) return setUnder(false);
    let raf = 0;
    const check = () => {
      raf = 0;
      setUnder(belowSnap(articleRef.current) > 4);
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
    };
  }, [layout, pageFirst]);
  // on its screen, how tall its words are (who, the caption, views): a picture shown whole sits in the
  // room above them, TikTok's, so the words never cover it (--page-words-h → --feed-words-room,
  // styles.css). Their own height, never where they sit: the screen's reading settling (--feed-gap)
  // moves them without resizing anything, and a stale position left the picture a gap short of them
  const wordsRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const a = articleRef.current;
    const w = wordsRef.current;
    const box = w?.parentElement;
    if (layout !== "page" || !a || !w || !box) return;
    const set = () => {
      const h = box.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(box).paddingBottom) || 0) - w.getBoundingClientRect().top;
      if (h > 0) a.style.setProperty("--page-words-h", `${Math.round(h)}px`);
    };
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(w);
    ro.observe(a);
    return () => ro.disconnect();
  }, [layout]);
  // its sheet open: the shrunk post sits right under Crew's bar (over the story rail on the first screen)
  const [raise, setRaise] = useState(0);
  useLayoutEffect(() => {
    const a = articleRef.current;
    if (layout !== "page" || !sheetOpen || !a) return setRaise(0);
    setRaise(belowBar(a));
  }, [layout, sheetOpen]);
  const singleTimer = useRef<number | null>(null);
  // on its own screen (Instagram's Reels): a tap on a clip turns the sound on or off and says so in the
  // middle of it, a finger held on it pauses it with the words and buttons out of the way
  const [soundFlash, flashSound] = useSoundFlash();
  // press and hold a clip (Reels'): it pauses, the words and buttons step aside, letting go plays it again.
  // On every clip a post shows (its own screen, the coach's cards, the post's page), never with its sheet open
  const hold = useHoldToPause<Element>(
    (e) => {
      if (sheetOpen) return null;
      const t = e.target as Element | null;
      const clip = t?.closest?.("[data-inline-video]");
      // the bottom of a clip is its progress bar's: a finger resting there is about to scrub, never a pause
      return clip && !t?.closest?.("button") && !inClipScrubBand(clip, e.clientX, e.clientY) ? clip : null;
    },
    (clip, on) => clip.dispatchEvent(new CustomEvent(CLIP_HOLD_EVENT, { detail: on })),
  );
  // a finger on a clip's bar (VideoScrubber) is the same on its screen: the words and buttons step aside while it scrubs
  const [scrubbing, setScrubbing] = useState(false);
  useEffect(() => {
    const a = articleRef.current;
    if (!a) return;
    const on = (e: Event) => setScrubbing((e as CustomEvent<boolean>).detail === true);
    a.addEventListener(CLIP_SCRUB_EVENT, on);
    return () => a.removeEventListener(CLIP_SCRUB_EVENT, on);
  }, []);
  const holding = layout === "page" && (hold.holding || scrubbing);
  // held, the whole screen is the clip (Reels'): Crew's bar steps aside too (styles.css, html[data-clip-held])
  useEffect(() => {
    if (!holding) return;
    document.documentElement.setAttribute("data-clip-held", "");
    return () => document.documentElement.removeAttribute("data-clip-held");
  }, [holding]);
  // on a post's screen its words say which set the clip on screen is (a workout film's slide, postSlides);
  // its carousel reports the slide, kept per post so another post's slide is never read
  const [screenSlide, setScreenSlide] = useState<{ id: string; i: number }>({ id: post.id, i: 0 });
  const slideSet = layout === "page" ? (postSlides(post)[screenSlide.id === post.id ? screenSlide.i : 0]?.caption ?? null) : null;
  const showSlide = (i: number) => setScreenSlide((v) => (v.id === post.id && v.i === i ? v : { id: post.id, i }));
  const s = post.stats;
  // a workout's recap is the post's last swipe on its screen (after its photos and clips, or after the workout's card
  // when it has none): never a page it sends you to. Not on a Pulse or a coach's note
  const recapOn = layout === "page" && !!s && !post.auto && post.kind !== "note";
  const recapCtl = useRef<CarouselControl | null>(null);
  // every set: the post's sheet on its Workout tab (over the post), else the workout page
  const openSets = () => (onOpenWorkout ? onOpenWorkout(post) : onOpen(post));
  const toRecap = () => (recapCtl.current ? recapCtl.current.toEnd() : openSets());
  const recapSlide = recapOn
    ? ({ load, active }: { load: boolean; active: boolean }) => (
        <WorkoutRecap post={post} unit={unit} load={load || active} shrunk={sheetOpen} onOpenWorkout={openSets} />
      )
    : undefined;
  // who liked it: the "Liked by" line under the words and the number by the heart open the same Likes
  const [likesOpen, setLikesOpen] = useState(false);
  const lift = s ? featuredLift(s) : null;
  const stats = s ? workoutStats(s, unit) : [];
  const isNote = post.kind === "note";
  // the daily series, lessons, holidays, birthdays: a picture, then the words (Instagram's layout)
  const auto = isAutoPost(post);
  const lockedAt = !post.live ? lockInTimeLabel(post.locked_in_at) : null;
  const sub = [post.auto && s ? "Finished a session" : null, postTimeLabel(post.created_at), post.edited_at ? "Edited" : null, lockedAt ? `Locked in ${lockedAt}` : null, audienceNote(post)].filter(Boolean).join(" · ");
  // a repost's note floats on the post (yours: tap to change it; "Add a note…" right after reposting)
  // a picture shows it in its bottom-left corner (Instagram's spot); words and coach posts above them
  const overPicture = auto || (!!post.media_type && !(isNote && !isPhotoPost(post)));
  const note = useRepostNote(post, { preview: thumbUrl, onOpenAuthor, inline: !overPicture });
  const reposted = !!post.reposted_by?.length;

  // Instagram's taps: a tap on a picture does nothing (a post never opens from
  // its picture: "View full workout" and the comments are buttons of their own),
  // a tap on a clip turns its sound on or off on a post's own screen (Reels';
  // a finger held on it pauses it), opens the clips full screen on the coach's
  // feed of cards (where there's no viewer it's the sound again), and two quick
  // taps give ❤️. Already reacted? It stays as it is (a double-tap never takes one back).
  const onHeroTap = (e: React.MouseEvent) => {
    const now = Date.now();
    // letting go of a held clip (it was paused): that's not a tap
    if (hold.justReleased()) return;
    if (now - lastTap.current < 300) {
      if (singleTimer.current) window.clearTimeout(singleTimer.current);
      singleTimer.current = null;
      lastTap.current = 0;
      // the ❤️ springs in where the finger was (Instagram's, TikTok's)
      fireBurst(e);
      if (!post.my_reaction) onReact(post, REACTION.key);
      onDoubleTap?.();
      return;
    }
    lastTap.current = now;
    // on its own screen, a post still partly under the stories comes up whole on a tap (TikTok's Friends)
    if (layout === "page") {
      const below = belowSnap(articleRef.current);
      if (below > 4) {
        singleTimer.current = window.setTimeout(() => {
          singleTimer.current = null;
          window.scrollBy({ top: below, behavior: "smooth" });
        }, 300);
        return;
      }
    }
    // a workout's recap on its own screen: a tap anywhere on its card opens every set in the post's sheet, over the post
    // (once it's clear this wasn't the first of two taps); its card before it does nothing (the swipe is the way there)
    if (layout === "page" && !sheetOpen && (e.target as Element | null)?.closest?.("[data-recap-card]")) {
      singleTimer.current = window.setTimeout(() => {
        singleTimer.current = null;
        openSets();
      }, 300);
      return;
    }
    // a clip: full screen (or sound on / off), once it's clear this wasn't the first of two taps
    const clip = (e.target as Element | null)?.closest?.("[data-inline-video]");
    if (!clip) return;
    // the tap that started a clip the phone wouldn't start by itself (Low Power Mode) is for starting it
    if (justStartedPlay()) return;
    const path = clip.getAttribute("data-slide-path");
    // the tap that gave a clip the phone held quiet its sound is for the sound: it doesn't mute it again
    // (opening the full-screen clips still goes ahead: they play with sound too)
    const forSound = justGaveSound();
    // on its own screen a clip is already full size: a tap is its sound, on or off, said in the middle (Instagram's)
    if (layout === "page") {
      // a clip with no sound: the tap says so and leaves the feed's sound as it was
      if (clip.hasAttribute("data-silent")) {
        singleTimer.current = window.setTimeout(() => {
          singleTimer.current = null;
          flashSound(false);
        }, 300);
        return;
      }
      if (forSound) {
        flashSound(true);
        return;
      }
      singleTimer.current = window.setTimeout(() => {
        singleTimer.current = null;
        flashSound(toggleFeedSound());
      }, 300);
      return;
    }
    if (onOpenReel && path) {
      // the tap itself already let the full-screen clips make sound (video-pool.ts listens for taps)
      singleTimer.current = window.setTimeout(() => {
        singleTimer.current = null;
        onOpenReel(post, path);
      }, 300);
      return;
    }
    if (forSound) return;
    singleTimer.current = window.setTimeout(() => {
      singleTimer.current = null;
      toggleFeedSound();
    }, 300);
  };
  useEffect(() => () => {
    if (singleTimer.current) window.clearTimeout(singleTimer.current);
  }, []);
  const photo = isPhotoPost(post);

  if (layout === "page") {
    // a picture, a clip or an automated post's card: on black, as big as the screen allows
    const visual = auto || !!post.media_type;
    const liked = reactionTotal(post) > 0;
    // the coach among the "Liked by" faces (its first three), so the line already says it
    const coachInFaces = (post.reactors ?? []).slice(0, 3).some((r) => r.is_coach);
    // a clip has its progress bar along the screen's bottom: the words and buttons sit a lane above it (styles.css)
    const hasClip = visual && !auto && postSlides(post).some((sl) => sl.type === "video");
    return (
      <article
        ref={articleRef}
        data-feed-post
        data-feed-page-post={visual ? "visual" : "words"}
        // a drag that starts low on the screen, over the words too, can scrub the clip (VideoScrubber's band)
        data-scrub-band
        data-has-clip={hasClip ? "" : undefined}
        className={cn(
          "relative h-full w-full text-foreground",
          raise > 0 ? "z-[1] overflow-visible" : "overflow-hidden",
          visual ? "dark bg-black" : "bg-background",
          pageFirst && "rounded-t-[18px]",
        )}
      >
        {/* the post itself; taps never open it (a clip: one tap its sound, a hold pauses it; two taps ❤️). Its sheet open: it shrinks into the space above it, still playing */}
        <div
          onClick={onHeroTap}
          {...hold.handlers}
          className={cn(
            "absolute inset-x-0 select-none transition-[top,bottom] duration-300 ease-out [-webkit-touch-callout:none] motion-reduce:transition-none",
            sheetOpen && (visual ? "bg-black" : "bg-background"),
          )}
          // the whole screen down to the tab bar, Crew's bar floating over its top (TikTok's); its sheet open, down to the sheet
          style={{ top: -raise, bottom: sheetOpen ? `calc(${POST_SHEET_HEIGHT} - var(--feed-gap, 0px))` : "var(--feed-nav-room)" }}
          data-post-hero
          data-sheet-open={sheetOpen ? "" : undefined}
        >
          {visual ? (
            auto ? (
              // an automated post's 4:5 card: the full width, black above and below, centred between the bars
              // (its sheet open: a rounded card above it, Instagram's)
              <FitBox ratio={0.8} page shrunk={sheetOpen}>
                <AutoPostHero post={post} thumbUrl={thumbUrl} unit={unit} page />
              </FitBox>
            ) : (
              // its own photos and clips: the screen is the canvas (TikTok's), PostMedia page;
              // its sheet open, a rounded card at its own shape above it (Instagram's)
              // a workout's recap rides after them as the last swipe
              <PostMedia
                post={post}
                thumbUrl={thumbUrl}
                page
                shrunk={sheetOpen}
                onSlide={showSlide}
                pageTrail={recapSlide}
                control={recapCtl}
                hint={!!openHint && recapOn && !under && !sheetOpen && !holding}
                onReachEnd={onRecapSeen}
              />
            )
          ) : recapOn && s ? (
            // a workout with no picture: its card, then one swipe to the recap (the same two screens as a clip and its recap)
            <PostCarousel
              slides={[]}
              coverUrl={null}
              frame={{}}
              full={false}
              page
              bare
              leads={[
                <div key="cover" className={cn("absolute", sheetOpen ? "inset-0 p-2.5 pr-12" : "inset-x-0 pl-3 pr-16")} style={sheetOpen ? undefined : RECAP_ROOM} data-page-body>
                  <FitScale>
                    <WorkoutCoverCard post={post} onRecap={toRecap}>
                      <WorkoutHero stats={s} unit={unit} />
                    </WorkoutCoverCard>
                  </FitScale>
                </div>,
              ]}
              pageTrail={recapSlide}
              control={recapCtl}
              hint={!!openHint && !under && !sheetOpen}
              onSlide={showSlide}
              onReachEnd={onRecapSeen}
              place={`page:${post.id}`}
            />
          ) : (
            // words, a workout, a lock in: centred, clear of the words and buttons around it (it scrolls when it's long)
            <div className="absolute inset-0 overflow-y-auto pl-3 pr-16" style={sheetOpen ? PAGE_BODY_SHRUNK : PAGE_BODY_ROOM} data-page-body>
              <div className="flex min-h-full flex-col justify-center gap-3">
                {isNote ? (
                  <>
                    <NoteBody post={post} onOpenPerson={onOpenAuthor} />
                    <NoteExtras post={post} unit={unit} className="mx-4" />
                  </>
                ) : s && post.auto ? (
                  <>
                    <PulseHero post={post} stats={s} unit={unit} />
                    <ViewWorkoutRow post={post} onOpen={() => onOpen(post)} hint={!!openHint} />
                  </>
                ) : post.locked_in_at ? (
                  <LockInHero post={post} />
                ) : (
                  <div className="px-1 text-sm text-muted-foreground">Workout was reopened, numbers will be back once it's finished.</div>
                )}
              </div>
            </div>
          )}
          {doubleTapHint && burst.n === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-[38%] h-14">
              <DoubleTapHint onDone={onTipDone} />
            </div>
          )}
          <ReactionBurst n={burst.n} x={burst.x} y={burst.y} emoji={reactionEmoji(post.my_reaction) ?? REACTION.emoji} />
          {soundFlash}
        </div>
        {note.sheet}

        {/* bottom left: who, and the words (over a soft shade on a picture) */}
        {/* low on the screen, just above the tab bar (TikTok's), its shade running down under the bar */}
        <div
          // its soft shade only over a clip that fills the screen; under a picture shown whole the words sit on black (styles.css)
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 z-[2] pt-16 transition-opacity duration-200",
            (sheetOpen || under || holding) && "opacity-0",
          )}
          style={{ paddingBottom: "calc(var(--feed-words-bottom) + var(--feed-scrub-lane, 0px))" }}
          data-page-words
        >
          <div ref={wordsRef} className={cn("mr-16 space-y-1.5 px-3 [text-shadow:0_1px_3px_rgb(0_0_0/0.5)]", !sheetOpen && !under && !holding && "pointer-events-auto")} data-page-words-body>
            {note.bubble && <div data-note-over>{note.bubble}</div>}
            <RepostedHeader post={post} onOpenAuthor={onOpenAuthor} />
            <AuthorLine
              author={post.author}
              sub={sub}
              size={34}
              onOpen={onOpenAuthor ? () => onOpenAuthor(post.author) : undefined}
              collaborators={post.collaborators}
              onOpenPerson={onOpenAuthor}
              trailing={!post.is_mine && onOpenAuthor ? <InlineFollow userId={post.author.user_id} name={post.author.name} /> : null}
            />
            {onOpenCaption ? (
              // their own words come first under the name (Reels': two lines and "… more"; a tap opens the whole
              // caption with the comments under it). Our own film captions ("Glutes + Legs · 3 sets on film", the
              // summary of its sets) aren't their words, and the workout's context below already says them
              post.caption?.trim() &&
              (auto || !isNote || visual) &&
              !(visual && s && isOwnFilmCaption(post.caption, [s.workout_name, s.workout_title])) &&
              !(visual && isFilmSummary(post.caption, post.film)) && (
                <PageCaption text={post.caption} mentions={post.mentions} onOpen={() => onOpenCaption(post)} />
              )
            ) : auto ? (
              <AutoPostCaption post={post} clamp onOpenPerson={onOpenAuthor} className="px-0 pt-0" />
            ) : (
              post.caption && (!isNote || visual) && <FeedCaption name={post.author.name} caption={post.caption} mentions={post.mentions} onOpenPerson={onOpenAuthor} className="px-0 pt-0" />
            )}
            {(!isNote || visual) && !auto && <PostExtras post={post} />}
            {slideSet && (
              // the set on screen (a workout film's clip): the exercise, then which set and what was lifted, under their
              // own words; each swipe its own, never the first clip's on every slide (a photo or a clip with no set says
              // nothing). The workout itself is the post's last swipe (its recap), with the carousel's "2/7" saying so:
              // no chip or button for it here, so the clip keeps the room
              <div className="min-w-0 pt-0.5 leading-snug" data-page-workout-context data-page-set>
                <div className="line-clamp-2 break-words text-[14px] font-medium">{slideSet.title}</div>
                {slideSet.detail && <SetDetail detail={slideSet.detail} other={slideSet.other} className="truncate text-[13px] tabular-nums text-foreground/70" otherClassName="text-[12px] font-medium text-foreground/50" />}
              </div>
            )}
            {visual && !s && post.locked_in_at && (
              <button type="button" onClick={() => onOpen(post)} className="flex items-center gap-2 text-left text-[13px] font-semibold">
                Locked in {isTrainingNow(post) ? <TrainingNowPill /> : <span className="text-muted-foreground">{lockInTimeLabel(post.locked_in_at)}</span>}
              </button>
            )}
            {/* one line, never two (every line here is room the picture loses): who liked it (Instagram's "Liked by"
                faces and names, a tap: the Likes), the views, the coach's ❤️ or reply, and a coach's own score */}
            {(liked || (post.views?.count ?? 0) > 0 || post.coach_reactions.length > 0 || post.coach_commented || viewerIsStaff) && (
              <div className="flex min-w-0 items-center gap-2 [&_[data-post-views]]:mx-0 [&_[data-post-views]]:mb-0 [&_[data-post-views]]:shrink-0" data-page-meta>
                {liked && <LikedBy post={post} onOpen={() => setLikesOpen(true)} variant="page" />}
                <PostViewsRow post={post} onOpenAuthor={onOpenAuthor} compact={liked} />
                {/* the coach's ❤️ or reply (beside the likes, the ❤️ only when the coach isn't already among its faces) */}
                {(liked ? post.coach_commented || (post.coach_reactions.length > 0 && !coachInFaces) : post.coach_reactions.length > 0 || post.coach_commented) && (
                  <div className={cn("inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[12px] font-bold text-primary", liked ? "shrink-0" : "min-w-0")} data-page-coach>
                    <span className="truncate">
                      {liked ? (
                        [post.coach_reactions.length > 0 && !coachInFaces ? `Coach ${reactionEmoji(post.coach_reactions[0].emoji) ?? ""}`.trim() : null, post.coach_commented ? (post.coach_reactions.length > 0 && !coachInFaces ? "replied" : "Coach replied") : null]
                          .filter(Boolean)
                          .join(" · ")
                      ) : (
                        <>
                          Coach {post.coach_reactions[0]?.name ?? ""}
                          {post.coach_reactions[0] ? ` ${reactionEmoji(post.coach_reactions[0].emoji) ?? ""}` : ""}
                          {post.coach_commented ? `${post.coach_reactions[0] ? " · " : " "}replied` : ""}
                        </>
                      )}
                    </span>
                  </div>
                )}
                {viewerIsStaff && <PostScoreChip post={post} />}
              </div>
            )}
          </div>
        </div>

        {/* down the right: ❤️ 💬 🔁 ✈️ 🔖 and the post's menu (who it's for is in the line under the name) */}
        <div
          className={cn(
            "absolute right-1 z-[3] flex flex-col items-center gap-1 transition-opacity duration-200",
            visual && "[filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.55))]",
            (sheetOpen || under || holding) && "pointer-events-none opacity-0",
          )}
          style={{ bottom: "calc(var(--feed-actions-bottom) + var(--feed-scrub-lane, 0px))" }}
          data-page-actions
        >
          <ReactionBar post={post} onReact={onReact} onOpenComments={onOpenComments} onOpenAuthor={onOpenAuthor} onReposted={note.ask} onOpenLikes={() => setLikesOpen(true)} unit={unit} column hidden={sheetOpen || under || holding} />
          <PostActions post={post} viewerIsStaff={viewerIsStaff} unit={unit} className="grid h-11 w-11 place-items-center rounded-full text-foreground active:scale-90 [&>svg]:h-6 [&>svg]:w-6" />
        </div>
        {/* the Likes, from the "Liked by" line or the number under the heart */}
        <ReactorsSheet postId={likesOpen ? post.id : null} onClose={() => setLikesOpen(false)} onOpenAuthor={onOpenAuthor} />
      </article>
    );
  }

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
          <PostActions post={post} viewerIsStaff={viewerIsStaff} unit={unit} />
        </div>
      </header>

      {/* on words, a workout card or a coach post the repost sits above it, never over the words */}
      {note.bubble && !overPicture && <div className="px-3.5 pb-2.5" data-note-above>{note.bubble}</div>}
      {/* Hero: the photo, or the workout itself when there isn't one. Taps never open the post (see onHeroTap). */}
      <div onClick={onHeroTap} {...hold.handlers} className="relative select-none [-webkit-touch-callout:none]" data-post-hero>
        {auto ? (
          <AutoPostHero post={post} thumbUrl={thumbUrl} unit={unit} />
        ) : isNote && !photo ? (
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
        {doubleTapHint && burst.n === 0 && <DoubleTapHint onDone={onTipDone} />}
        <ReactionBurst n={burst.n} x={burst.x} y={burst.y} emoji={reactionEmoji(post.my_reaction) ?? REACTION.emoji} />
        {/* on a picture: the reposter's photo and note in its bottom-left corner, Instagram's spot */}
        {note.bubble && overPicture && <div className="pointer-events-none absolute bottom-3 left-3 z-[2]" data-note-over>{note.bubble}</div>}
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
          <span data-workout-completed className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" /> Workout completed
          </span>
          <div className="mt-1 flex items-center gap-2">
            <h3 className="font-display min-w-0 flex-1 truncate text-[22px] uppercase leading-none">{workoutHeadline(s)}</h3>
            {lift?.pr && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-px text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">{SCOPE_WORD[lift.pr]}</span>
            )}
          </div>
          {workoutSubtitle(s) && <div className="mt-1 truncate text-[12px] font-semibold text-muted-foreground">{workoutSubtitle(s)}</div>}
          <div className="mt-2 grid grid-cols-4 gap-2">
            {lift && (
              <div className="col-span-2 min-w-0">
                <div className="font-display truncate text-[22px] uppercase leading-none">{formatTopSet(lift.detail, unit)}</div>
                <WeightOther className="mt-0.5 block truncate text-[11px]">{topSetOther(lift.detail, unit)}</WeightOther>
                <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{lift.name}</div>
              </div>
            )}
            {stats.slice(0, lift ? 2 : 4).map((x) => (
              <div key={x.label} className="min-w-0">
                <div className="font-display truncate text-[22px] uppercase leading-none">{x.value}</div>
                <SubLine sub={x.sub} row={stats.slice(0, lift ? 2 : 4)} className="mt-0.5 block truncate text-[11px]" />
                <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{shortLabel(x.label)}</div>
              </div>
            ))}
          </div>
        </button>
      )}

      {/* Every workout has more than the card shows: say so, plainly. */}
      {!isNote && s && <ViewWorkoutRow post={post} onOpen={() => onOpen(post)} hint={!!openHint} />}

      {auto && <AutoPostCaption post={post} clamp onOpenPerson={onOpenAuthor} />}
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

      <ReactionBar post={post} onReact={onReact} onOpenComments={onOpenComments} onOpenAuthor={onOpenAuthor} onReposted={note.ask} unit={unit} />
      <PostViewsRow post={post} onOpenAuthor={onOpenAuthor} />
      {viewerIsStaff && <PostScoreRow post={post} />}
      <CommentPreviewList post={post} onOpenComments={() => onOpenComments(post)} />
    </article>
  );
}

export const PostCard = memo(PostCardInner);

/**
 * A workout with no picture on its own screen of the feed: its card (what it
 * was, the lift that leads it, its numbers), the first of the post's two
 * swipes; the second is its recap (WorkoutRecap). The card's last row says
 * so, "Workout recap · Swipe", and a tap on it slides there too. A tap
 * anywhere else does nothing (two taps ❤️), so the post never sends anyone
 * to another page by accident.
 */
function WorkoutCoverCard({ post, onRecap, children }: { post: CommunityPost; onRecap: () => void; children: React.ReactNode }) {
  const prs = post.stats?.pr_count ?? 0;
  return (
    <div className="mx-auto w-full max-w-[440px] overflow-hidden rounded-2xl bg-muted" data-workout-cover>
      {children}
      <button
        type="button"
        // its own tap goes at once (the post around it waits out a double tap)
        onClick={(e) => {
          e.stopPropagation();
          onRecap();
        }}
        className="flex h-11 w-full items-center justify-between gap-2 border-t border-border px-5 text-left transition-colors active:bg-foreground/5"
        data-view-workout
      >
        <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold">Workout recap</span>
        <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
          <span className="truncate">{prs > 1 ? `${prs} PRs · Swipe` : "Every exercise · Swipe"}</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </span>
      </button>
    </div>
  );
}

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
 * repost, message, and save at the end. Under it, "Liked by Jared and 3
 * others" with their faces (LikedBy). That line, or a tap on the number by
 * the heart (under it on a post's screen, Reels'), opens the Likes.
 */
export function ReactionBar({
  post,
  onReact,
  onOpenComments,
  onOpenAuthor,
  onReposted,
  onOpenLikes,
  unit,
  column = false,
  hidden = false,
}: {
  post: CommunityPost;
  onReact: (p: CommunityPost, next: ReactionKey | null) => void;
  onOpenComments?: (p: CommunityPost) => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  /** Just reposted: the card floats "Add a note…" on the post. */
  onReposted?: () => void;
  /** Who liked it opens here instead (the post's screen keeps one Likes for its "Liked by" line and the heart's number). */
  onOpenLikes?: () => void;
  /** A post's own screen in the feed (TikTok's): the same buttons down the right side, each count under its icon. */
  column?: boolean;
  /** The unit the feed painted an automated post's picture in (Share to Instagram sends that one). */
  unit?: "kg" | "lb";
  /** Out of sight for now (the feed's first post under the stories, its sheet open, a clip held paused): its reactions wait to rise. */
  hidden?: boolean;
}) {
  const [listFor, setListFor] = useState<string | null>(null);
  const [sharing, setSharing] = useState<boolean | null>(null);
  const { role } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  // Add to your story: yours, or a crew-wide post (only where the story camera can open, never in View as client)
  const canStory = useStoryShareReady() && !isImpersonating && canShareToStory(post);
  // a coach can send any post out to his own Instagram (never in View as client)
  const canInstagram = (role === "admin" || role === "coach") && !isImpersonating && !post.story;
  const [ig, setIg] = useState<boolean | null>(null);
  // the share sheets load on their own: fetched in idle time so the first ✈️ opens at once
  useEffect(() => preloadShareSheets(canInstagram), [canInstagram]);
  // the reactions that rise out of the heart
  const kinds = reactionKinds(post);
  const openLikes = onOpenLikes ?? (() => setListFor(post.id));
  const prefetchLikes = usePrefetchPostReactors();
  const likesPress = () => prefetchLikes(post.id);
  // People are reacting to this one: a moment after it's on screen, its
  // reactions float up out of the heart and who reacted pops (never over the post).
  const pop = useEngagementPop<HTMLDivElement>(post, hidden);
  const { on, done } = pop;
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(done, 3600);
    return () => window.clearTimeout(t);
  }, [on, done]);
  const sheets = (
    <>
      <ReactorsSheet postId={listFor} onClose={() => setListFor(null)} onOpenAuthor={onOpenAuthor} />
      {/* mounted on the first ✈️, so a feed of posts doesn't carry a sheet each */}
      {sharing !== null && (
        <Suspense fallback={null}>
        <PostShareSheet
          post={post}
          open={sharing}
          onOpenChange={setSharing}
          // a beat after the sheet goes, so the story camera opens on a clear screen
          onStory={canStory ? () => window.setTimeout(() => openStoryShare({ post }), 200) : undefined}
          onInstagram={canInstagram ? () => window.setTimeout(() => setIg(true), 200) : undefined}
        />
        </Suspense>
      )}
      {canInstagram && ig !== null && (
        <Suspense fallback={null}>
          <InstagramShareSheet post={post} open={ig} onOpenChange={setIg} unit={unit} />
        </Suspense>
      )}
    </>
  );
  const shareTap = () => setSharing(true);
  if (column) {
    return (
      <div ref={pop.ref} data-engagement-pop={on ? "" : undefined} className="relative flex flex-col items-center gap-1" data-post-actions-column>
        <ReactionButton post={post} onReact={onReact} align="right" stacked onCount={openLikes} onCountPress={likesPress} />
        {on && <ReactionsRise kinds={kinds.length ? kinds : ["💬"]} total={reactionTotal(post)} size="lg" className="bottom-3/4 left-1/2" />}
        {onOpenComments && (
          <button
            type="button"
            onClick={() => onOpenComments(post)}
            className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1 text-[12px] font-bold tabular-nums text-foreground active:scale-90"
            aria-label={`Comments${post.comment_count ? `, ${post.comment_count}` : ""}`}
          >
            <MessageCircle className="h-[28px] w-[28px]" strokeWidth={2} />
            {post.comment_count > 0 && post.comment_count}
          </button>
        )}
        <RepostButton post={post} onReposted={onReposted} stacked />
        <button
          type="button"
          onClick={shareTap}
          className="grid h-11 w-11 place-items-center rounded-full text-foreground active:scale-90"
          aria-label="Share"
          data-post-share
        >
          <Send className="h-[26px] w-[26px] -rotate-12" />
        </button>
        <SaveButton post={post} stacked />
        {sheets}
      </div>
    );
  }
  return (
    <div ref={pop.ref} data-engagement-pop={on ? "" : undefined} className="relative px-2 pb-2 pt-1.5">
      {/* Instagram's row: like, comment, repost, message ... save at the end */}
      <div className="relative flex items-center">
        <ReactionButton post={post} onReact={onReact} onCount={openLikes} onCountPress={likesPress} />
        {on && <ReactionsRise kinds={kinds.length ? kinds : ["💬"]} total={reactionTotal(post)} className="bottom-1/2 left-5" />}
        {onOpenComments && (
          <button
            type="button"
            onClick={() => onOpenComments(post)}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-2 text-[14px] font-bold tabular-nums text-muted-foreground hover:bg-muted"
            aria-label={`Comments${post.comment_count ? `, ${post.comment_count}` : ""}`}
          >
            <MessageCircle className="h-[23px] w-[23px] text-foreground/80" strokeWidth={2} />
            {post.comment_count > 0 && post.comment_count}
          </button>
        )}
        <RepostButton post={post} onReposted={onReposted} />
        <button
          type="button"
          onClick={shareTap}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground/80 hover:bg-muted hover:text-foreground"
          aria-label="Share"
          title="Share"
          data-post-share
        >
          <Send className="h-[22px] w-[22px] -rotate-12" />
        </button>
        <span className="ml-auto" />
        <SaveButton post={post} />
      </div>
      {/* Instagram's "Liked by", on its own line under the row, so names never get cut short */}
      <LikedBy post={post} onOpen={openLikes} highlight={on} className="-mt-0.5" />
      {sheets}
    </div>
  );
}

/** Feed media: the thumbnail only. Full-size image / video loads on demand. */
export function PostMedia({
  post,
  thumbUrl,
  full = false,
  lead,
  trail,
  ratio: fixed,
  page = false,
  shrunk = false,
  onSlide,
  pageTrail,
  control,
  hint = false,
  onReachEnd,
}: {
  post: CommunityPost;
  thumbUrl: string | null;
  full?: boolean;
  /** Slides before the post's own: an automated post's card, or a deck's painted slides. */
  lead?: ReactNode | ReactNode[];
  trail?: ReactNode;
  ratio?: number;
  /** On a post's screen: which of its slides is on screen (its words say that slide's set). */
  onSlide?: (i: number) => void;
  /** On a post's screen: a last slide after its own (a workout's recap), drawn once it's needed. */
  pageTrail?: TrailRender;
  /** Lets the post slide its carousel to that last slide. */
  control?: MutableRefObject<CarouselControl | null>;
  /** The one-time "Swipe for workout" tip on the last slide. */
  hint?: boolean;
  /** The last slide came on screen. */
  onReachEnd?: () => void;
  /**
   * On a post's own screen in the feed: the screen is the canvas (TikTok's).
   * Each slide fills it or sits whole across it with black above and below
   * (screenFit), centred; captions and the speaker up top.
   */
  page?: boolean;
  /**
   * On its screen with its sheet open: a rounded card at its own shape,
   * centred in the room above the sheet (Instagram's), the speaker in its
   * corner and no set caption over it. The same elements as the screen, so a
   * playing clip carries on.
   */
  shrunk?: boolean;
}) {
  const slides = postSlides(post);
  const cover = slides[0] ?? null;
  const [screenRef, screenRatio] = useBoxRatio(page);
  // A picture: never taller than 4:5, never wider than 16:9, keeping the feed's rhythm.
  // A carousel takes its cover's shape for every slide (Instagram does too).
  // A picture framed in the studio is already exactly its shape (an older photo is
  // cropped to it, showing the part its focus says). A clip is never cropped: a clip
  // cover gives the frame its own shape (9:16 to 16:9, videoAspect), as tall as the
  // screen allows, and every clip fits whole inside its frame (black either side
  // when it's narrower), so the whole lift is always on screen.
  // `lead` / `trail`: a slide before / after the post's own (an automated post's 4:5 card), whose shape it takes.
  // `ratio`: a fixed shape (an automated post is always 4:5, like the card that may follow its photo).
  const clipCover = !fixed && !lead && cover?.type === "video";
  const ratio = fixed ?? postMediaRatio(post, lead != null);
  const frame: CSSProperties = clipCover && !page ? { aspectRatio: String(ratio), maxHeight: FEED_VIDEO_MAX_HEIGHT } : { aspectRatio: String(ratio) };
  if (page) {
    const fits = slides.map((sl) => screenFit(sl, screenRatio));
    return (
      <FitBox ratio={ratio} screen shrunk={shrunk}>
        {slides.length > 1 || pageTrail ? (
          <PostCarousel
            slides={slides}
            coverUrl={thumbUrl}
            frame={frame}
            full={full}
            page
            screenRef={screenRef}
            fits={fits}
            shrunk={shrunk}
            onSlide={onSlide}
            pageTrail={pageTrail}
            control={control}
            hint={hint}
            onReachEnd={onReachEnd}
            place={`page:${post.id}`}
          />
        ) : (
          <div ref={screenRef} className="absolute inset-0 overflow-hidden bg-black" data-screen-canvas data-fit={fits[0]}>
            {cover ? <SlideMedia slide={cover} thumbUrl={thumbUrl} full={full} page fit={fits[0]} shrunk={shrunk} /> : <div className="h-full w-full jf-skeleton bg-muted" />}
          </div>
        )}
      </FitBox>
    );
  }
  const leads = lead == null ? [] : Array.isArray(lead) ? lead : [lead];
  if (slides.length + leads.length > 1 || trail) return <PostCarousel slides={slides} coverUrl={thumbUrl} frame={frame} full={full} leads={leads} trail={trail} />;
  if (leads.length) return <div className="relative w-full overflow-hidden bg-muted" style={frame}>{leads[0]}</div>;
  return (
    <div className={cn("relative w-full overflow-hidden", clipCover ? "bg-black" : "bg-muted")} style={frame} data-clip-frame={clipCover ? "" : undefined}>
      {cover ? <SlideMedia slide={cover} thumbUrl={thumbUrl} full={full} page={page} /> : <div className="h-full w-full jf-skeleton bg-muted" />}
    </div>
  );
}

/** Where a post's screen snaps, from the top of the window: just under the status bar on a phone (Crew's bar floats over it). */
function snapLine(el: HTMLElement | null): number {
  const page = el?.closest<HTMLElement>(".feed-page") ?? el;
  return page ? parseFloat(getComputedStyle(page).scrollMarginTop) || 0 : 0;
}

/** How far a post's screen still sits below where it snaps (the stories above the first post), in px; 0 once it's up whole. */
function belowSnap(el: HTMLElement | null): number {
  if (!el) return 0;
  return Math.max(0, Math.round(el.getBoundingClientRect().top - snapLine(el)));
}

/** How far a post's screen starts below Crew's bar: negative once it's up (the bar floats over its top). */
function belowBar(el: HTMLElement): number {
  const bar = document.querySelector("[data-crew-bar]")?.getBoundingClientRect().bottom ?? 0;
  return Math.round(el.getBoundingClientRect().top - Math.max(0, bar));
}

/** Words, a workout or a lock in on its screen: clear of Crew's bar above and the words and tab bar below. */
const PAGE_BODY_ROOM = { paddingTop: "calc(var(--feed-bar-room) + 1.5rem)", paddingBottom: "calc(var(--feed-words-bottom) + 8rem)" } as const;
/** A workout's card or recap on its screen: between Crew's bar and the post's words, wherever those settle. */
const RECAP_ROOM = { top: "calc(var(--feed-bar-room) + 0.75rem)", bottom: "var(--feed-words-room, 0px)" } as const;
/** Its sheet open, the words and buttons are gone: the room above the sheet is all its own. */
const PAGE_BODY_SHRUNK = { paddingTop: "1rem", paddingBottom: "1rem" } as const;

/**
 * On a post's screen (which ends at the tab bar), a picture shown whole sits
 * between Crew's bar and the post's words (TikTok's): the words never cover
 * it. Only a clip that fills the screen runs under them.
 */
const BETWEEN_BARS = { top: "var(--feed-bar-room)", bottom: "var(--feed-words-room, 0px)" } as const;

/**
 * A box's shape (width / height, to 3 places so a sub-pixel change never
 * re-renders), read before it paints and kept up to date (a post's sheet
 * opening shrinks its screen). Only while `active`.
 */
function useBoxRatio(active: boolean): [(el: HTMLDivElement | null) => void, number | null] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!active || !el) return;
    const read = (w: number, h: number) => setRatio(w > 0 && h > 0 ? Math.round((w / h) * 1000) / 1000 : null);
    const r = el.getBoundingClientRect();
    read(r.width, r.height);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => read(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, el]);
  return [setEl, active ? ratio : null];
}

/**
 * A picture's frame as big as its box allows at its own shape (`ratio`,
 * width / height), centred: the full width for anything wider than the box,
 * the full height for anything taller (a 9:16 clip on a phone).
 * `screen`: the whole box instead (a post's own screen, the media deciding
 * how it sits, screenFit) until `shrunk`.
 * `shrunk` (its post's sheet open): a rounded card at its own shape with room
 * around it, centred above the sheet (Instagram's). Only the boxes change,
 * never what's in them, so a clip playing on the screen keeps playing in the
 * card, and the card follows the room as the sheet slides up.
 */
function FitBox({ ratio, children, page = false, screen = false, shrunk = false }: { ratio: number; children: ReactNode; page?: boolean; screen?: boolean; shrunk?: boolean }) {
  const whole = screen && !shrunk;
  return (
    <div
      className={cn("absolute inset-0 grid place-items-center transition-[padding] duration-300 ease-out motion-reduce:transition-none", shrunk && "p-3")}
      style={page && !screen ? { ...BETWEEN_BARS, containerType: "size" } : { containerType: "size" }}
      data-fit-box
      data-shrunk={shrunk ? "" : undefined}
    >
      <div
        // isolate + its own layer: an iPhone clips a playing clip to the rounded corners
        className={cn("relative transition-[border-radius] duration-300 ease-out motion-reduce:transition-none", shrunk && "overflow-hidden rounded-xl [isolation:isolate] [transform:translateZ(0)]")}
        style={whole ? { width: "100cqw", height: "100cqh" } : { width: `min(100cqw, calc(100cqh * ${ratio}))`, height: `min(100cqh, calc(100cqw / ${ratio}))` }}
        data-post-shape={shrunk ? "card" : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The shape a post's pictures show at (PostMedia's): a clip cover its own (9:16 to 16:9), or the frame it
 * was framed at in the studio; a picture 4:5 to 16:9; after a 4:5 card 4:5.
 */
export function postMediaRatio(
  post: Pick<CommunityPost, "media_path" | "media_thumb_path" | "media_type" | "media_width" | "media_height" | "extra_media"> & { media_focus?: MediaFocus | null },
  afterCard = false,
): number {
  if (afterCard) return 0.8;
  if (post.media_type !== "video") return feedAspect(post.media_width, post.media_height);
  const f = clipFrame(post.media_focus);
  return f ? Math.min(FEED_MAX_ASPECT, Math.max(VIDEO_MIN_ASPECT, f.a)) : videoAspect(post.media_width, post.media_height);
}

/** One photo or video, filling its frame. A clip plays muted while it's on screen (InlineVideo). */
function SlideMedia({
  slide,
  thumbUrl,
  full,
  active = true,
  withDots = false,
  page = false,
  fit = "contain",
  shrunk = false,
  warm,
}: {
  slide: PostSlide;
  thumbUrl: string | null;
  full: boolean;
  active?: boolean;
  /** Next to the slide showing: a clip keeps its element and loads ahead (InlineVideo `warm`). */
  warm?: "next" | "prev";
  withDots?: boolean;
  page?: boolean;
  /** On a post's screen: fill it ("cover") or show it whole, centred ("contain"), screenFit. A frame at the picture's own shape is "contain" either way. */
  fit?: "cover" | "contain";
  /** Its post's sheet open: a small card, the speaker in its corner and no set caption over it. */
  shrunk?: boolean;
}) {
  const isVideo = slide.type === "video";
  // the full-size copy for the slide on screen and the ones either side, so a swipe lands on it already sharp
  const { data: fullUrl } = useFullMediaUrl(slide.path, full && (active || !!warm) && !isVideo);
  const src = (full && !isVideo ? fullUrl : null) ?? thumbUrl;
  // data-pinch-zoom: pinch lifts just this (the page never zooms), see useMediaPinchZoom
  const position = focusPosition(slide.focus);
  // a photo shown on a post's screen: its box between the bars, zoomed a little when it's slightly taller than the room
  const zoom = page && !isVideo ? photoZoomBox(slideAspect(slide), cleanFocus(slide.focus)?.y ?? 0.5) : null;
  return (
    <>
      {isVideo ? (
        <div data-pinch-zoom className="absolute inset-0">
          {/* whole in its frame; on a post's screen it fills it when it's nearly the screen's shape (TikTok's) */}
          <InlineVideo
            path={slide.path}
            poster={thumbUrl}
            active={active}
            position={position}
            fit={fit}
            controls={shrunk ? "corner" : page ? "top" : "bottom"}
            frame={clipFrame(slide.focus)}
            media={slide.width && slide.height ? slide.width / slide.height : null}
            focusY={cleanFocus(slide.focus)?.y ?? 0.5}
            warm={warm}
          />
        </div>
      ) : page && !shrunk && fit === "cover" ? (
        // framed for the whole screen (9:16, screenFit): it fills it edge to edge like a clip, the words over its foot
        <div data-pinch-zoom className="absolute inset-0" data-photo-fit="cover">
          {src ? <FadeImg src={src} position={position} /> : <div className="h-full w-full jf-skeleton bg-muted" />}
        </div>
      ) : page && !shrunk && zoom ? (
        // between Crew's bar and the words: the full width, a slightly taller photo zoomed a little (photoZoomBox), never stretched;
        // the rest of the screen is the photo itself, soft and dark (AmbientFill), never black bands
        <>
          <AmbientFill src={thumbUrl ?? src} />
          <div data-pinch-zoom className="absolute inset-0 overflow-hidden" style={{ ...BETWEEN_BARS, containerType: "size" }} data-photo-fit="zoom">
            <div className="absolute" style={zoom}>
              {src ? <FadeImg src={src} /> : <div className="h-full w-full jf-skeleton bg-muted" />}
            </div>
          </div>
        </>
      ) : (
        // on a post's screen a photo shows whole, between Crew's bar and the tab bar, over a soft, dark copy of itself
        <>
          {page && !shrunk && <AmbientFill src={thumbUrl ?? src} />}
          <div data-pinch-zoom className="absolute inset-0" style={page ? BETWEEN_BARS : undefined}>
            {src ? <FadeImg src={src} position={position} whole={page} /> : <div className="h-full w-full jf-skeleton bg-muted" />}
          </div>
        </>
      )}
      {/* on a post's own screen its set is said in the words at the bottom (PostCard's data-page-set), never over the clip */}
      {slide.caption && !shrunk && !page && <SlideCaption caption={slide.caption} withDots={withDots} />}
    </>
  );
}

/**
 * A workout film clip's own caption, on the clip (the card feed and a post's
 * page): the exercise, then the set and what was lifted. It moves with its
 * slide (each swipe has its own), sits on a soft scrim at the bottom, clear of
 * the sound button and the dots, and never takes a tap (double-tap ❤️ and the
 * clip's sound still work). On a post's own screen it's in the words instead.
 */
function SlideCaption({ caption, withDots }: { caption: { title: string; detail: string; other?: string | null }; withDots: boolean }) {
  return (
    <div
      data-slide-caption
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent pl-3.5 pr-14 pt-12 text-white",
        withDots ? "pb-7" : "pb-3",
      )}
    >
      <div className="truncate text-[15px] font-semibold leading-tight [text-shadow:0_1px_2px_rgb(0_0_0/0.45)]">{caption.title}</div>
      <SetDetail detail={caption.detail} other={caption.other} className="mt-0.5 truncate text-[13px] tabular-nums text-white/85" otherClassName="text-[12px] font-medium text-white/60" />
    </div>
  );
}

/**
 * A set's line with its weight's other unit right after the weight, quieter:
 * "Top set · 455 lb (206.4 kg) × 1 @ RPE 6". The line as it was when it names
 * no weight or there's no other unit (a hidden weight, reps only).
 */
function SetDetail({ detail, other, className, otherClassName }: { detail: string; other?: string | null; className: string; otherClassName: string }) {
  const at = other ? splitAtWeight(detail) : null;
  if (!at) return <div className={className}>{detail}</div>;
  return (
    <div className={className}>
      {at.head}
      <span data-weight-other className={otherClassName}> ({other})</span>
      {at.tail}
    </div>
  );
}

/**
 * A photo that fades in once it has loaded (cached ones show at once), over a
 * soft shimmer. Asked for as soon as its post is in the feed, never held back
 * by the browser's lazy loading (an iPhone starts those too late, so a photo
 * popped in as it scrolled on): the feed is only the posts already read, and
 * a feed photo is its small thumbnail.
 */
/**
 * Behind a picture that doesn't fill its post's screen (an older 4:5 post, a
 * square or sideways photo): the picture itself, soft and dark, over the whole
 * screen (ambient-fill.ts). A tiny canvas the screen stretches, no CSS filter;
 * it stays black until the picture is there.
 */
function AmbientFill({ src }: { src: string | null }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!src || typeof Image === "undefined") return;
    let alive = true;
    const img = new Image();
    img.decoding = "async";
    // drawn once the screen is still (whenStill, post-art.ts): drawing a photo onto a canvas decodes it on the main
    // thread there and then, which landed in the middle of the swipe that brought its slide on (Nov 23 2026)
    img.onload = () => {
      if (!alive) return;
      void whenStill().then(() => {
        if (!alive || !ref.current) return;
        try {
          paintAmbient(ref.current, img);
        } catch {
          /* a picture that can't be drawn leaves the screen black, as before */
        }
      });
    };
    img.src = src;
    return () => {
      alive = false;
      img.onload = null;
    };
  }, [src]);
  return <canvas ref={ref} width={AMBIENT_SIZE.w} height={AMBIENT_SIZE.h} aria-hidden data-ambient-fill className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/** Pictures already on screen once this visit: shown again at once (no grey, no fade), a remount or a swipe back included. */
const shownPictures = new Set<string>();

/**
 * A slide's photo. The first time a picture loads it fades in over grey; a
 * picture already shown this visit is simply there. A sharper copy (the
 * thumbnail's full-size one) is decoded off screen and swapped in only once
 * it's ready, so the slide never goes grey in between (Nov 23 2026: the swap
 * blanked it and faded the new one in over 280 ms, mid-swipe).
 */
function FadeImg({ src, position, whole = false }: { src: string; position?: string; whole?: boolean }) {
  const [shown, setShown] = useState(src);
  const [loaded, setLoaded] = useState(() => shownPictures.has(src));
  const ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (src === shown) return;
    if (shownPictures.has(src) || !loaded) return void setShown(src);
    let alive = true;
    const next = new Image();
    next.decoding = "async";
    next.src = src;
    const swap = () => {
      if (!alive) return;
      shownPictures.add(src);
      setShown(src);
    };
    if (typeof next.decode === "function") next.decode().then(swap, swap);
    else next.onload = next.onerror = swap;
    return () => {
      alive = false;
    };
  }, [src, shown, loaded]);
  // in the browser's memory already: on screen before the first paint, never faded in
  useLayoutEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) {
      shownPictures.add(shown);
      setLoaded(true);
    }
  }, [shown]);
  return (
    <>
      {!loaded && <div className="absolute inset-0 jf-skeleton bg-muted" aria-hidden />}
      <img
        ref={ref}
        src={shown}
        alt=""
        decoding="async"
        draggable={false}
        onLoad={() => {
          shownPictures.add(shown);
          setLoaded(true);
        }}
        data-loaded={loaded ? "" : undefined}
        // on a post's screen a photo shows whole, centred (black above and below); a frame at its own shape fills either way
        className={cn("media-fade relative h-full w-full", whole ? "object-contain" : "object-cover")}
        style={position && !whole ? { objectPosition: position } : undefined}
      />
    </>
  );
}

/** Slide a post's carousel from outside it (its words' workout chip, its card's recap row). */
export type CarouselControl = { toEnd: () => void };

/** A carousel's scroll this close to a slide (a share of its width) is on it: the swipe has settled. */
const SLIDE_SETTLED = 0.01;
/** No scroll for this long and it has settled where it is (a browser with no scrollend, a finger held still). */
const SLIDE_SETTLE_MS = 140;
/** Slides either side of the one showing that are on the page (photos load and decode ahead; a clip its poster). */
const SLIDES_AHEAD = 2;

/**
 * A slide drawn after the post's own (a workout's recap): `load` once the
 * post is on screen and the slide is the next swipe (so its data is ready by
 * the time it's there), `active` while it's the slide on screen.
 */
export type TrailRender = (state: { load: boolean; active: boolean }) => ReactNode;

/**
 * Up to 10 photos / videos: swipe sideways (it snaps one at a time), "2/5"
 * and the dots say where you are. Only the slide you're on and its
 * neighbours load; the rest wait. Taps still reach the post (double-tap ❤️, a clip's sound).
 * On a post's screen, a vertical swipe is always the feed's (the browser
 * locks a swipe to the way it started), a sideways one the carousel's, and
 * nothing on a slide scrolls on its own.
 */
function PostCarousel({
  slides,
  coverUrl,
  frame,
  full,
  leads = [],
  trail,
  page = false,
  screenRef,
  fits,
  shrunk = false,
  onSlide,
  pageTrail,
  control,
  hint = false,
  onReachEnd,
  bare = false,
  place,
}: {
  slides: PostSlide[];
  coverUrl: string | null;
  frame: CSSProperties;
  full: boolean;
  /** Slides before the post's own (an automated post's card, a deck's slides). */
  leads?: ReactNode[];
  trail?: ReactNode;
  /** On a post's screen: the carousel is the screen (each slide filling it or whole on black, `fits`), "2/4" says where you are. */
  page?: boolean;
  screenRef?: (el: HTMLDivElement | null) => void;
  fits?: ("cover" | "contain")[];
  /** Its post's sheet open: a small card ("2/4" in its corner). */
  shrunk?: boolean;
  /** Which of `slides` is on screen, as it changes (and on mounting): the post's words follow it. */
  onSlide?: (i: number) => void;
  /** On a post's screen: its last slide (a workout's recap), drawn when it's needed. */
  pageTrail?: TrailRender;
  control?: MutableRefObject<CarouselControl | null>;
  /** The one-time "Swipe for workout" tip, once the carousel has been still on screen a moment. */
  hint?: boolean;
  /** The last slide came on screen. */
  onReachEnd?: () => void;
  /** No black of its own: the post's screen shows through (a workout's card on words). */
  bare?: boolean;
  /** Remembers the slide it's left on under this key for the visit, and opens on it (carousel-places.ts). */
  place?: string;
}) {
  // the slide it was last left on, when the feed lets the post go and brings it back (worked out once, on mounting)
  const [start] = useState(() => carouselPlace(place, slides.length + leads.length + (trail || pageTrail ? 1 : 0)));
  const [index, setIndex] = useState(start);
  const [seen, setSeen] = useState(start + 1);
  const track = useRef<HTMLDivElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const setRoot = useCallback(
    (el: HTMLDivElement | null) => {
      root.current = el;
      if (page) screenRef?.(el);
    },
    [page, screenRef],
  );
  const urls = useSlideThumbUrls(slides.slice(1));
  // with lead slides, the post's own slides start that many along
  const off = leads.length;
  const hasTrail = !!trail || !!pageTrail;
  const count = slides.length + off + (hasTrail ? 1 : 0);
  const last = count - 1;
  const onSlideRef = useRef(onSlide);
  onSlideRef.current = onSlide;
  useLayoutEffect(() => {
    onSlideRef.current?.(index - off);
  }, [index, off]);
  const endRef = useRef(onReachEnd);
  endRef.current = onReachEnd;
  useEffect(() => {
    if (pageTrail && index === last) endRef.current?.();
  }, [pageTrail, index, last]);
  // the post on screen (half of it at least): only then does its last slide load what it needs
  const onScreen = useOnScreen(root, !!pageTrail);
  // A swipe is the browser's own (scroll snap on the compositor): nothing re-renders while a finger moves it.
  // "2/4" follows the finger as it passes halfway (its text written straight in), and the slide it lands on
  // becomes the carousel's (which clip plays, what loads next, the post's words) once the swipe settles: on a
  // snap point, at scrollend, or a beat after the last scroll. Rendering at the halfway mark used to start the
  // next clip, mount the slide after it and re-render the whole post in the middle of the swipe.
  const countRef = useRef<HTMLSpanElement | null>(null);
  const liveRef = useRef(start);
  const settleTimer = useRef(0);
  // opening on a remembered slide: the track is put there before the first paint (a retry the next frame if it has no size yet)
  useLayoutEffect(() => {
    if (!start) return;
    let raf = 0;
    const put = () => {
      const el = track.current;
      if (!el) return;
      if (!el.clientWidth) {
        raf = requestAnimationFrame(put);
        return;
      }
      el.scrollLeft = start * el.clientWidth;
    };
    put();
    return () => cancelAnimationFrame(raf);
  }, [start]);
  const slideAt = (el: HTMLDivElement) => Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth)));
  const settleOn = (i: number) => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = 0;
    setIndex(i);
    setSeen((n) => Math.max(n, i + 1));
    if (place) rememberCarouselPlace(place, i);
  };
  const onScroll = () => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    const x = el.scrollLeft / el.clientWidth;
    const i = slideAt(el);
    if (i !== liveRef.current) {
      liveRef.current = i;
      // React's own text node, given its new value (never replaced, so the next render still owns it)
      const text = countRef.current?.firstChild;
      if (text && text.nodeType === Node.TEXT_NODE) text.nodeValue = `${i + 1}/${count}`;
    }
    if (Math.abs(x - i) < SLIDE_SETTLED) return settleOn(i);
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const t = track.current;
      if (t?.clientWidth) settleOn(slideAt(t));
    }, SLIDE_SETTLE_MS);
  };
  useEffect(() => {
    const el = track.current;
    if (!el || !("onscrollend" in window)) return;
    const end = () => {
      if (el.clientWidth) settleOn(slideAt(el));
    };
    el.addEventListener("scrollend", end);
    return () => el.removeEventListener("scrollend", end);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settleOn / slideAt read only `count`, `place` and stable setters
  }, [count]);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);
  const go = (dir: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };
  useEffect(() => {
    if (!control) return;
    control.current = {
      toEnd: () => {
        const el = track.current;
        if (el) el.scrollTo({ left: last * el.clientWidth, behavior: "smooth" });
      },
    };
    return () => {
      control.current = null;
    };
  }, [control, last]);
  // "Swipe for workout": the first time, once the post has been still on screen a moment, a small pill by the counter
  // nudges toward the last slide (only the pill moves, never the screen), until they get there
  const [tip, setTip] = useState(false);
  useEffect(() => {
    if (!hint || !onScreen || index === last) return setTip(false);
    const t = window.setTimeout(() => setTip(true), 700);
    return () => window.clearTimeout(t);
  }, [hint, onScreen, index, last]);
  const trailNear = index >= count - 2 || seen >= count - 1;
  return (
    <div
      ref={setRoot}
      className={cn("group/carousel overflow-hidden", page ? cn("absolute inset-0", !bare && "bg-black") : "relative w-full bg-muted")}
      style={page ? undefined : frame}
      aria-roledescription="carousel"
      aria-label={pageTrail ? `${count} slides, the last the workout recap` : `${count} photos and videos`}
      data-screen-canvas={page && !bare ? "" : undefined}
    >
      <div
        ref={track}
        onScroll={onScroll}
        data-carousel
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ overscrollBehaviorX: "none", WebkitOverflowScrolling: "touch" }}
      >
        {leads.map((node, i) => (
          <div key={`lead-${i}`} className="relative h-full w-full shrink-0 snap-center snap-always" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} data-carousel-lead={i}>
            {node}
          </div>
        ))}
        {slides.map((sl, j) => {
          const i = j + off;
          // two either side are on the page (a photo loads and decodes ahead, a clip shows its poster), so two quick
          // swipes in a row never land on an empty slide; only the slide on screen and its neighbours hold a clip
          const near = Math.abs(i - index) <= SLIDES_AHEAD || i < seen;
          const url = j === 0 ? coverUrl : (urls[slideThumbPath(sl) ?? ""] ?? null);
          return (
            <div key={`${sl.path}-${j}`} className="relative h-full w-full shrink-0 snap-center snap-always" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} data-fit={page ? fits?.[j] : undefined}>
              {near ? <SlideMedia slide={sl} thumbUrl={url} full={full} active={i === index} warm={i === index + 1 ? "next" : i === index - 1 ? "prev" : undefined} withDots={!page} page={page} fit={fits?.[j]} shrunk={shrunk} /> : <div className={cn("h-full w-full", page ? "bg-black" : "bg-muted")} />}
            </div>
          );
        })}
        {hasTrail && (
          <div className="relative h-full w-full shrink-0 snap-center snap-always" aria-roledescription="slide" aria-label={`${count} of ${count}`} data-carousel-trail>
            {/* painted once it's next to the one on screen */}
            {pageTrail
              ? pageTrail({ load: onScreen && trailNear, active: index === last })
              : trailNear
                ? trail
                : <div className="h-full w-full bg-muted" />}
          </div>
        )}
      </div>
      {tip ? (
        // the first time: the counter itself says where to go, and a tap there goes (never another pill over the post)
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            control?.current?.toEnd();
          }}
          className={cn("absolute right-2.5 inline-flex items-center gap-1 rounded-full bg-black/60 py-0.5 pl-1.5 pr-2 text-[11px] font-bold text-white backdrop-blur animate-in fade-in", page ? "top-[calc(var(--feed-bar-room)+0.625rem)]" : "top-2.5")}
          data-carousel-count
          data-recap-tip
        >
          <ChevronsLeft className="jf-recap-nudge h-3.5 w-3.5" aria-hidden />
          Swipe for workout
          <span ref={countRef} className="ml-0.5 font-bold tabular-nums text-white/70">
            {`${index + 1}/${count}`}
          </span>
        </button>
      ) : (
        <span ref={countRef} className={cn("pointer-events-none absolute right-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white backdrop-blur", page ? "top-[calc(var(--feed-bar-room)+0.625rem)]" : "top-2.5")} data-carousel-count>
          {`${index + 1}/${count}`}
        </span>
      )}
      {/* the dots; on a post's screen its words and buttons sit at the bottom, so "2/4" up top says it */}
      {!page && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1" aria-hidden>
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-white" : "w-1.5 bg-white/55")} />
          ))}
        </div>
      )}
      {/* mouse users get arrows (touch swipes) */}
      {index > 0 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); go(-1); }} className="absolute left-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-black shadow [@media(hover:hover)]:group-hover/carousel:grid" aria-label="Previous">
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {index < count - 1 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); go(1); }} className="absolute right-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-black shadow [@media(hover:hover)]:group-hover/carousel:grid" aria-label="Next">
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

/** At least half of `ref` on screen (latched: once it's loaded what it needs, it keeps it). Only while `active`. */
function useOnScreen(ref: React.RefObject<HTMLElement | null>, active: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    if (typeof IntersectionObserver === "undefined") return setOn(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting && e.intersectionRatio >= 0.5) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, active]);
  return on;
}
