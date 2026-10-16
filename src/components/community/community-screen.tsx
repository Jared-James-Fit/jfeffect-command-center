import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Dumbbell, Menu, Search, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { PostCard } from "@/components/community/post-card";
import { doubleTapTipKeys } from "@/components/community/reaction-button";
import { CommentsSheet } from "@/components/community/comments-sheet";
import { OPEN_POST_EVENT } from "@/components/community/shared-comment";
import { OPEN_PERSON_EVENT } from "@/lib/community-notifications";
import { PostDetailDialog } from "@/components/community/post-detail";
import { MyTabPhoto, ProfileView } from "@/components/community/profile-view";
import { ShareWorkoutButton } from "@/components/community/share-workout-picker";
import { StoryRail } from "@/components/community/crew-stories";
import { ShareNudge } from "@/components/community/share-nudge";
import { DiscoverPage } from "@/components/community/discover";
import { OPEN_DISCOVER_EVENT } from "@/lib/community-discover";
import { CrewActivity } from "@/components/community/crew-activity";
import { ActivityHeart } from "@/components/community/activity-heart";
import { OPEN_ACTIVITY_EVENT } from "@/lib/crew-activity";
import { BarBack, BarButton, BarTitle, CrewBar, CrewBrand, useBarHidden } from "@/components/community/crew-header";
import { DualAccountSwitcher } from "@/components/dual-account-switcher";
import { openAppMore } from "@/lib/shell-events";
import { RankingsHub, rankingsFromHash } from "@/components/community/league-hub";
import { markCommunitySeen, useMyCommunityId, useCommunityFeed, useCommunityProfile, useHintsSeen, useMarkHintSeen, usePostMediaUrls, useReact, useViewerUnit } from "@/lib/community.queries";
import { isPulsePost, storiesNeedMore, type CommunityAuthor, type CommunityPost, type ReactionKey } from "@/lib/community";
import { SuggestedAthletes } from "@/components/community/suggested-athletes";
import { useFollowState } from "@/lib/community-social";
import { cn } from "@/lib/utils";
import { SwipeBack, SwipeBackTip } from "@/components/swipe-back";
import { CaughtUp, FeedItem, NewPostsPill, PostSkeleton, useNewPosts } from "@/components/community/feed-motion";
import { useMediaPinchZoom } from "@/hooks/use-media-pinch-zoom";

/**
 * Crew opens on the feed, under one slim bar (Instagram's): + to post on the
 * left with Find athletes, the JF Effect name in the middle (with people you
 * follow, it's also the All / Following switch), Activity (the heart, with
 * its bubble) and your photo (your profile) on the right. Rankings is the
 * trophy on Crew's own button in the bar at the bottom. Each of those opens
 * as a page with ‹ back, and back lands where you were in the feed.
 */
type Tab = "feed" | "rankings" | "you" | "members" | "activity";
/** A tab, or someone else's profile opened from one. */
type Scope = { kind: Tab } | { kind: "author"; author: CommunityAuthor; from: Tab };
const TAB_LABEL: Record<Tab, string> = { feed: "Feed", rankings: "Rankings", you: "You", members: "Find athletes", activity: "Activity" };
/** Pages opened from another one, and where their back arrow goes. */
/** (Find athletes goes back to wherever it was opened from: the feed, Activity, a tab.) */
const PARENT: Partial<Record<Tab, Tab>> = { activity: "feed", members: "feed" };

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

/** `#you`: your own profile (the You tab). */
export function youFromHash(hash = typeof window === "undefined" ? "" : window.location.hash): boolean {
  return /^#?you(?:$|&)/.test(hash);
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
  canShare = false, previewOnly = false, backTo, hideTabs = false,
}: {
  canShare?: boolean;
  previewOnly?: boolean;
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
    if (person) return { kind: "author", author: { user_id: person, name: "", avatar_url: null, is_coach: false }, from: "feed" };
    // the coach's own Community page is just the feed
    if (hideTabs) return { kind: "feed" };
    // Home's ranking tiles (and old #league links) land on Rankings; #you on your profile; everything else on the Feed
    if (rankingsFromHash()) return { kind: "rankings" };
    if (youFromHash() && !previewOnly) return { kind: "you" };
    return { kind: "feed" };
  });
  const tab: Tab = scope.kind === "author" ? scope.from : scope.kind;
  // Find athletes: where its back arrow goes, and whether the search box takes the keyboard straight away
  const [discoverBack, setDiscoverBack] = useState<Tab>("feed");
  const [discoverFocus, setDiscoverFocus] = useState(false);
  const openDiscover = (from: Tab, focus = false) => {
    rememberFeedPlace();
    setDiscoverBack(from === "members" ? "feed" : from);
    setDiscoverFocus(focus);
    setScope({ kind: "members" });
    window.scrollTo({ top: 0 });
  };
  // someone else's profile is a page with a back arrow; yours is a tab
  const inProfile = scope.kind === "author";
  const [commentsFor, setCommentsFor] = useState<CommunityPost | null>(null);
  const [detailId, setDetailId] = useState<string | null>(() => postFromHash());
  const [jumpTo, setJumpTo] = useState<string | null>(() => atFromHash());
  const [flash, setFlash] = useState<string | null>(null);

  const feed = useCommunityFeed(null);
  const posts = useMemo(() => feed.data?.pages.flatMap((p) => p.posts) ?? [], [feed.data]);
  // The feed is the posts people made, newest first. A finished session that posted
  // itself (a Pulse) is in that athlete's story instead (and on their profile).
  const ownPosts = useMemo(() => posts.filter((p) => !isPulsePost(p)), [posts]);
  // All (the whole crew, like a Strava club) or Following (just the people you follow, and you).
  const { data: follows } = useFollowState(!hideTabs);
  const followingIds = useMemo(() => new Set(follows?.following ?? []), [follows]);
  const [only, setOnly] = useState<"all" | "following">("all");
  const following = only === "following" && followingIds.size > 0;
  const feedPosts = useMemo(
    () => (following ? ownPosts.filter((p) => p.is_mine || followingIds.has(p.author.user_id) || p.collaborators?.some((c) => followingIds.has(c.user_id))) : ownPosts),
    [following, ownPosts, followingIds],
  );
  // "Double-tap to like": a few seconds on the first post (a workout before a
  // note), once a visit, until the first double-tap, and only for the first
  // few visits either way. Remembered on the account, not the device.
  const hints = useHintsSeen();
  const markHint = useMarkHintSeen();
  const onDoubleTap = useCallback(() => markHint("double_tap"), [markHint]);
  const [tipDone, setTipDone] = useState(tipShownThisVisit);
  const tipVisit = hints.data && !hints.data.includes("double_tap") ? doubleTapTipKeys.find((k) => !hints.data!.includes(k)) : undefined;
  const hintId = scope.kind === "feed" && !tipDone && tipVisit && posts.length ? ((posts.find((p) => p.kind !== "note" && !isPulsePost(p)) ?? posts.find((p) => !isPulsePost(p)))?.id ?? null) : null;
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
    scope.kind === "feed" && hints.data && !hints.data.includes(OPEN_HINT) && (tipDone || !tipVisit)
      ? (posts.find((p) => p.kind !== "note" && !!p.stats)?.id ?? null)
      : null;
  const openPost = useCallback((post: CommunityPost) => {
    if (post.kind !== "note") markHint(OPEN_HINT);
    setDetailId(post.id);
  }, [markHint]);
  const { data: urls } = usePostMediaUrls(scope.kind === "feed" ? posts : []);

  // Seeing the feed clears the "new posts" badge (server-side, every device). Only the
  // feed: opening on Rankings mustn't clear a count you haven't looked at.
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current || !feed.isSuccess || scope.kind !== "feed") return;
    markedRef.current = true;
    void markCommunitySeen(qc);
  }, [feed.isSuccess, qc, scope.kind]);

  const { data: unit = "lb" } = useViewerUnit(user?.id);

  // New posts from the crew while you're down the feed: a pill to jump up to them.
  const myId = useMyCommunityId();
  const newPosts = useNewPosts(scope.kind === "feed" && !previewOnly, myId);
  // Tapping the Community tab while you're on it: back to the feed's top, fresh.
  const showNew = useRef(newPosts.show);
  showNew.current = newPosts.show;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  // Where you were in the feed: a page opened from it (a profile, Rankings, Activity) goes back to that spot.
  // Taken the moment you tap your way out (rememberFeedPlace), and otherwise only once the page has
  // settled on the feed, so a jump the router makes while switching views (the trophy) never counts.
  const feedY = useRef(0);
  const restoreY = useRef<number | null>(null);
  const rememberFeedPlace = () => {
    if (scopeRef.current.kind === "feed") feedY.current = window.scrollY;
  };
  useEffect(() => {
    const onRetap = (e: Event) => {
      if ((e as CustomEvent).detail !== window.location.pathname) return;
      // out of someone's profile first, out of yours to the feed; on the feed, back to the top and fresh
      setScope((sc) => (sc.kind === "author" ? { kind: sc.from } : sc.kind === "you" || sc.kind === "members" || sc.kind === "activity" ? { kind: "feed" } : sc));
      if (scopeRef.current.kind === "feed") showNew.current();
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

  // The URL hash drives Feed / Rankings while you're here, so the bar's
  // Rankings shortcut (#rankings) and Crew's own button (no hash) switch the
  // view without reloading the page, and the tabs below keep the hash in step
  // so the bar lights the right one.
  const routeHash = useRouterState({ select: (s) => s.location.hash });
  // null: also apply the hash once on arrival (the router's, not window's).
  const seenHash = useRef<string | null>(null);
  useEffect(() => {
    if (hideTabs || routeHash === seenHash.current) return;
    seenHash.current = routeHash;
    if (rankingsFromHash(`#${routeHash}`)) setScope({ kind: "rankings" });
    else if (youFromHash(`#${routeHash}`) && !previewOnly) setScope({ kind: "you" });
    // no hash (Crew's own button) or #feed (after posting): back on the feed
    else if (!routeHash || routeHash === "feed") setScope((sc) => (sc.kind === "rankings" || sc.kind === "you" ? { kind: "feed" } : sc));
  }, [routeHash, hideTabs, previewOnly]);
  const parent = scope.kind === "members" ? discoverBack : PARENT[scope.kind as Tab];
  // The clients' Crew draws its own bar (the shell's steps aside); the coach's Crew page has its own header and tabs.
  const ownBar = !hideTabs;
  // a coach viewing as a client: the shell's bar and the preview banner stay, so Crew's bar sits in the page
  const barInline = previewOnly;
  const barHidden = useBarHidden(ownBar && !barInline && scope.kind === "feed");
  // your profile is a page with a way back to the feed (on the coach's page, and now on Crew's bar too)
  const youAsPage = scope.kind === "you";

  useEffect(() => {
    let settle = 0;
    const onScroll = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (scopeRef.current.kind === "feed") feedY.current = window.scrollY;
      }, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  useEffect(() => {
    if (scope.kind !== "feed" || restoreY.current == null) return;
    const y = restoreY.current;
    restoreY.current = null;
    // after the feed is back on the page (it comes straight from the cache)
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
  }, [scope.kind]);
  /** Open a page from the feed (or anywhere): at its top. */
  const go = (next: Scope) => {
    rememberFeedPlace();
    setDetailId(null);
    setScope(next);
    window.scrollTo({ top: 0 });
  };
  /** ‹ back: the feed comes back where you left it; Rankings / your profile drop their #hash so the bar lights Crew again. */
  const goBack = (k: Tab) => {
    if (k === "feed") restoreY.current = feedY.current;
    setScope({ kind: k });
    if (k !== "feed") window.scrollTo({ top: 0 });
    // (back to Rankings or your profile from someone's page keeps its hash, or the hash effect would bounce it to the feed)
    if (k === "feed" && /^#(rankings|league|you)/.test(window.location.hash)) void navigate({ to: ".", hash: "", replace: true, resetScroll: false });
  };
  const openMe = () => {
    go({ kind: "you" });
    void navigate({ to: ".", hash: "you", replace: true, resetScroll: false });
  };

  // (Rankings keeps its own sideways swipe between boards, so no swipe-back there.)
  const canSwipeBack = inProfile || youAsPage || !!parent || !!backTo;
  const leaveAuthor = () => {
    if (youAsPage) return goBack("feed");
    if (scope.kind !== "author") return;
    goBack(scope.from);
    if (window.location.hash.includes("person=")) history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  const swipeBack = () => {
    if (inProfile || youAsPage) return leaveAuthor();
    if (parent) return goBack(parent);
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

  // A follow notice (or anything else that names someone) opens their profile; your own id, yours.
  const meRef = useRef<(string | null | undefined)[]>([]);
  meRef.current = [user?.id, myId];
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id !== "string" || !id) return;
      rememberFeedPlace();
      setDetailId(null);
      setScope((sc) => {
        const from = sc.kind === "author" ? sc.from : sc.kind;
        return meRef.current.includes(id) ? { kind: "you" } : { kind: "author", author: { user_id: id, name: "", avatar_url: null, is_coach: false }, from };
      });
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(OPEN_PERSON_EVENT, open);
    return () => window.removeEventListener(OPEN_PERSON_EVENT, open);
  }, []);

  // The coach's Crew header opens Activity here (its heart), scrolled to it (it sits under the coach's week panel).
  useEffect(() => {
    const open = () => {
      setDetailId(null);
      setScope({ kind: "activity" });
      requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "start" }));
    };
    window.addEventListener(OPEN_ACTIVITY_EVENT, open);
    return () => window.removeEventListener(OPEN_ACTIVITY_EVENT, open);
  }, []);

  // The coach's Crew header opens Find athletes here.
  useEffect(() => {
    const open = () => {
      setDetailId(null);
      setDiscoverBack("feed");
      setDiscoverFocus(true);
      setScope({ kind: "members" });
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(OPEN_DISCOVER_EVENT, open);
    return () => window.removeEventListener(OPEN_DISCOVER_EVENT, open);
  }, []);

  // Infinite scroll on the feed.
  const sentinel = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  // The first page is small: on a busy day, read on until the story rail holds the whole last day
  const readAhead = scope.kind === "feed" && feed.isSuccess && !feed.isError && storiesNeedMore(posts, !!hasNextPage, feed.data?.pages.length ?? 0);
  useEffect(() => {
    if (readAhead && !isFetchingNextPage) void fetchNextPage();
  }, [readAhead, isFetchingNextPage, fetchNextPage]);
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
    rememberFeedPlace();
    setDetailId(null);
    if (a.user_id === user?.id || a.user_id === myId) setScope({ kind: "you" });
    else setScope({ kind: "author", author: a, from: tab });
    window.scrollTo({ top: 0 });
  };
  const closeDetail = () => {
    setDetailId(null);
    if (window.location.hash.includes("post=")) history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const notAllowed = (feed.error as any)?.code === "42501";

  // Crew's one bar, per page. Find athletes keeps its own search field at the top instead.
  const crewBar = !ownBar ? null : scope.kind === "feed" ? (
    <CrewBar
      label="Crew"
      hidden={barHidden}
      inline={barInline}
      left={
        <>
          {/* + : the camera and everything you can post (post, meal, lock in, workout, write), Instagram's spot */}
          {canShare && (
            <ShareWorkoutButton
              unit={unit}
              previewOnly={previewOnly}
              trigger={(begin) => (
                <BarButton label="Create a post" onClick={begin} data-crew-create>
                  <SquarePlus className="h-[25px] w-[25px]" strokeWidth={1.9} />
                </BarButton>
              )}
            />
          )}
          {/* Find athletes: search by name or @username, people to follow (not while a coach views as a client) */}
          {!previewOnly && (
            <BarButton label="Find athletes" onClick={() => openDiscover("feed", true)} data-discover-open>
              <Search className="h-[23px] w-[23px]" strokeWidth={2} />
            </BarButton>
          )}
        </>
      }
      center={
        <CrewBrand
          following={following}
          canFilter={!previewOnly && followingIds.size > 0}
          onFilter={(f) => {
            setOnly(f);
            window.scrollTo({ top: 0 });
          }}
          onTop={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        />
      }
      right={
        !previewOnly && (
          <>
            {/* Activity: who liked, commented, followed; what's new rises out of it in a bubble, then a dot until it's read */}
            <ActivityHeart onOpen={() => go({ kind: "activity" })} canPreview={!barHidden && !detailId && !commentsFor} />
            {/* you: your own profile (posts, followers, edit), with your photo */}
            <BarButton label="Your profile" onClick={openMe} data-my-profile>
              <MyTabPhoto size={27} />
            </BarButton>
          </>
        )
      }
    />
  ) : scope.kind === "rankings" ? (
    <CrewBar label="Rankings" inline={barInline} left={<BarBack label="Back to the feed" onClick={() => goBack("feed")} />} center={<BarTitle>Rankings</BarTitle>} />
  ) : scope.kind === "you" && user?.id ? (
    <CrewBar
      label="Your profile"
      inline={barInline}
      left={<BarBack label="Back to the feed" onClick={leaveAuthor} />}
      center={<ProfileBarTitle userId={user.id} />}
      // the app's menu (settings, account, everything else), where Instagram keeps it: your profile's ☰
      right={
        <BarButton label="More" onClick={openAppMore} data-crew-more>
          <Menu className="h-[25px] w-[25px]" strokeWidth={1.9} />
        </BarButton>
      }
    />
  ) : scope.kind === "author" ? (
    <CrewBar
      label="Profile"
      inline={barInline}
      left={<BarBack label={`Back to ${TAB_LABEL[scope.from]}`} onClick={leaveAuthor} />}
      center={<ProfileBarTitle userId={scope.author.user_id} fallback={scope.author.name} />}
    />
  ) : scope.kind === "activity" ? (
    <CrewBar
      label="Activity"
      inline={barInline}
      left={<BarBack label="Back to the feed" onClick={() => goBack("feed")} />}
      center={<BarTitle>Activity</BarTitle>}
      right={
        <BarButton label="Find people" onClick={() => openDiscover("activity", true)}>
          <Search className="h-[23px] w-[23px]" strokeWidth={2} />
        </BarButton>
      }
    />
  ) : null;

  return (
    <>
    {crewBar}
    {/* Find athletes has no bar: its search field starts right under the status bar */}
    {ownBar && !barInline && !crewBar && <div aria-hidden className="md:hidden" style={{ height: "env(safe-area-inset-top, 0px)" }} />}
    {/* a staff login that's also a client: its My Workouts / Staff switch, under Crew's bar instead of the shell's */}
    {ownBar && !barInline && <DualAccountSwitcher />}
    <div ref={rootRef} className={cn("mx-auto w-full max-w-[560px] space-y-3 px-3 pb-12 [touch-action:pan-x_pan-y] sm:px-4", ownBar ? "pt-1.5" : "pt-3")}>
      {ownBar ? null : inProfile || youAsPage ? (
        <Button
          type="button"
          variant="ghost"
          className="-ml-2 h-10 rounded-full px-3"
          onClick={leaveAuthor}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> {TAB_LABEL[youAsPage ? "feed" : tab]}
        </Button>
      ) : null}

      {scope.kind === "rankings" ? (
        <RankingsHub />
      ) : scope.kind === "activity" ? (
        <CrewActivity
          header={!ownBar}
          onBack={() => goBack("feed")}
          onOpenPost={(id) => setDetailId(id)}
          onOpenPerson={openAuthor}
          onFindPeople={() => openDiscover("activity", true)}
        />
      ) : scope.kind === "members" ? (
        <DiscoverPage onBack={() => goBack(discoverBack)} onOpen={openAuthor} onOpenMe={previewOnly ? undefined : () => go({ kind: "you" })} autoFocus={discoverFocus} canInvite={!previewOnly} />
      ) : scope.kind === "you" && user?.id ? (
        <ProfileView userId={user.id} unit={unit} onOpenPost={openPost} onOpenPerson={openAuthor} />
      ) : scope.kind === "author" ? (
        <ProfileView userId={scope.author.user_id} unit={unit} onOpenPost={openPost} onOpenPerson={openAuthor} />
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
          {/* the crew's last day, story-style; your own post bubble first */}
          <StoryRail
            posts={posts}
            unit={unit}
            viewerIsStaff={viewerIsStaff}
            onOpenPost={(id) => setDetailId(id)}
            onOpenPerson={openAuthor}
            onJumpTo={setJumpTo}
            addStory={canShare ? (t) => <ShareWorkoutButton unit={unit} previewOnly={previewOnly} trigger={t} /> : undefined}
            addYours={canShare ? <ShareWorkoutButton unit={unit} label="Add yours" variant="block" previewOnly={previewOnly} /> : null}
          />
          {/* All / Following lives in the name at the top (its ⌄), Instagram's way: no second row of chips here */}
          {following && feedPosts.length === 0 && (
            <EmptyNote title="Nothing new from people you follow" body="Their posts land here. The whole crew is under All." action={<Button type="button" variant="outline" className="w-full" onClick={() => setOnly("all")}>Show all posts</Button>} />
          )}
          {feedPosts.map((p, i) => (
            <Fragment key={p.id}>
            <FeedItem index={i} data-post-id={p.id} className={cn("scroll-mt-20 transition-shadow duration-700 sm:rounded-3xl", flash === p.id && "ring-2 ring-primary")}>
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
            {/* now and then, until their first post: an invite to lock in or share (after the second post) */}
            {canShare && !following && i === Math.min(1, feedPosts.length - 1) && <ShareNudge surface="feed" unit={unit} />}
            {/* people to follow right after the first post (Instagram's spot): the post they opened the app for first, then the row.
                Crew data: 63% of visits see one new post and under 3 in 10 reach the third, so later spots go unseen.
                Only people with a real reason (your coach, follows you, mutuals, same gym…) */}
            {!hideTabs && !previewOnly && !following && i === 0 && (
              <SuggestedAthletes onOpen={openAuthor} strongOnly hideable onSeeAll={() => openDiscover("feed")} />
            )}
            </Fragment>
          ))}
          <div ref={sentinel} aria-hidden className="h-px" />
          {isFetchingNextPage && <PostSkeleton />}
          {!hasNextPage && posts.length > 1 && (
            <FeedItem index={0}>
              <CaughtUp
                action={canShare ? <ShareWorkoutButton unit={unit} label="Share your session" previewOnly={previewOnly} /> : null}
                more={previewOnly ? null : (
                  <button type="button" onClick={() => openDiscover("feed")} className="text-[13px] font-bold text-primary active:opacity-70" data-caught-up-discover>
                    Find people to follow
                  </button>
                )}
              />
            </FeedItem>
          )}
        </>
      )}
      <CommentsSheet post={commentsFor} viewerIsStaff={viewerIsStaff} onClose={() => setCommentsFor(null)} onOpenAuthor={openAuthor} />
      <PostDetailDialog postId={detailId} unit={unit} viewerIsStaff={viewerIsStaff} onClose={closeDetail} onOpenAuthor={openAuthor} />
    </div>
    {/* outside the page that slides, so they stay put */}
    <SwipeBack enabled={canSwipeBack} target={rootRef} onBack={swipeBack} onUsed={onSwipeUsed} />
    {swipeTip && <SwipeBackTip onDismiss={() => setSwipeTip(false)} />}
    {scope.kind === "feed" && <NewPostsPill count={newPosts.count} onShow={newPosts.show} />}
    </>
  );
}

/** A profile's bar title: their @username (Instagram's), else their name. */
function ProfileBarTitle({ userId, fallback }: { userId: string; fallback?: string }) {
  const { data } = useCommunityProfile(userId);
  const title = data?.username ? `@${data.username}` : data?.author.name || fallback || "";
  return <BarTitle>{title}</BarTitle>;
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
