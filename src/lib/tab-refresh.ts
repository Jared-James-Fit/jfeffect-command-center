/**
 * Instagram's tab behaviour for the bottom bar: tapping the tab you're on
 * takes the page back to the top and refreshes it, and pulling down at the
 * top of a tab's page refreshes it too, with a spinner while it loads.
 *
 * A refresh reloads only what's on screen (React Query's active queries) and,
 * from a tap, only what's at least RECENT_MS old, so tapping twice in a row
 * never loads anything twice. A pull is an explicit "load it now" and takes
 * anything older than a couple of seconds.
 */

/** A tap refreshes what's on screen once it's this old. */
export const RECENT_MS = 10_000;
/** A pull refreshes everything on screen except what just loaded. */
export const PULL_RECENT_MS = 2_000;
/** How far to pull (px of finger travel past the start slop) before letting go refreshes. */
export const PULL_TRIGGER = 72;
/** The spinner stays at least this long once it shows, so it never blinks. */
export const MIN_SPIN_MS = 550;
/** Asks the page's refresher (TabRefresh) to refresh: the bar fires it on a re-tap. */
export const TAB_REFRESH_EVENT = "app:tab-refresh";

type QueryLike = { dataUpdatedAt: number; fetchStatus: string; status: string };

/** Whether a refresh should load this query again (already loading counts, so the spinner waits for it). */
export function needsRefresh(q: QueryLike, now: number, recentMs = RECENT_MS): boolean {
  if (q.fetchStatus === "fetching") return true;
  // never loaded yet: the page is showing its own loading state for it
  if (q.status === "pending" || !q.dataUpdatedAt) return false;
  return now - q.dataUpdatedAt >= recentMs;
}

/** 0 → 1 as the finger travels to PULL_TRIGGER. */
export function pullProgress(travel: number): number {
  if (!(travel > 0)) return 0;
  return Math.min(1, travel / PULL_TRIGGER);
}

/** The thing the page scrolls in under the middle of the screen: the window, or a list with its own scroll (Messages). */
export function pageScroller(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) as HTMLElement | null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.closest('[role="dialog"],[role="alertdialog"]')) return null;
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return null;
}

/** Back to the top: the page and, if the screen's main list scrolls on its own, that too. */
export function scrollPageToTop(behavior: ScrollBehavior = "smooth") {
  try {
    window.scrollTo({ top: 0, behavior });
    const inner = pageScroller();
    if (inner && inner.scrollTop > 0) inner.scrollTo({ top: 0, behavior });
  } catch {
    /* no window */
  }
}

/**
 * A pull may start here: the page is at its top, nothing is open over it,
 * and the finger isn't on a field or inside something scrolled down on its own.
 */
export function canStartPull(target: EventTarget | null): boolean {
  if (typeof document === "undefined" || window.scrollY > 0) return false;
  if (document.querySelector('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]')) return false;
  const el = target instanceof Element ? target : null;
  if (!el) return true;
  if (el.closest('[role="dialog"],[role="alertdialog"],[data-no-pull-refresh],input,textarea,select,[contenteditable="true"]')) return false;
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollTop > 0) return false;
  }
  return true;
}

/** Ask the current page to refresh (the bar's re-tap). */
export function requestTabRefresh() {
  try {
    window.dispatchEvent(new CustomEvent(TAB_REFRESH_EVENT));
  } catch {
    /* no window */
  }
}

/**
 * Pages under a tab where tapping that tab goes back to the top first and only
 * the next tap goes to the tab itself: the workout logger, so a long workout
 * is one tap from its top and two from the Workouts list.
 */
export function topFirstPage(pathname: string): boolean {
  return /^\/portal\/workouts\/[^/]+\/?$/.test(pathname);
}
/** A second tap this soon after the first goes to the tab even mid-scroll (a double tap). */
export const TOP_FIRST_DOUBLE_TAP_MS = 1200;
/** Scrolled at least this far counts as "not at the top". */
const TOP_SLACK_PX = 40;

/** On a top-first page: this tap scrolls up ("top") or goes to the tab ("tab"). */
export function topFirstTap(scrolledPx: number, msSinceLastTop: number): "top" | "tab" {
  return scrolledPx > TOP_SLACK_PX && msSinceLastTop > TOP_FIRST_DOUBLE_TAP_MS ? "top" : "tab";
}

/** How far the page (or the list under the screen's middle that scrolls on its own) is from its top. */
export function pageScrolledPx(): number {
  if (typeof window === "undefined") return 0;
  return Math.max(window.scrollY || 0, pageScroller()?.scrollTop ?? 0);
}
