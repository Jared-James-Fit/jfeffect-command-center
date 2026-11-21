/**
 * Where you were on each tab (Instagram's / TikTok's): switch from Home to
 * Workouts and back and Home is where you left it, not back at its top.
 *
 * Only a tab's own page counts (the bar's `to`, no #view): a page under a tab
 * (a workout, a client) is history's to restore (Back), and an address with a
 * hash (Crew's #rankings / #you) is a view of its own. On Crew only the feed
 * counts (`html.feed-paging`, the feed on screen), never a profile or Activity
 * opened on top of it at the same address. A place is kept for the visit
 * (RESUME_NEW_VISIT_MS, when the Crew feed starts over with what's new) and
 * only in memory, so a launch always opens at the top of Crew.
 *
 * A tap on the tab you're on still goes to the top (the shell's retap).
 */
import { useCallback, useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { RESUME_NEW_VISIT_MS } from "@/lib/feed-anchor";

/** A place this close to the top is the top. */
export const TAB_PLACE_MIN_PX = 4;
/** How long a place is kept: a visit's worth. */
export const TAB_PLACE_TTL_MS = RESUME_NEW_VISIT_MS;
/**
 * How long after arriving a place may still be put back. A page that comes
 * from the cache is tall enough in a frame or two; one still loading past this
 * stays at its top rather than jumping down under a reading eye.
 */
export const TAB_PLACE_RESTORE_MS = 450;

const CREW_PAGES = new Set(["/portal/community", "/admin/community"]);

type Place = { y: number; at: number };
const places = new Map<string, Place>();

/** This page's place can be kept: a tab's own page, no #view, and on Crew the feed itself. */
export function placeKeepable(pathname: string, hash: string, tabs: ReadonlySet<string>, feedOnScreen: boolean): boolean {
  if (!tabs.has(pathname) || (hash && hash !== "#")) return false;
  if (CREW_PAGES.has(pathname)) return feedOnScreen;
  return true;
}

export function keepPlace(pathname: string, y: number, now = Date.now()): void {
  places.set(pathname, { y: Math.max(0, Math.round(y)), at: now });
}

/** Where to put this tab back, or null: nothing kept, at the top, or from an earlier visit. */
export function placeFor(pathname: string, now = Date.now()): number | null {
  const p = places.get(pathname);
  if (!p || now - p.at > TAB_PLACE_TTL_MS || p.y < TAB_PLACE_MIN_PX) return null;
  return p.y;
}

export function forgetPlaces(): void {
  places.clear();
}

function feedOnScreen(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("feed-paging");
}

/** Keeps the page's place as it is now, if it's one to keep. */
export function keepPlaceNow(pathname: string, hash: string, tabs: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  if (placeKeepable(pathname, hash, tabs, feedOnScreen())) keepPlace(pathname, window.scrollY);
}

/**
 * Keeps the place of the tab on screen as it's read, once a scroll settles (the
 * Crew feed's own way: a profile opened on top scrolls to 0 first and then
 * isn't the feed by the time it settles).
 */
export function watchPlace(pathname: string, hash: string, tabs: ReadonlySet<string>): () => void {
  if (typeof window === "undefined" || !tabs.has(pathname)) return () => {};
  let settle = 0;
  const onScroll = () => {
    window.clearTimeout(settle);
    settle = window.setTimeout(() => keepPlaceNow(pathname, hash, tabs), 150);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    window.clearTimeout(settle);
    window.removeEventListener("scroll", onScroll);
  };
}

/**
 * Puts a tab back at `y` once its page is tall enough, within
 * TAB_PLACE_RESTORE_MS of arriving; a touch, wheel or key meanwhile stops it
 * (the person is already moving), and so does a page that never gets that tall.
 * The router puts a new page at its top first, so the place is checked again
 * for a couple of frames after it's set.
 */
export function restorePlace(y: number, { maxMs = TAB_PLACE_RESTORE_MS }: { maxMs?: number } = {}): () => void {
  if (typeof window === "undefined") return () => {};
  const start = performance.now();
  let raf = 0;
  let held = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    window.cancelAnimationFrame(raf);
    window.removeEventListener("touchstart", stop, true);
    window.removeEventListener("wheel", stop, true);
    window.removeEventListener("keydown", stop, true);
  };
  window.addEventListener("touchstart", stop, { capture: true, passive: true });
  window.addEventListener("wheel", stop, { capture: true, passive: true });
  window.addEventListener("keydown", stop, true);
  const step = () => {
    if (stopped) return;
    const root = document.scrollingElement ?? document.documentElement;
    const room = root.scrollHeight - window.innerHeight;
    // never more than a moment: whatever happens, the page is the person's again
    if (performance.now() - start > maxMs * 2) return stop();
    if (Math.abs(window.scrollY - y) <= 1) {
      if (++held >= 3) return stop();
    } else {
      held = 0;
      if (room >= y - 1) window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
      else if (performance.now() - start > maxMs) return stop();
    }
    raf = window.requestAnimationFrame(step);
  };
  raf = window.requestAnimationFrame(step);
  return stop;
}

/**
 * The shell's side of it: keeps the tab on screen's place as it's read and
 * puts a tab back where it was when the bar brings you to it. Reads the page
 * that's actually on screen (`resolvedLocation`), never one still loading, so
 * a tab whose page is on its way never scrolls the page it's leaving. Returns
 * the bar's tap: call it before the bar navigates.
 */
export function useTabPlaces(tabs: ReadonlySet<string>): (to: string) => void {
  const pathname = useRouterState({ select: (r) => (r.resolvedLocation ?? r.location).pathname });
  const hash = useRouterState({ select: (r) => (r.resolvedLocation ?? r.location).hash });
  const pending = useRef<string | null>(null);
  useEffect(() => watchPlace(pathname, hash, tabs), [pathname, hash, tabs]);
  useEffect(() => {
    const to = pending.current;
    pending.current = null;
    if (to !== pathname || (hash && hash !== "#")) return;
    const y = placeFor(pathname);
    return y == null ? undefined : restorePlace(y);
  }, [pathname, hash]);
  return useCallback(
    (to: string) => {
      const dest = to.split(/[?#]/)[0];
      // the tab you're on: the retap's (back to the top), not a place to put back
      if (dest === pathname) return;
      keepPlaceNow(pathname, hash, tabs);
      pending.current = dest;
    },
    [pathname, hash, tabs],
  );
}
