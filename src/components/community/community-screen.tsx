import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { PostCard } from "@/components/community/post-card";
import { doubleTapTipKeys } from "@/components/community/reaction-button";
import { CommentsSheet } from "@/components/community/comments-sheet";
import { OPEN_POST_EVENT } from "@/components/community/shared-comment";
import { PostDetailDialog } from "@/components/community/post-detail";
import { ProfileView } from "@/components/community/profile-view";
import { ShareWorkoutButton } from "@/components/community/share-workout-picker";
import { CrewList } from "@/components/community/crew-list";
import { markCommunitySeen, useMyCommunityId, useCommunityFeed, useHintsSeen, useMarkHintSeen, usePostMediaUrls, useReact, useViewerUnit } from "@/lib/community.queries";
import type { CommunityAuthor, CommunityPost, ReactionKey } from "@/lib/community";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification-bell";
import { SwipeBack, SwipeBackTip } from "@/components/swipe-back";
import { CaughtUp, FeedItem, NewPostsPill, PostSkeleton, useNewPosts } from "@/components/community/feed-motion";
import { useMediaPinchZoom } from "@/hooks/use-media-pinch-zoom";

type Tab = "feed" | "crew" | "you";
type Scope = { kind: Tab } | { kind: "author"; author: CommunityAuthor; from: Tab };

/** `#post=<id>` opens a post straight away (used by the Home strip and pushes). */
function postFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/post=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

/** `#at=<post id>`: open the feed scrolled to that post (Home's community card). */
function atFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/(?:^#|&)at=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

/** `#person=<user id>` opens someone's profile (used from Home). */
function personFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/person=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

/**
 * The JF Effect community: workouts people chose to share, newest first, a
 * profile per person, and a full workout page per post. Shared by the client
 * portal and the coach view. No follower counts, no rankings.
 */
/** The double-tap tip plays once per visit (app load), not on every feed render. */
let tipShownThisVisit = false;
/** "Swipe right to go back": asks on up to 5 visits, until it's been used once. */
const SWIPE_TIP_VISITS = 5;
export const swipeTipKeys = Array.from({ length: SWIPE_TIP_VISITS }, (_, i) => `swipe_back_shown_${i + 1}`);
let swipeTipShownThisVisit = false;

export function CommunityScreen({
  canShare = false, previewOnly = false, bell = false, backTo, hideTabs = false,
}: {
  canShare?: boolean;
  previewOnly?: boolean;
  /** The page has no header of its own: put the notifications bell in the top row. */
  bell?: boolean;
  /** A small back arrow at the start of the top row (instead of a page header). */
  backTo?: string;
  /** Just the feed, no Feed / Crew / You row (the coach's Community page has its own tabs). */
  hideTabs?: boolean;
}) {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const viewerIsStaff = role === "admin" || role === "coach";
  const [scope, setScope] = useState<Scope>(() => {
    const person = personFromHash();
    return person ? { kind: "author", author: { user_id: person, name: "", avatar_url: null, is_coach: false }, from: "crew" } : { kind: "feed" };
  });
  const tab: Tab = scope.kind === "author" ? scope.from : scope.kind;
  const [commentsFor, setCommentsFor] = useState<CommunityPost | null>(null);
  const [detailId, setDetailId] = useState<string | null>(() => postFromHash());
  const [jumpTo, setJumpTo] = useState<string | null>(() => atFromHash());
  const [flash, setFlash] = useState<string | null>(null);

  const feed = useCommunityFeed(null);
  const posts = useMemo(() => feed.data?.pages.flatMap((p) => p.posts) ?? [], [feed.data]);
  // "Double-tap to like": a few seconds on the first post (a workout before a
  // note), once a visit, until the first double-tap, and only for the first
  // few visits either way. Remembered on the account, not the device.
  const hints = useHintsSeen();
  const markHint = useMarkHintSeen();
  const onDoubleTap = useCallback(() => markHint("double_tap"), [markHint]);
  const [tipDone, setTipDone] = useState(tipShownThisVisit);
  const tipVisit = hints.data && !hints.data.includes("double_tap") ? doubleTapTipKeys.find((k) => !hints.data!.includes(k)) : undefined;
  const hintId = !tipDone && tipVisit && posts.length ? ((posts.find((p) => p.kind !== "note") ?? posts[0])?.id ?? null) : null;
  useEffect(() => {
    if (!hintId || !tipVisit || tipShownThisVisit) return;
    tipShownThisVisit = true;
    markHint(tipVisit);
  }, [hintId, tipVisit, markHint]);
  const onTipDone = useCallback(() => setTipDone(true), []);
  // "View full workout": pulses on the first workout in the feed until they open one
  // (on the account, so it never comes back on another phone). Waits for the like tip.
  const OPEN_HINT = "open_workout";
  const openHintId =
    hints.data && !hints.data.includes(OPEN_HINT) && (tipDone || !tipVisit)
      ? (posts.find((p) => p.kind !== "note" && !!p.stats)?.id ?? null)
      : null;
  const openPost = useCallback((post: CommunityPost) => {
    if (post.kind !== "note") markHint(OPEN_HINT);
    setDetailId(post.id);
  }, [markHint]);
  const { data: urls } = usePostMediaUrls(scope.kind === "feed" ? posts : []);

  // Opening the community clears the "new posts" badge (server-side, every device).
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current || !feed.isSuccess) return;
    markedRef.current = true;
    void markCommunitySeen(qc);
  }, [feed.isSuccess, qc]);

  const { data: unit = "lb" } = useViewerUnit(user?.id);

  // New posts from the crew while you're down the feed: a pill to jump up to them.
  const myId = useMyCommunityId();
  const newPosts = useNewPosts(scope.kind === "feed" && !previewOnly, myId);
  // Tapping the Community tab while you're on it: back to the feed's top, fresh.
  const showNew = useRef(newPosts.show);
  showNew.current = newPosts.show;
  useEffect(() => {
    const onRetap = (e: Event) => {
      if ((e as CustomEvent).detail !== window.location.pathname) return;
      setScope({ kind: "feed" });
      showNew.current();
    };
    window.addEventListener("nav-retap", onRetap);
    return () => window.removeEventListener("nav-retap", onRetap);
  }, []);

  // The page never zooms (pinch or double-tap); photos and videos pinch-zoom on their own.
  useMediaPinchZoom(true);

  // Swipe right from anywhere to go back: out of a profile to the list, else out of the community.
  const navigate = useNavigate();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canSwipeBack = scope.kind === "author" || !!backTo;
  const leaveAuthor = () => {
    if (scope.kind !== "author") return;
    setScope({ kind: scope.from });
    if (window.location.hash.includes("person=")) history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  const swipeBack = () => {
    if (scope.kind === "author") return leaveAuthor();
    if (!backTo) return;
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: backTo });
  };
  const [swipeTip, setSwipeTip] = useState(false);
  const swipeVisit = hints.data && !hints.data.includes("swipe_back") ? swipeTipKeys.find((k) => !hints.data!.includes(k)) : undefined;
  const feedReady = feed.isSuccess || posts.length > 0;
  useEffect(() => {
    // after the double-tap tip (never both at once), once the feed is up
    if (!canSwipeBack || !swipeVisit || swipeTipShownThisVisit || !feedReady || hintId) return;
    const t = window.setTimeout(() => {
      swipeTipShownThisVisit = true;
      markHint(swipeVisit);
      setSwipeTip(true);
    }, 900);
    return () => window.clearTimeout(t);
  }, [canSwipeBack, swipeVisit, feedReady, hintId, markHint]);
  useEffect(() => {
    if (!swipeTip) return;
    const t = window.setTimeout(() => setSwipeTip(false), 12_000);
    return () => window.clearTimeout(t);
  }, [swipeTip]);
  const onSwipeUsed = useCallback(() => {
    setSwipeTip(false);
    markHint("swipe_back");
  }, [markHint]);

  // Opened from Home on a post: scroll to it in the feed and flash it, so the rest of the
  // feed is right there. If it's older than what's loaded, open it on its own instead.
  useEffect(() => {
    if (!jumpTo || (!feed.isSuccess && posts.length === 0)) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const el = document.querySelector(`[data-post-id="${jumpTo}"]`);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
      setFlash(jumpTo);
      window.setTimeout(() => setFlash(null), 1800);
    } else setDetailId(jumpTo);
    setJumpTo(null);
  }, [jumpTo, feed.isSuccess, posts.length]);

  // "See the post" on a shared comment opens the post it came from.
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string" && id) setDetailId(id);
    };
    window.addEventListener(OPEN_POST_EVENT, open);
    return () => window.removeEventListener(OPEN_POST_EVENT, open);
  }, []);

  // Infinite scroll on the feed.
  const sentinel = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || scope.kind !== "feed") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      // well before the end, so scrolling never waits on the next posts
      { rootMargin: "1400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, posts.length, scope.kind]);

  const openAuthor = (a: CommunityAuthor) => {
    setDetailId(null);
    if (a.user_id === user?.id) setScope({ kind: "you" });
    else setScope({ kind: "author", author: a, from: tab });
    window.scrollTo({ top: 0 });
  };
  const closeDetail = () => {
    setDetailId(null);
    if (window.location.hash.includes("post=")) history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const notAllowed = (feed.error as any)?.code === "42501";

  return (
    <>
    <div ref={rootRef} className="mx-auto w-full max-w-[560px] space-y-3 px-3 pb-12 pt-3 [touch-action:pan-x_pan-y] sm:px-4">
      {scope.kind === "author" ? (
        <Button
          type="button"
          variant="ghost"
          className="-ml-2 h-10 rounded-full px-3"
          onClick={leaveAuthor}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> {scope.from === "crew" ? "Crew" : scope.from === "you" ? "You" : "Feed"}
        </Button>
      ) : hideTabs ? null : (
        <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
        {backTo && (
          <Link to={backTo} aria-label="Back to Home" className="-ml-1.5 inline-flex h-9 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <div className="inline-flex rounded-full bg-muted p-1" role="tablist" aria-label="Community view">
          {(["feed", "crew", "you"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={scope.kind === k}
              onClick={() => setScope({ kind: k })}
              className={cn("h-9 rounded-full px-3.5 text-[13px] font-bold transition-colors", scope.kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
            >
              {k === "feed" ? "Feed" : k === "crew" ? "Crew" : "You"}
            </button>
          ))}
        </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {bell && <NotificationBell />}
          {canShare && <ShareWorkoutButton unit={unit} label="Share" previewOnly={previewOnly} />}
        </div>
        </div>
      )}

      {scope.kind === "crew" ? (
        <CrewList onOpen={openAuthor} />
      ) : scope.kind === "you" && user?.id ? (
        <ProfileView userId={user.id} unit={unit} onOpenPost={openPost} />
      ) : scope.kind === "author" ? (
        <ProfileView userId={scope.author.user_id} unit={unit} onOpenPost={openPost} />
      ) : feed.isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-96 w-full rounded-3xl" />
          ))}
        </div>
      ) : notAllowed ? (
        <EmptyNote title="Community isn't available on this account" body="It's open to active coaching clients." />
      ) : feed.isError ? (
        <div className="rounded-3xl border border-border/80 bg-card p-6 text-center text-sm">
          <p className="text-muted-foreground">Couldn't load the community.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void feed.refetch()}>
            Try again
          </Button>
        </div>
      ) : posts.length === 0 ? (
        <EmptyNote
          title="Be the first one in"
          body={canShare ? "Share a session from this month. Your crew sees the work, your coach sees it too." : "When clients share a workout, it shows up here."}
          action={canShare ? <ShareWorkoutButton unit={unit} label="Share your last workout" variant="block" previewOnly={previewOnly} /> : null}
        />
      ) : (
        <>
          {posts.map((p, i) => (
            <FeedItem key={p.id} index={i} data-post-id={p.id} className={cn("scroll-mt-20 rounded-3xl transition-shadow duration-700", flash === p.id && "ring-2 ring-primary")}>
            <PostRow
              post={p}
              thumbUrl={urls?.[p.media_thumb_path ?? (p.media_type === "image" ? p.media_path ?? "" : "")] ?? null}
              unit={unit}
              viewerIsStaff={viewerIsStaff}
              onOpen={openPost}
              onOpenComments={setCommentsFor}
              onOpenAuthor={openAuthor}
              doubleTapHint={p.id === hintId}
              openHint={p.id === openHintId}
              onDoubleTap={onDoubleTap}
              onTipDone={onTipDone}
            />
            </FeedItem>
          ))}
          <div ref={sentinel} aria-hidden className="h-px" />
          {isFetchingNextPage && <PostSkeleton />}
          {!hasNextPage && posts.length > 1 && (
            <FeedItem index={0}>
              <CaughtUp action={canShare ? <ShareWorkoutButton unit={unit} label="Share your session" previewOnly={previewOnly} /> : null} />
            </FeedItem>
          )}
        </>
      )}
      <CommentsSheet post={commentsFor} viewerIsStaff={viewerIsStaff} onClose={() => setCommentsFor(null)} />
      <PostDetailDialog postId={detailId} unit={unit} viewerIsStaff={viewerIsStaff} onClose={closeDetail} onOpenAuthor={openAuthor} />
    </div>
    {/* outside the page that slides, so they stay put */}
    <SwipeBack enabled={canSwipeBack} target={rootRef} onBack={swipeBack} onUsed={onSwipeUsed} />
    {swipeTip && <SwipeBackTip onDismiss={() => setSwipeTip(false)} />}
    {scope.kind === "feed" && <NewPostsPill count={newPosts.count} onShow={newPosts.show} />}
    </>
  );
}

/** One row owns its mutation so an optimistic reaction only re-renders that card. */
function PostRow(props: {
  post: CommunityPost;
  thumbUrl: string | null;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpen: (p: CommunityPost) => void;
  onOpenComments: (p: CommunityPost) => void;
  onOpenAuthor: (a: CommunityAuthor) => void;
  doubleTapHint?: boolean;
  onDoubleTap?: () => void;
  onTipDone?: () => void;
  openHint?: boolean;
}) {
  const react = useReact(props.post, props.viewerIsStaff);
  return (
    <PostCard
      {...props}
      onReact={(_p: CommunityPost, next: ReactionKey | null) => react.mutate(next, { onError: () => toast.error("Couldn't save that reaction") })}
    />
  );
}

function EmptyNote({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <Dumbbell className="mx-auto h-8 w-8 text-muted-foreground/60" />
      <div className="mt-3 text-sm font-bold">{title}</div>
      <p className="mx-auto mt-1 max-w-[32ch] text-[13px] leading-snug text-muted-foreground">{body}</p>
      {action ? <div className="mx-auto mt-5 max-w-[300px]">{action}</div> : null}
    </div>
  );
}
