import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ChartNoAxesColumn, Dumbbell, Menu, Search, SquarePlus, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { attentionExit } from "@/lib/post-attention";
import { PostCard } from "@/components/community/post-card";
import { doubleTapTipKeys } from "@/components/community/reaction-button";
import { CommentsSheet } from "@/components/community/comments-sheet";
import { PostSheet, type PostSheetAt } from "@/components/community/post-sheet";
import { ReelsViewer, type ReelStart } from "@/components/community/reels-viewer";
import { OPEN_POST_EVENT } from "@/components/community/shared-comment";
import { OPEN_PERSON_EVENT } from "@/lib/community-notifications";
import { PostDetailDialog } from "@/components/community/post-detail";
import { MyTabPhoto, ProfileView } from "@/components/community/profile-view";
import { ShareWorkoutButton } from "@/components/community/share-workout-picker";
import { StoryRail } from "@/components/community/crew-stories";
import { StoryReplyHost } from "@/components/community/story-reply-host";
import { ShareNudge } from "@/components/community/share-nudge";
import { DiscoverPage } from "@/components/community/discover";
import { OPEN_DISCOVER_EVENT } from "@/lib/community-discover";
import { CrewActivity } from "@/components/community/crew-activity";
import { ActivityHeart } from "@/components/community/activity-heart";
import { OPEN_ACTIVITY_EVENT } from "@/lib/crew-activity";
import { BarBack, BarButton, BarTitle, CrewBar, CrewBrand, useBarHidden } from "@/components/community/crew-header";
import { DualAccountSwitcher } from "@/components/dual-account-switcher";
import { openAppMore } from "@/lib/shell-events";
import { bubbleFold, ease, FIRST_POST_RADIUS, setFeedPaging, storiesProgress, watchFeedViewport } from "@/lib/feed-paging";
import { RankingsHub, rankingsFromHash } from "@/components/community/league-hub";
import { manageTabFromHash, type ManageTab } from "@/lib/crew-manage";
import { markCommunitySeen, useMyCommunityId, useCommunityFeed, useRankedFeed, useCommunityProfile, useHintsSeen, useMarkHintSeen, usePostMediaUrls, useReact, useViewerUnit } from "@/lib/community.queries";
import { caughtUpAt, inFeed, inFollowingFeed, storiesNeedMore, uniquePosts, type CommunityAuthor, type CommunityPost, type ReactionKey } from "@/lib/community";
import { SuggestedAthletes } from "@/components/community/suggested-athletes";
import { useFollowState } from "@/lib/community-social";
import { cn } from "@/lib/utils";
import { SwipeBack, SwipeBackTip } from "@/components/swipe-back";
import { CaughtUp, CaughtUpLine, FeedItem, NewPostsPill, useNewPosts } from "@/components/community/feed-motion";
import { ActivitySpinner } from "@/components/activity-spinner";
import { useMediaPinchZoom } from "@/hooks/use-media-pinch-zoom";

/**
 * Crew opens on the feed, under one slim bar (Instagram's): + to post and the
 * trophy (Rankings) on the left, the JF Effect name in the middle (with people
 * you follow, it's also the All / Following switch), Activity (the heart, with
 * its bubble; Find athletes is its search) and your photo (your profile) on the
 * right. Each of those opens as a page with ‹ back, and back lands where you
 * were in the feed.
 */
type Tab = "feed" | "rankings" | "you" | "members" | "activity" | "manage";
/** A tab, or someone else's profile opened from one. */
type Scope = { kind: Tab } | { kind: "author"; author: CommunityAuthor; from: Tab };
const TAB_LABEL: Record<Tab, string> = { feed: "Feed", rankings: "Rankings", you: "You", members: "Find athletes", activity: "Activity", manage: "Manage" };
/** Pages opened from another one, and where their back arrow goes. */
/** (Find athletes goes back to wherever it was opened from: the feed, Activity, a tab.) */
const PARENT: Partial<Record<Tab, Tab>> = { activity: "feed", members: "feed", manage: "feed" };

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
/**
 * How far ahead of the end the paged feed asks for its next page: four screens,
 * i.e. four posts (a page of ten takes the database ~0.2 s, so it's in long
 * before a quick run of swipes gets there).
 */
export const FEED_READ_AHEAD = "400% 0px";
/** "Swipe right to go back": asks on up to 5 visits, until it's been used once. */
const SWIPE_TIP_VISITS = 5;
export const swipeTipKeys = Array.from({ length: SWIPE_TIP_VISITS }, (_, i) => `swipe_back_shown_${i + 1}`);
let swipeTipShownThisVisit = false;

/**
 * The coach's own Crew page (/admin/community): the clients' Crew, bar, stories
 * and full-screen feed, with the coach's tools in it (crew-manage.ts). + writes
 * a post to the crew (the coach's composer, not the studio), and Manage takes
 * the trophy's place: a page of its own with what's waiting on them, Posts and
 * Insights (the League is the trophy on Manage's bar).
 */
export type CoachCrew = {
  /** + : the coach's composer. */
  onWrite: () => void;
  /** Something is waiting on the coach: a dot on Manage. */
  waiting: boolean;
  /** The tab Manage opens on. */
  startTab: ManageTab;
  /** Manage's page, under Crew's bar with ‹ back to the feed. */
  manage: ReactNode;
};

export function CommunityScreen({
  canShare = false, previewOnly = false, backTo, hideTabs = false, coach,
}: {
  canShare?: boolean;
  previewOnly?: boolean;
  /** A small back arrow at the start of the top row (instead of a page header). */
  backTo?: string;
  /** Just the feed of cards, no bar of its own (the finance login's look at the crew). */
  hideTabs?: boolean;
  coach?: CoachCrew;
}) {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  // viewing as a client: the client's screen, without the coach's extras (remove anyone's post, …)
  const viewerIsStaff = (role === "admin" || role === "coach") && !previewOnly;
  // leaving Crew ends the visit on whatever post is on screen (an exit); a layout
  // cleanup, so it runs before the cards' own cleanups take them off screen
  useLayoutEffect(() => () => attentionExit(), []);
  const [scope, setScope] = useState<Scope>(() => {
    const person = personFromHash();
    if (person) return { kind: "author", author: { user_id: person, name: "", avatar_url: null, is_coach: false }, from: "feed" };
    // the finance login's look at the crew is just the feed
    if (hideTabs) return { kind: "feed" };
    // the coach's Manage (#tab=needs / posts / insights): straight there
    if (coach && manageTabFromHash(window.location.hash)) return { kind: "manage" };
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
  // a clip tapped in the feed: the feed's clips full screen, from that one
  const [reel, setReel] = useState<ReelStart | null>(null);
  const openReel = useCallback((post: CommunityPost, path: string) => setReel({ postId: post.id, path }), []);
  const [detailId, setDetailId] = useState<string | null>(() => postFromHash());
  const [jumpTo, setJumpTo] = useState<string | null>(() => atFromHash());
  const [flash, setFlash] = useState<string | null>(null);

  // The crew's last day in time order: the story rail (and the read-ahead that fills it).
  const feed = useCommunityFeed(null);
  const posts = useMemo(() => feed.data?.pages.flatMap((p) => p.posts) ?? [], [feed.data]);
  // The posts you scroll: what's new to you this visit first, ranked, then "You're all
  // caught up" and everything else, newest first (useRankedFeed). A finished session that
  // posted itself (a Pulse) is in that athlete's story instead (and on their profile), and
  // a story someone posted (STORY on the camera) is only in the story rail.
  const ranked = useRankedFeed();
  const rankedPosts = useMemo(() => uniquePosts(ranked.data?.pages.flatMap((p) => p.posts) ?? []), [ranked.data]);
  const ownPosts = useMemo(() => rankedPosts.filter(inFeed), [rankedPosts]);
  // All (the whole crew, like a Strava club) or Following (just the people you follow, and you).
  const { data: follows } = useFollowState(!hideTabs);
  const followingIds = useMemo(() => new Set(follows?.following ?? []), [follows]);
  const [only, setOnly] = useState<"all" | "following">("all");
  const following = only === "following" && followingIds.size > 0;
  const feedPosts = useMemo(
    () => (following ? ownPosts.filter((p) => inFollowingFeed(p, followingIds)) : ownPosts),
    [following, ownPosts, followingIds],
  );
  // "You're all caught up" goes before the first post you'd already seen, when new ones came first
  const caughtUp = useMemo(() => caughtUpAt(feedPosts), [feedPosts]);
  // "Double-tap to like": a few seconds on the first post (a workout before a
  // note), once a visit, until the first double-tap, and only for the first
  // few visits either way. Remembered on the account, not the device.
  const hints = useHintsSeen();
  const markHint = useMarkHintSeen();
  const onDoubleTap = useCallback(() => markHint("double_tap"), [markHint]);
  const [tipDone, setTipDone] = useState(tipShownThisVisit);
  const tipVisit = hints.data && !hints.data.includes("double_tap") ? doubleTapTipKeys.find((k) => !hints.data!.includes(k)) : undefined;
  const hintId = scope.kind === "feed" && !tipDone && tipVisit && feedPosts.length ? ((feedPosts.find((p) => p.kind !== "note") ?? feedPosts[0])?.id ?? null) : null;
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
      ? (feedPosts.find((p) => p.kind !== "note" && !!p.stats)?.id ?? null)
      : null;
  const openPost = useCallback((post: CommunityPost) => {
    if (post.kind !== "note") markHint(OPEN_HINT);
    setDetailId(post.id);
  }, [markHint]);
  const { data: urls } = usePostMediaUrls(scope.kind === "feed" ? feedPosts : []);

  // Seeing the feed clears the "new posts" badge (server-side, every device). Only the
  // feed: opening on Rankings mustn't clear a count you haven't looked at.
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current || !ranked.isSuccess || scope.kind !== "feed") return;
    markedRef.current = true;
    void markCommunitySeen(qc);
  }, [ranked.isSuccess, qc, scope.kind]);

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
      setScope((sc) => (sc.kind === "author" ? { kind: sc.from } : sc.kind === "you" || sc.kind === "members" || sc.kind === "activity" || sc.kind === "manage" ? { kind: "feed" } : sc));
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
  const coachPage = !!coach;
  useEffect(() => {
    if (hideTabs || routeHash === seenHash.current) return;
    seenHash.current = routeHash;
    if (rankingsFromHash(`#${routeHash}`)) setScope({ kind: "rankings" });
    // the coach's Manage, any tab (a push, an old link, the Posts tab's own pages)
    else if (coachPage && manageTabFromHash(`#${routeHash}`)) setScope({ kind: "manage" });
    else if (youFromHash(`#${routeHash}`) && !previewOnly) setScope({ kind: "you" });
    // no hash (Crew's own button) or #feed (after posting): back on the feed
    else if (!routeHash || routeHash === "feed") setScope((sc) => (sc.kind === "rankings" || sc.kind === "you" || sc.kind === "manage" ? { kind: "feed" } : sc));
  }, [routeHash, hideTabs, previewOnly, coachPage]);
  const parent = scope.kind === "members" ? discoverBack : PARENT[scope.kind as Tab];
  // Crew draws its own bar (the shell's steps aside), the clients' and the coach's alike; only the finance login's look at the crew (hideTabs) doesn't.
  const ownBar = !hideTabs;
  // a coach viewing as a client: the shell's bar and the preview banner stay, so Crew's bar sits in the page
  // Crew's own feed is one post per screen, swiped one at a time (TikTok's): the window snaps
  // to each post (html.feed-paging, styles.css), every post the whole screen with Crew's bar
  // floating over its top (it stays put) and the tab bar over its bottom; screens are the
  // window's measured height (--feed-vh). The coach's Crew page is the same feed (Nov 14 2026).
  const paging = ownBar && scope.kind === "feed";
  useLayoutEffect(() => {
    if (!paging) return;
    setFeedPaging(true);
    const unwatch = watchFeedViewport();
    return () => {
      unwatch();
      setFeedPaging(false);
    };
  }, [paging]);
  const barHidden = useBarHidden(ownBar && scope.kind === "feed" && !paging);
  // on the paged feed a post's words and comments open in one sheet (Reels'): "… more" at the caption, 💬 at the comments
  const [sheet, setSheet] = useState<{ post: CommunityPost; at: PostSheetAt } | null>(null);
  const openCaptionSheet = useCallback((p: CommunityPost) => setSheet({ post: p, at: "caption" }), []);
  const openCommentsSheet = useCallback((p: CommunityPost) => setSheet({ post: p, at: "comments" }), []);
  useEffect(() => {
    if (!paging) setSheet(null);
  }, [paging]);
  // the post as the feed has it now (a like or a comment count moves with it)
  const sheetPost = sheet ? feedPosts.find((p) => p.id === sheet.post.id) ?? sheet.post : null;
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
    if (k === "feed" && /^#(rankings|league|you|tab=)/.test(window.location.hash)) void navigate({ to: ".", hash: "", replace: true, resetScroll: false });
  };
  const openMe = () => {
    go({ kind: "you" });
    void navigate({ to: ".", hash: "you", replace: true, resetScroll: false });
  };
  /** Rankings: the trophy in Crew's bar, one tap from any post (never a bubble among the stories, which fold away). */
  const openRankings = () => {
    go({ kind: "rankings" });
    void navigate({ to: ".", hash: "rankings", replace: true, resetScroll: false });
  };
  /** The finance login's feed has no bar: the League is the trophy bubble at the start of its stories. */
  const rankings = hideTabs ? { label: "League", onOpen: () => void navigate({ to: "/admin/league" }) } : undefined;
  /** The coach's Manage: the bar's chart, in the trophy's place (its tab lives in the hash, so Back and links agree). */
  const openManage = () => {
    if (!coach) return;
    go({ kind: "manage" });
    void navigate({ to: ".", hash: `tab=${coach.startTab}`, replace: true, resetScroll: false });
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
  const feedReady = ranked.isSuccess || feedPosts.length > 0;
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
    if (!jumpTo || (!ranked.isSuccess && feedPosts.length === 0)) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const el = document.querySelector(`[data-post-id="${jumpTo}"]`);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
      setFlash(jumpTo);
      window.setTimeout(() => setFlash(null), 1800);
    } else setDetailId(jumpTo);
    setJumpTo(null);
  }, [jumpTo, ranked.isSuccess, feedPosts.length]);

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
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = ranked;
  // The story rail's first page is small: on a busy day, read on until it holds the whole last day
  const readAhead = scope.kind === "feed" && feed.isSuccess && !feed.isError && storiesNeedMore(posts, !!feed.hasNextPage, feed.data?.pages.length ?? 0);
  useEffect(() => {
    if (readAhead && !feed.isFetchingNextPage) void feed.fetchNextPage();
  }, [readAhead, feed.isFetchingNextPage, feed.fetchNextPage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || scope.kind !== "feed") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      // well before the end, so scrolling never waits on the next posts: on the
      // paged feed four screens (four posts) ahead, so a quick run of swipes
      // never reaches the end before the next page is in (FEED_READ_AHEAD)
      { rootMargin: paging ? FEED_READ_AHEAD : "1400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, feedPosts.length, scope.kind, paging]);

  // The first screen is the story rail and the first post: from where it starts to the bottom of the screen.
  const firstScreen = useRef<HTMLDivElement | null>(null);
  const hasFeedPosts = feedPosts.length > 0;
  useLayoutEffect(() => {
    const el = firstScreen.current;
    if (!paging || !el) return;
    // with posts the stories sit on top of a full-size first post (TikTok's Friends); only an empty feed fills the screen
    if (hasFeedPosts) {
      el.style.height = "";
      return;
    }
    const fit = () => {
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY));
      const h = `calc(var(--feed-vh, 100svh) - ${top}px)`;
      if (el.style.height !== h) el.style.height = h;
    };
    fit();
    // anything above it changing size (the account switcher arriving) moves where it starts
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(document.body);
    window.addEventListener("resize", fit);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [paging, hasFeedPosts]);

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

  const notAllowed = ((ranked.error ?? feed.error) as any)?.code === "42501";

  // Crew's one bar, per page. Find athletes keeps its own search field at the top instead.
  const crewBar = !ownBar ? null : scope.kind === "feed" ? (
    <CrewBar
      label="Crew"
      hidden={barHidden}
      overlay={paging}
      left={
        <>
          {/* the coach's + : a post to the crew from the coach's composer */}
          {coach && (
            <BarButton label="Write a post" onClick={coach.onWrite} data-crew-write>
              <SquarePlus className="h-[25px] w-[25px]" strokeWidth={1.9} />
            </BarButton>
          )}
          {/* + : the camera and everything you can post (post, meal, lock in, workout, write), Instagram's spot */}
          {canShare && !coach && (
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
          {/* Rankings: the League and Hall of Strength, one tap from any post (Find athletes is Activity's search,
              the people-to-follow row and the caught-up card) */}
          {coach ? (
            // the coach's Manage in the trophy's place: what's waiting on them, Posts and Insights, a dot while something waits
            <BarButton label={coach.waiting ? "Manage Crew, something's waiting on you" : "Manage Crew"} onClick={openManage} data-crew-manage>
              <ChartNoAxesColumn className="h-[24px] w-[24px]" strokeWidth={2} />
              {coach.waiting && <span className="absolute right-[7px] top-[7px] h-[9px] w-[9px] rounded-full bg-primary ring-2 ring-background" aria-hidden data-manage-waiting />}
            </BarButton>
          ) : (
            <BarButton label="Rankings" onClick={openRankings} data-crew-rankings>
              <Trophy className="h-[23px] w-[23px]" strokeWidth={2} />
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
            <ActivityHeart onOpen={() => go({ kind: "activity" })} canPreview={!barHidden && !detailId && !commentsFor && !reel && !sheet} />
            {/* you: your own profile (posts, followers, edit), with your photo */}
            <BarButton label="Your profile" onClick={openMe} data-my-profile>
              <MyTabPhoto size={27} />
            </BarButton>
          </>
        )
      }
    />
  ) : scope.kind === "rankings" ? (
    <CrewBar label="Rankings" left={<BarBack label="Back to the feed" onClick={() => goBack("feed")} />} center={<BarTitle>Rankings</BarTitle>} />
  ) : scope.kind === "manage" && coach ? (
    <CrewBar
      label="Manage Crew"
      left={<BarBack label="Back to the feed" onClick={() => goBack("feed")} />}
      center={<BarTitle>Manage</BarTitle>}
      // the League (standings, the crew goal, Hall of Strength), the trophy it is on the clients' bar
      right={
        <BarButton label="League" onClick={() => void navigate({ to: "/admin/league" })} data-crew-league>
          <Trophy className="h-[23px] w-[23px]" strokeWidth={2} />
        </BarButton>
      }
    />
  ) : scope.kind === "you" && user?.id ? (
    <CrewBar
      label="Your profile"
     
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
     
      left={<BarBack label={`Back to ${TAB_LABEL[scope.from]}`} onClick={leaveAuthor} />}
      center={<ProfileBarTitle userId={scope.author.user_id} fallback={scope.author.name} />}
    />
  ) : scope.kind === "activity" ? (
    <CrewBar
      label="Activity"
     
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
    {ownBar && !crewBar && <div aria-hidden className="md:hidden" style={{ height: "var(--app-safe-top)" }} />}
    {/* a staff login that's also a client: its My Workouts / Staff switch, under Crew's bar instead of the shell's */}
    {ownBar && <DualAccountSwitcher />}
    <div
      ref={rootRef}
      className={cn(
        "mx-auto w-full max-w-[560px] [touch-action:pan-x_pan-y]",
        paging ? "" : "space-y-3 px-3 pb-12 sm:px-4",
        paging ? "" : ownBar ? "pt-1.5" : "pt-3",
      )}
    >
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

      {scope.kind === "manage" && coach ? (
        coach.manage
      ) : scope.kind === "rankings" ? (
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
      ) : ranked.isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-96 w-full rounded-3xl" />
          ))}
        </div>
      ) : notAllowed ? (
        <EmptyNote title="Community isn't available on this account" body="It's open to active coaching clients." />
      ) : ranked.isError ? (
        <div className="rounded-3xl border border-border/80 bg-card p-6 text-center text-sm">
          <p className="text-muted-foreground">Couldn't load the community.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void ranked.refetch()}>
            Try again
          </Button>
        </div>
      ) : rankedPosts.length === 0 && posts.length === 0 ? (
        <EmptyNote
          title="Be the first one in"
          body={canShare ? "Share a session from this month. Your crew sees the work, your coach sees it too." : "When clients share a workout, it shows up here."}
          action={canShare ? <ShareWorkoutButton unit={unit} label="Share your last workout" variant="block" previewOnly={previewOnly} /> : null}
        />
      ) : paging ? (
        <FeedPager
          firstScreen={firstScreen}
          rail={
            <StoryRail
              posts={posts}
              unit={unit}
              viewerIsStaff={viewerIsStaff}
              onOpenPost={(id) => setDetailId(id)}
              onOpenPerson={openAuthor}
              onJumpTo={setJumpTo}
              addStory={canShare ? (t) => <ShareWorkoutButton unit={unit} previewOnly={previewOnly} trigger={t} story /> : undefined}
              addYours={canShare ? <ShareWorkoutButton unit={unit} label="Add yours" variant="block" previewOnly={previewOnly} story /> : null}
              rankings={rankings}
            />
          }
          empty={
            following && feedPosts.length === 0 ? (
              <EmptyNote title="Nothing new from people you follow" body="Their posts land here. The whole crew is under All." action={<Button type="button" variant="outline" className="w-full" onClick={() => setOnly("all")}>Show all posts</Button>} />
            ) : null
          }
          pages={feedPosts.flatMap((p, i) => {
            const out: { key: string; post?: CommunityPost; node: ReactNode }[] = [];
            // what's new to you comes first, what you'd seen carries on after (Instagram's)
            if (i === caughtUp)
              out.push({
                key: "caught-up",
                node: (
                  <CaughtUpLine
                    more={previewOnly ? null : (
                      <button type="button" onClick={() => openDiscover("feed")} className="text-[13px] font-bold text-primary active:opacity-70" data-caught-up-discover>
                        Find people to follow
                      </button>
                    )}
                  />
                ),
              });
            out.push({
              key: p.id,
              post: p,
              node: (
                <PostRow
                  post={p}
                  thumbUrl={urls?.[p.media_thumb_path ?? (p.media_type === "image" ? p.media_path ?? "" : "")] ?? null}
                  unit={unit}
                  viewerIsStaff={viewerIsStaff}
                  onOpen={openPost}
                  onOpenComments={openCommentsSheet}
                  onOpenCaption={openCaptionSheet}
                  sheetOpen={sheet?.post.id === p.id}
                  onOpenAuthor={openAuthor}
                  doubleTapHint={p.id === hintId}
                  openHint={p.id === openHintId}
                  onDoubleTap={onDoubleTap}
                  onTipDone={onTipDone}
                  layout="page"
                  pageFirst={i === 0}
                />
              ),
            });
            // people to follow right after the first post (Instagram's spot), a screen of their own (never the coach's)
            if (!previewOnly && !following && !coach && i === 0)
              out.push({ key: "suggested", node: <SuggestedAthletes onOpen={openAuthor} strongOnly hideable onSeeAll={() => openDiscover("feed")} /> });
            if (canShare && !following && i === Math.min(1, feedPosts.length - 1))
              out.push({ key: "share-nudge", node: <ShareNudge surface="feed" unit={unit} /> });
            return out;
          })}
          flash={flash}
          sentinel={sentinel}
          loadingMore={isFetchingNextPage}
          end={
            !hasNextPage && feedPosts.length > 1 && caughtUp === null ? (
              <CaughtUp
                action={canShare ? <ShareWorkoutButton unit={unit} label="Share your session" previewOnly={previewOnly} /> : null}
                more={previewOnly ? null : (
                  <button type="button" onClick={() => openDiscover("feed")} className="text-[13px] font-bold text-primary active:opacity-70" data-caught-up-discover>
                    Find people to follow
                  </button>
                )}
              />
            ) : null
          }
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
            addStory={canShare ? (t) => <ShareWorkoutButton unit={unit} previewOnly={previewOnly} trigger={t} story /> : undefined}
            addYours={canShare ? <ShareWorkoutButton unit={unit} label="Add yours" variant="block" previewOnly={previewOnly} story /> : null}
            rankings={rankings}
          />
          {/* All / Following lives in the name at the top (its ⌄), Instagram's way: no second row of chips here */}
          {following && feedPosts.length === 0 && (
            <EmptyNote title="Nothing new from people you follow" body="Their posts land here. The whole crew is under All." action={<Button type="button" variant="outline" className="w-full" onClick={() => setOnly("all")}>Show all posts</Button>} />
          )}
          {feedPosts.map((p, i) => (
            <Fragment key={p.id}>
            {/* what's new to you is above, what you'd seen carries on below (Instagram's) */}
            {i === caughtUp && (
              <CaughtUpLine
                more={previewOnly ? null : (
                  <button type="button" onClick={() => openDiscover("feed")} className="text-[13px] font-bold text-primary active:opacity-70" data-caught-up-discover>
                    Find people to follow
                  </button>
                )}
              />
            )}
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
              onOpenReel={openReel}
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
          {/* more on the way (it reads well ahead, so this is rarely seen): Instagram's spinner at the end of the feed */}
          {isFetchingNextPage && (
            <div className="grid place-items-center py-6 text-muted-foreground" role="status" aria-label="Loading more posts" data-feed-more>
              <ActivitySpinner size={24} />
            </div>
          )}
          {!hasNextPage && feedPosts.length > 1 && caughtUp === null && (
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
      <ReelsViewer start={reel} posts={feedPosts} viewerIsStaff={viewerIsStaff} onClose={() => setReel(null)} onOpenComments={setCommentsFor} onOpenAuthor={openAuthor} />
      <CommentsSheet post={commentsFor} viewerIsStaff={viewerIsStaff} onClose={() => setCommentsFor(null)} onOpenAuthor={openAuthor} />
      {paging && <PostSheet post={sheetPost} at={sheet?.at ?? "caption"} viewerIsStaff={viewerIsStaff} onClose={() => setSheet(null)} onOpenAuthor={openAuthor} />}
      {/* answering a question response on your story (never while viewing as a client) */}
      {!previewOnly && <StoryReplyHost unit={unit} />}
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

/**
 * Crew's feed as screens, one post each, swiped one at a time (TikTok's).
 * The first screen is the story rail and the first post; every screen after
 * it is one post, or one of the feed's own moments (all caught up, people to
 * follow, an invite to share) when it has something to show (an empty one is
 * left out: `.feed-page:empty`).
 */
function FeedPager({
  firstScreen,
  rail,
  empty,
  pages,
  flash,
  sentinel,
  loadingMore,
  end,
}: {
  firstScreen: React.RefObject<HTMLDivElement | null>;
  rail: ReactNode;
  empty: ReactNode;
  pages: { key: string; post?: CommunityPost; node: ReactNode }[];
  flash: string | null;
  sentinel: React.RefObject<HTMLDivElement | null>;
  loadingMore: boolean;
  end: ReactNode;
}) {
  const screen = (pg: { key: string; post?: CommunityPost; node: ReactNode }, i: number) =>
    pg.post ? (
      <FeedItem
        key={pg.key}
        index={i}
        data-post-id={pg.post.id}
        data-feed-first-post={i === 0 ? "" : undefined}
        className={cn("feed-page transition-shadow duration-700", flash === pg.post.id && "ring-2 ring-inset ring-primary")}
      >
        {pg.node}
      </FeedItem>
    ) : (
      <div key={pg.key} className="feed-page flex flex-col justify-center overflow-y-auto px-3" style={SCREEN_ROOM} data-feed-moment={pg.key}>
        {pg.node}
      </div>
    );
  const pager = useRef<HTMLDivElement | null>(null);
  const fold = useRef<HTMLDivElement | null>(null);
  const firstKey = pages[0]?.post ? pages[0].key : null;
  useStoriesSwipe(pager, firstScreen, firstKey);
  useStoriesMotion(pager, firstScreen, fold, firstKey);
  return (
    // always dark, whatever the theme (TikTok's, Reels'): the posts are on black and Crew's bar floats over them
    <div ref={pager} className="dark bg-black text-foreground" data-feed-pager>
      {/* the stories on top of the first post, full size and running off the bottom (TikTok's Friends):
          a swipe or a tap brings the post up whole, and the very top brings the stories back */}
      <div ref={firstScreen} className="feed-first flex flex-col" data-feed-first>
        <div ref={fold} className="shrink-0 px-3 pb-2 pt-1.5 sm:px-4" data-stories-fold>{rail}</div>
        {empty && <div className="px-3 pt-3">{empty}</div>}
      </div>
      {pages.map((pg, i) => screen(pg, i))}
      {loadingMore && (
        <div className="feed-page grid place-items-center text-muted-foreground" role="status" aria-label="Loading more posts" data-feed-more>
          <ActivitySpinner size={28} />
        </div>
      )}
      {end && (
        <div className="feed-page flex flex-col justify-center" style={SCREEN_ROOM} data-feed-end>
          {end}
        </div>
      )}
      <div ref={sentinel} aria-hidden className="h-px" />
    </div>
  );
}

/**
 * From the top of the feed (the stories over the first post), a swipe up brings
 * the first post up whole, TikTok's Friends: the stories are shorter than a
 * swipe, so the window's own snapping would carry a normal swipe past the
 * first post onto the second. Only that one swipe is taken over (on the
 * stories and the first post, while the stories show); a pull down still
 * refreshes, a sideways swipe still scrolls the stories, a tap still taps.
 */
function useStoriesSwipe(pager: React.RefObject<HTMLDivElement | null>, rail: React.RefObject<HTMLDivElement | null>, firstKey: string | null) {
  useEffect(() => {
    const top = rail.current;
    const first = pager.current?.querySelector<HTMLElement>("[data-feed-first-post]");
    if (!top || !first || !firstKey) return;
    const target = () => firstPostUp(first);
    let x0 = 0;
    let y0 = 0;
    let y = 0;
    let state: "off" | "maybe" | "mine" = "off";
    const start = (e: TouchEvent) => {
      state = "off";
      if (e.touches.length !== 1 || window.scrollY >= target() - 1) return;
      x0 = e.touches[0].clientX;
      y0 = y = e.touches[0].clientY;
      state = "maybe";
    };
    const move = (e: TouchEvent) => {
      if (state === "off") return;
      const dx = e.touches[0].clientX - x0;
      y = e.touches[0].clientY;
      const dy = y - y0;
      if (state === "maybe") {
        if (dx === 0 && dy === 0) return;
        // a pull down refreshes, a sideways swipe scrolls the stories: theirs
        if (dy > 0 || Math.abs(dx) > Math.abs(dy)) {
          state = "off";
          return;
        }
        state = "mine";
      }
      if (e.cancelable) e.preventDefault();
    };
    const end = () => {
      // a tap that moved a hair is still a tap (the post's own tap brings it up too)
      if (state === "mine" && y0 - y >= 10) {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: target(), behavior: reduce ? "auto" : "smooth" });
      }
      state = "off";
    };
    const cancel = () => {
      state = "off";
    };
    const els = [top, first];
    for (const el of els) {
      el.addEventListener("touchstart", start, { passive: true });
      el.addEventListener("touchmove", move, { passive: false });
      el.addEventListener("touchend", end);
      el.addEventListener("touchcancel", cancel);
    }
    return () => {
      for (const el of els) {
        el.removeEventListener("touchstart", start);
        el.removeEventListener("touchmove", move);
        el.removeEventListener("touchend", end);
        el.removeEventListener("touchcancel", cancel);
      }
    };
  }, [pager, rail, firstKey]);
}

/**
 * Where the window is when the first post is up whole: its top under the
 * status bar, Crew's bar over it (its own snap point). Read from where it's
 * laid out, not where it's drawn: a post easing in is still nudged down.
 */
function firstPostUp(first: HTMLElement): number {
  const css = getComputedStyle(first);
  const nudge = css.transform && css.transform !== "none" ? new DOMMatrixReadOnly(css.transform).m42 : 0;
  return Math.round(first.getBoundingClientRect().top - nudge + window.scrollY - (parseFloat(css.scrollMarginTop) || 0));
}

/**
 * The stories fold away as the first post comes up, and back in on the way
 * down, tied to the scroll so they move exactly with the finger (TikTok's
 * Friends): the row sinks a little slower than the page so the post slides up
 * over it, each bubble shrinks up toward the bar and fades, right to left (so
 * they come back left to right, the way you read them), and the first post's
 * rounded top squares off as it fills the screen. Only styles, written once a
 * frame while the top of the feed is moving; reduced motion keeps the fade.
 */
function useStoriesMotion(
  pager: React.RefObject<HTMLDivElement | null>,
  rail: React.RefObject<HTMLDivElement | null>,
  fold: React.RefObject<HTMLDivElement | null>,
  firstKey: string | null,
) {
  useEffect(() => {
    const top = rail.current;
    const row = fold.current;
    const first = pager.current?.querySelector<HTMLElement>("[data-feed-first-post]");
    const card = first?.querySelector<HTMLElement>("[data-feed-post]") ?? null;
    if (!top || !row || !first || !firstKey) return;
    const reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let end = 1;
    let bubbles: { el: HTMLElement; across: number }[] = [];
    let dirty = true;
    let last = -1;
    let frame = 0;
    const clear = (els: HTMLElement[]) => {
      for (const el of els) {
        el.style.opacity = "";
        el.style.transform = "";
        el.style.transformOrigin = "";
      }
    };
    // where the post comes up, and where each bubble sits across the row (read only when something moved)
    const measure = () => {
      end = Math.max(1, firstPostUp(first));
      const strip = row.querySelector<HTMLElement>("[data-story-rail]");
      const box = strip?.getBoundingClientRect();
      const els = strip ? Array.from(strip.children as HTMLCollectionOf<HTMLElement>) : [];
      clear(bubbles.map((b) => b.el).filter((el) => !els.includes(el)));
      bubbles = els.map((el) => {
        const r = el.getBoundingClientRect();
        return { el, across: box && box.width > 0 ? (r.left + r.width / 2 - box.left) / box.width : 0 };
      });
    };
    const apply = () => {
      frame = 0;
      if (dirty) {
        dirty = false;
        measure();
        last = -1;
      }
      const p = storiesProgress(window.scrollY, end);
      if (p === last) return;
      last = p;
      // the row sinks at 40% of the page's speed, so the post rises over it
      row.style.transform = p <= 0 || reduce ? "" : `translate3d(0, ${(p * end * 0.4).toFixed(1)}px, 0)`;
      for (const b of bubbles) {
        const q = ease(bubbleFold(p, b.across));
        b.el.style.opacity = q > 0 ? (1 - q).toFixed(3) : "";
        b.el.style.transform = q > 0 && !reduce ? `translate3d(0, ${(-10 * q).toFixed(1)}px, 0) scale(${(1 - 0.22 * q).toFixed(3)})` : "";
        b.el.style.transformOrigin = q > 0 ? "50% 0%" : "";
      }
      if (card) {
        const r = `${(FIRST_POST_RADIUS * (1 - ease(p))).toFixed(1)}px`;
        card.style.borderTopLeftRadius = r;
        card.style.borderTopRightRadius = r;
      }
      // under the stories its picture sits right under them, not a bar's height lower (that room is the
      // bar's once it's up), so a picture shown whole shows whole above the tab bar; it eases down to its
      // place as the post comes up (styles.css, --first-under: 1 under the stories, 0 up)
      const u = reduce ? 0 : 1 - ease(p);
      if (u > 0) {
        first.style.setProperty("--first-under", u.toFixed(3));
        first.setAttribute("data-first-under", "");
      } else {
        first.style.removeProperty("--first-under");
        first.removeAttribute("data-first-under");
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onScroll = () => {
      // further down the feed with the stories already folded: nothing to do
      if (last === 1 && window.scrollY >= end) return;
      schedule();
    };
    const remeasure = () => {
      dirty = true;
      schedule();
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", remeasure);
    // the stories arriving (or one more) change the row and where the post comes up; a sideways scroll moves the wave
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(remeasure) : null;
    ro?.observe(top);
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(remeasure) : null;
    mo?.observe(row, { childList: true, subtree: true });
    row.addEventListener("scroll", remeasure, { passive: true, capture: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);
      row.removeEventListener("scroll", remeasure, { capture: true });
      ro?.disconnect();
      mo?.disconnect();
      row.style.transform = "";
      clear(bubbles.map((b) => b.el));
      if (card) {
        card.style.borderTopLeftRadius = "";
        card.style.borderTopRightRadius = "";
      }
      first.style.removeProperty("--first-under");
      first.removeAttribute("data-first-under");
    };
  }, [pager, rail, fold, firstKey]);
}

/** A feed moment's screen (all caught up, people to follow…): clear of Crew's bar above and the tab bar below. */
const SCREEN_ROOM = { paddingTop: "var(--feed-bar-room)", paddingBottom: "var(--bottom-nav-clearance)" } as const;

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
  onOpenReel?: (p: CommunityPost, path: string) => void;
  layout?: "card" | "page";
  onOpenCaption?: (p: CommunityPost) => void;
  sheetOpen?: boolean;
  pageFirst?: boolean;
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
