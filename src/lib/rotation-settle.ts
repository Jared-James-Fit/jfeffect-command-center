/**
 * Reading the screen's size around a turn of the phone (portrait-only.ts).
 *
 * iOS can't hold a home-screen web app upright (no manifest `orientation`, no
 * `screen.orientation.lock`), so the page turns with the phone. And while it
 * turns, WebKit reports sizes out of step: the window already has its new
 * width and still its old height (`innerHeight`, `visualViewport.height`) for
 * a moment, and the turn itself can take half a second or more (WebKit
 * 322083: a home-screen app's layout left out of sync after a rotation). Every
 * size the app measures once and keeps (`--app-vh`, Crew's `--feed-vh`, the
 * keyboard detector's no-keyboard height) used to read it on the turn's first
 * resize and keep the stale number: turned back upright, the tab bar vanished
 * (a 393pt reading against an 852pt one looked like an open keyboard) and
 * Crew's posts were half the screen until the app was closed.
 *
 * So a size kept across a turn is read again as the turn settles
 * (ROTATION_SETTLE_MS, `onRotationSettle`), and a reading the screen couldn't
 * hold (a window bigger than the screen: the new width with the old height)
 * is never kept (`plausibleViewport`).
 */

/** When a kept size is read again after a turn starts (ms): at once, then as iOS settles (it can take 500ms+). */
export const ROTATION_SETTLE_MS = [0, 120, 300, 600, 1000, 1600, 2500] as const;

/** Slack on the screen's area: rounding, and a browser that counts a pixel more. */
export const VIEWPORT_AREA_SLACK = 1.02;

/**
 * Whether a window `w` × `h` could be on this screen. The visible area is
 * never more than the screen's (`screen.width` × `screen.height`, the same
 * area upright or sideways on every phone); a reading mid-turn, the new width
 * with the old height (852 × 852 on a 393 × 852 iPhone), is. Without the
 * screen's size there's nothing to check against, so it passes.
 */
export function plausibleViewport(w: number, h: number, screenW: number, screenH: number): boolean {
  if (!(w > 0) || !(h > 0)) return false;
  if (!(screenW > 0) || !(screenH > 0)) return true;
  return w * h <= screenW * screenH * VIEWPORT_AREA_SLACK;
}

/** This window, on this screen, now. */
export function viewportPlausibleNow(
  h: number = typeof window !== "undefined" ? window.innerHeight : 0,
): boolean {
  if (typeof window === "undefined") return false;
  const s = typeof screen !== "undefined" ? screen : undefined;
  return plausibleViewport(window.innerWidth, h, s?.width ?? 0, s?.height ?? 0);
}

/** A text box has the keyboard up: what the window measures then is the keyboard's doing, not the turn's. */
export function typingNow(): boolean {
  if (typeof document === "undefined") return false;
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
}

/**
 * Calls `read` as every turn settles: on `orientationchange`, the screen's own
 * orientation `change`, a resize that changes the window's width (a keyboard
 * or a toolbar never does), and coming back to the app turned another way;
 * each time at once and again at ROTATION_SETTLE_MS (a new turn starts the
 * timers over). `read` gets which reading of the turn it is: 0 is the first,
 * taken before anything has been re-measured, so it can note where things
 * were. Returns a cleanup.
 */
export function onRotationSettle(read: (step: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  let width = window.innerWidth;
  let timers: number[] = [];
  const start = () => {
    width = window.innerWidth;
    timers.forEach((t) => window.clearTimeout(t));
    timers = ROTATION_SETTLE_MS.map((ms, i) => window.setTimeout(() => read(i), ms));
  };
  const onResize = () => {
    if (window.innerWidth !== width) start();
  };
  const onShow = () => {
    if (document.visibilityState === "visible" && window.innerWidth !== width) start();
  };
  const o = typeof screen !== "undefined" ? screen.orientation : undefined;
  window.addEventListener("orientationchange", start);
  o?.addEventListener?.("change", start);
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onShow);
  return () => {
    timers.forEach((t) => window.clearTimeout(t));
    window.removeEventListener("orientationchange", start);
    o?.removeEventListener?.("change", start);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onShow);
  };
}

/**
 * The tallest a window has been at each width: the no-keyboard height a
 * keyboard is measured against. One per width (turning the phone changes the
 * width, a keyboard never does), and only from readings the screen could hold,
 * so a turn's stale height (852 at the landscape width) never becomes the
 * landscape baseline and reads as a 459pt keyboard for as long as the phone
 * stays on its side.
 */
export function tallestPerWidth() {
  const tallest = new Map<number, number>();
  return {
    /** Takes a reading (when it's plausible) and returns the tallest at that width, this reading included. */
    see(w: number, h: number, screenW: number, screenH: number): number {
      const key = Math.round(w);
      const known = tallest.get(key);
      if (!plausibleViewport(w, h, screenW, screenH)) return known ?? h;
      const next = Math.max(known ?? h, h);
      tallest.set(key, next);
      return next;
    },
  };
}
