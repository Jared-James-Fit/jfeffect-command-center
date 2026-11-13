import { useSyncExternalStore } from "react";

/**
 * Whether Crew's feed is paging right now (one post per screen, TikTok's):
 * `html.feed-paging` for the CSS (the window snaps, the page is black), and a
 * tiny store so the tab bar can go dark over the posts like TikTok's.
 */
let on = false;
const subs = new Set<() => void>();

export function setFeedPaging(next: boolean) {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("feed-paging", next);
  if (on === next) return;
  on = next;
  subs.forEach((f) => f());
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
 */
export function watchFeedViewport(): () => void {
  const root = document.documentElement;
  let width = window.innerWidth;
  const set = () => root.style.setProperty("--feed-vh", `${Math.round(window.innerHeight)}px`);
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
  };
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
