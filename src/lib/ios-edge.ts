/**
 * The iPhone home-screen app (Safari's "Add to Home Screen", `navigator.standalone`).
 *
 * Its status bar is solid (`apple-mobile-web-app-status-bar-style` "default",
 * __root.tsx): the app starts right under the clock, with nothing drawn under
 * the status bar, so there's nothing for iOS to blur and no gap above the bars,
 * the way a native app sits. The bar takes the page's own colour (`theme-color`,
 * THEME_COLOR in theme.ts; black over Crew's paged feed).
 *
 * iOS reads that setting only when the app is added to the Home Screen, so an
 * app added before it still draws under a transparent status bar
 * ("black-translucent"), and from iOS 26.1 iOS lays its own blur from the notch
 * down to about 40pt under it over whatever is there, fixed opaque bars included
 * (measured on the coach's iPhone: the bar's logo and icons at 72–96pt read
 * blurred, everything from ~100pt sharp). There, and only there (the page is
 * under the clock: env(safe-area-inset-top) > 0), every top bar starts
 * IOS_EDGE_ROOM lower (`--ios-edge-room`, added into `--app-safe-top` and
 * `--focus-top`), and the blurred band only ever holds the background. Deleting
 * the app and adding it again from Safari gives it the solid status bar. The
 * native app turns the effect off itself (ios-build.yml), and other browsers
 * don't draw it.
 *
 * Marked before the first paint (an inline <head> script), so nothing moves. It
 * also measures the window's height (`--app-vh`): with a solid status bar iOS's
 * 100vh counts the status bar too (WebKit 316008), which would leave every page
 * scrollable by that much.
 */
export const IOS_EDGE_ROOM = "28px";

export const IOS_WEB_APP_BOOT_SCRIPT =
  '(function(){try{if(window.navigator.standalone===true){var r=document.documentElement;r.setAttribute("data-ios-web-app","");var w=window.innerWidth,s=function(){r.style.setProperty("--app-vh",window.innerHeight+"px")};s();window.addEventListener("resize",function(){if(window.innerWidth!==w){w=window.innerWidth;s()}})}}catch(e){}})();';

/**
 * The bottom, on the same old installs: iOS sometimes lays the page's fixed
 * things out a status bar short of the screen (the coach's iPhone, Nov 2026:
 * the fixed area ended at 793pt of an 852pt screen), so everything pinned to
 * the bottom (the tab bar, sheets, the studio's buttons) rode 59pt up with a
 * band of page background under it. The web view still covers the whole
 * screen (that band is the page's own colour, painted by the web view), so the
 * gap is read here and what's pinned to the bottom goes back down by it
 * (`--ios-bottom-gap` + `data-ios-bottom-gap` on <html>, styles.css), and the
 * tab bar's room (`--mobile-bar-top`) shrinks by the same, so pages, the chats
 * and Crew's posts still end right at the bar. iOS flips between that and the
 * normal layout on its own (at a launch, coming back to the app), so a
 * persistent fixed probe is watched and the gap follows at once. Never with a
 * solid status bar (the page starts under the clock and its bottom is the
 * screen's), in another browser, on a tablet, on its side, or by more than
 * about the status bar's height.
 */
export type BottomGapReading = {
  /** `navigator.standalone`: the iPhone home-screen app. */
  standalone: boolean;
  /** env(safe-area-inset-top): more than 0 only under a transparent status bar. */
  topInset: number;
  /** `screen.width` / `screen.height`: the phone's portrait size. */
  screenW: number;
  screenH: number;
  windowW: number;
  /** Where a fixed box from top to bottom ends: where `bottom: 0` really sits. */
  fixedH: number;
};

/** A reading a few points off the status bar's height is still it. */
export const IOS_GAP_SLACK = 8;
/** Phones only (a tablet's layouts change at 640px). */
const PHONE_MAX_W = 640;

/** How far the real screen runs past where fixed things end (px): 0 unless iOS laid them out short. */
export function iosBottomGap(r: BottomGapReading): number {
  if (!r.standalone || !(r.topInset > 0) || !(r.screenW > 0) || r.screenW >= PHONE_MAX_W) return 0;
  // on its side: screen.width / height stay the portrait size, the window doesn't
  if (r.windowW > r.screenW + 1) return 0;
  const gap = Math.round(r.screenH - r.fixedH);
  return gap > 0 && gap <= r.topInset + IOS_GAP_SLACK ? gap : 0;
}

/** When the gap is read again after a launch (ms), besides every change the probe sees. */
export const IOS_GAP_SETTLE_MS = [0, 250, 1000, 3000] as const;

export function watchIosBottomGap(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};
  const root = document.documentElement;
  if (!root.hasAttribute("data-ios-web-app")) return () => {};
  // a fixed box from top to bottom (where `bottom: 0` lands), padded by the top inset so one probe reads both
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;top:0;bottom:0;left:0;width:0;padding-top:env(safe-area-inset-top);visibility:hidden;pointer-events:none;z-index:-1";
  document.body.appendChild(probe);
  let last = -1;
  const measure = () => {
    const gap = iosBottomGap({
      standalone: true,
      topInset: parseFloat(getComputedStyle(probe).paddingTop) || 0,
      screenW: window.screen?.width ?? 0,
      screenH: window.screen?.height ?? 0,
      windowW: window.innerWidth,
      fixedH: probe.getBoundingClientRect().height,
    });
    if (gap === last) return;
    last = gap;
    if (gap > 0) {
      root.style.setProperty("--ios-bottom-gap", `${gap}px`);
      root.setAttribute("data-ios-bottom-gap", "");
    } else {
      root.style.removeProperty("--ios-bottom-gap");
      root.removeAttribute("data-ios-bottom-gap");
    }
  };
  measure();
  const timers = IOS_GAP_SETTLE_MS.map((ms) => window.setTimeout(measure, ms));
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
  ro?.observe(probe);
  const onShow = () => {
    if (document.visibilityState !== "visible") return;
    measure();
    window.setTimeout(measure, 400);
  };
  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", measure);
  window.addEventListener("pageshow", measure);
  document.addEventListener("visibilitychange", onShow);
  return () => {
    timers.forEach((t) => window.clearTimeout(t));
    ro?.disconnect();
    window.removeEventListener("resize", measure);
    window.removeEventListener("orientationchange", measure);
    window.removeEventListener("pageshow", measure);
    document.removeEventListener("visibilitychange", onShow);
    probe.remove();
    root.style.removeProperty("--ios-bottom-gap");
    root.removeAttribute("data-ios-bottom-gap");
  };
}

