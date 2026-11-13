import { useSyncExternalStore } from "react";

/**
 * Whether Crew's feed is paging right now (one post per screen, TikTok's):
 * `html.feed-paging` for the CSS (the window snaps, the page is black), and a
 * tiny store so the tab bar can go dark over the posts like TikTok's.
 */
let on = false;
const subs = new Set<() => void>();
/** The bar above the page while the feed is up: black, like the feed (the colour before it comes back after). */
const FEED_THEME_COLOR = "#000000";
let themeColorBefore: string | null = null;

export function setFeedPaging(next: boolean) {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("feed-paging", next);
  if (on === next) return;
  on = next;
  paintThemeColor(next);
  subs.forEach((f) => f());
}

/** The iPhone home-screen app's solid status bar (and Android's) is black over the feed, the page's own colour elsewhere. */
function paintThemeColor(feed: boolean) {
  if (typeof document === "undefined") return;
  const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
  if (feed) {
    themeColorBefore = metas[0]?.getAttribute("content") ?? null;
    metas.forEach((m) => m.setAttribute("content", FEED_THEME_COLOR));
  } else if (themeColorBefore) {
    const before = themeColorBefore;
    themeColorBefore = null;
    metas.forEach((m) => {
      // a theme switched while the feed was up has already written its own colour
      if (m.getAttribute("content") === FEED_THEME_COLOR) m.setAttribute("content", before);
    });
  }
}

export function useFeedPaging(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => on,
    () => false,
  );
}

/**
 * The height a feed screen is sized from (`--feed-vh`): the window's own,
 * measured, never `100svh`, which on the iPhone home-screen app came out ~75pt
 * short of the screen (each post stopped well above the tab bar with the next
 * one showing under it). Read again only when the width changes (a rotation):
 * a browser toolbar or the keyboard changing the height must never resize
 * the screens under the finger.
 *
 * And how far the real screen runs past it (`--feed-gap`): on the iPhone
 * home-screen app (iOS 26) the window reports itself the notch's height
 * (59pt) shorter than the screen while the tab bar sits at the screen's real
 * bottom, so a post sized from the window stopped 59pt above the tab bar with
 * black under it. The screen is what a fixed box from top to bottom measures
 * (the tab bar is one), and a post's bottom, words and buttons move down by
 * the difference; the pages themselves keep the window's height, so each
 * swipe still lands exactly on the next post.
 */
export function watchFeedViewport(): () => void {
  const root = document.documentElement;
  let width = window.innerWidth;
  const set = () => {
    const vh = Math.round(window.innerHeight);
    root.style.setProperty("--feed-vh", `${vh}px`);
    root.style.setProperty("--feed-gap", `${feedGap(fixedScreenHeight(), vh)}px`);
  };
  set();
  const onResize = () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    set();
  };
  window.addEventListener("resize", onResize);
  return () => {
    window.removeEventListener("resize", onResize);
    root.style.removeProperty("--feed-vh");
    root.style.removeProperty("--feed-gap");
  };
}

/** The most the screen is believed to run past the window (anything more is a bad reading, ignored). */
export const FEED_GAP_MAX = 120;

/** How far the screen (`screenH`, where fixed bars sit) runs past the window (`windowH`): 0 unless it really does. */
export function feedGap(screenH: number, windowH: number): number {
  const gap = Math.round(screenH - windowH);
  return gap > 0 && gap <= FEED_GAP_MAX ? gap : 0;
}

/** The height of a fixed box from the top to the bottom: where the tab bar and Crew's bar really sit. */
function fixedScreenHeight(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;bottom:0;left:0;width:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

/** How far the stories have folded away: 0 at the very top, 1 once the first post is up whole. */
export function storiesProgress(scrollY: number, end: number): number {
  if (!(end > 0)) return scrollY > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, scrollY / end));
}

/** How long one bubble takes to fold, as a share of the swipe; the rest is the wave across the row. */
export const BUBBLE_FOLD_SPAN = 0.4;
/** The wave: the bubble on the right starts folding at once, the one on the left this much later. */
export const BUBBLE_WAVE = 0.25;

/**
 * One story bubble's own fold (0 shown, 1 gone) for the swipe's progress `p`,
 * from where it sits across the row (`across`: 0 left edge … 1 right edge).
 * They fold away right to left, so coming back the left ones are first,
 * the way you read them. Reversible: the same p is always the same look.
 */
export function bubbleFold(p: number, across: number): number {
  const start = (1 - Math.min(1, Math.max(0, across))) * BUBBLE_WAVE;
  return Math.min(1, Math.max(0, (p - start) / BUBBLE_FOLD_SPAN));
}

/** Smooth in and out, so a fold never starts or stops with a jolt. */
export function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The first post's top corners, rounded like a card under the stories, square once it's up. */
export const FIRST_POST_RADIUS = 18;
