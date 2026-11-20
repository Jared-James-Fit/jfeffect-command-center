/**
 * JF Effect is a portrait app on phones (Instagram's, TikTok's), and turning
 * the phone never interrupts anything: nothing covers the screen, nothing
 * reloads or remounts.
 *
 * Where the platform can hold a phone upright, it does:
 *   - the installed iPhone app: Info.plist, portrait only (ios-build.yml);
 *   - the installed Android app: MainActivity's screenOrientation (android-build.yml);
 *   - Android's home-screen (installed) web app: the manifest's `orientation`,
 *     and `screen.orientation.lock` (lockPortrait) on launch and on coming back.
 * Where it can't (Safari, the iPhone home-screen web app, which support
 * neither the manifest's orientation nor the lock; an Android browser tab,
 * where Chrome only locks in fullscreen), the page turns with the phone and a
 * phone keeps the phone layout (the same bars, sheets and menus, just wider
 * and shorter): `data-phone` on <html> (PHONE_BOOT_SCRIPT, before the first
 * paint) stops Tailwind's `md:` from switching a phone to the tablet / desktop
 * layout (styles.css `@custom-variant md` / `max-md`), and `phoneLayoutNow()`
 * does the same for the screens that choose in JS (useIsMobile), so turning
 * the phone mid-workout or mid-form changes nothing but the width.
 * Tablets and computers turn freely.
 */

/** A phone's short side is under this (an iPad mini's is 744). */
export const PHONE_SHORT_SIDE_MAX = 600;

/** On <html> while this device is a phone: the phone layout in every orientation. */
export const PHONE_ATTR = "data-phone";

/** Where the phone layout starts on anything that isn't a phone (Tailwind's md, 48rem). */
export const NARROW_QUERY = "(max-width: 767px)";

/** Fired on window when `data-phone` changes (a foldable opened or closed). */
export const PHONE_LAYOUT_EVENT = "jf:phone-layout";

export type OrientationReading = {
  /** `screen.orientation.type`, where the browser has it. */
  type?: string | null;
  /** The old `window.orientation` (iOS before screen.orientation): 0, 90, -90, 180. */
  angle?: number | null;
  /** `screen.width` / `screen.height` (iOS keeps them as the upright size). */
  screenW: number;
  screenH: number;
  /** A finger is the main pointer. */
  coarse: boolean;
};

/**
 * Whether this is a phone held on its side. Read from the device's own
 * orientation, never the viewport's shape: a phone's keyboard makes the
 * viewport wider than tall while the phone is upright.
 */
export function phoneOnItsSide(r: OrientationReading): boolean {
  if (!isPhone(r)) return false;
  if (r.type) return r.type.startsWith("landscape");
  if (typeof r.angle === "number") return Math.abs(r.angle) === 90;
  return false;
}

/**
 * A phone: a finger for a pointer and a short side under PHONE_SHORT_SIDE_MAX
 * (tablets and computers turn freely). The screen's size, never the window's,
 * so a keyboard or a toolbar never changes the answer.
 */
export function isPhone(r: OrientationReading): boolean {
  if (!r.coarse) return false;
  const short = Math.min(r.screenW, r.screenH);
  return short > 0 && short < PHONE_SHORT_SIDE_MAX;
}

/**
 * Runs in <head> before the first paint (__root.tsx): marks a phone with
 * `data-phone`, so the first frame is already the phone layout, upright or
 * on its side. The same rule as isPhone.
 */
export const PHONE_BOOT_SCRIPT = `(function(){try{var s=screen,m=Math.min(s.width,s.height);if(window.matchMedia&&window.matchMedia("(pointer: coarse)").matches&&m>0&&m<${PHONE_SHORT_SIDE_MAX})document.documentElement.setAttribute("${PHONE_ATTR}","")}catch(e){}})();`;

/**
 * Keeps `data-phone` true to the device (a foldable opened is a tablet, closed
 * a phone); every rotation and resize asks, and only a change is written.
 * Returns whether it changed.
 */
export function syncPhoneAttr(r: OrientationReading | null = readOrientation()): boolean {
  if (!r || typeof document === "undefined") return false;
  const root = document.documentElement;
  const want = isPhone(r);
  if (want === root.hasAttribute(PHONE_ATTR)) return false;
  if (want) root.setAttribute(PHONE_ATTR, "");
  else root.removeAttribute(PHONE_ATTR);
  window.dispatchEvent(new Event(PHONE_LAYOUT_EVENT));
  return true;
}

/** The phone layout: a phone in any orientation, or anything narrower than md. */
export function phoneLayoutNow(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (document.documentElement.hasAttribute(PHONE_ATTR)) return true;
  return !!window.matchMedia?.(NARROW_QUERY).matches;
}

/** Calls `cb` whenever the phone layout may have changed (crossing md, or `data-phone` changing). */
export function onPhoneLayoutChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia?.(NARROW_QUERY);
  mql?.addEventListener?.("change", cb);
  window.addEventListener(PHONE_LAYOUT_EVENT, cb);
  return () => {
    mql?.removeEventListener?.("change", cb);
    window.removeEventListener(PHONE_LAYOUT_EVENT, cb);
  };
}

/**
 * Ask the browser to hold a phone upright (`screen.orientation.lock`), the
 * way Instagram never turns: Android's installed web app takes it (as does a
 * fullscreen page); a browser tab and every iPhone browser refuse it, and then
 * nothing happens: the page turns and keeps the phone layout. Never throws;
 * true when the browser took it.
 */
export async function lockPortrait(r: OrientationReading | null = readOrientation()): Promise<boolean> {
  if (!r || !isPhone(r)) return false;
  const o = (typeof screen !== "undefined" ? screen.orientation : undefined) as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
  if (typeof o?.lock !== "function") return false;
  try {
    await o.lock("portrait-primary");
    return true;
  } catch {
    return false;
  }
}

/** Let the lock go (the app's own camera is up: the phone may turn to film). */
export function unlockPortrait(): void {
  try {
    (screen.orientation as { unlock?: () => void } | undefined)?.unlock?.();
  } catch {
    /* not lockable here */
  }
}

/** This device, now. */
export function readOrientation(): OrientationReading | null {
  if (typeof window === "undefined" || typeof screen === "undefined") return null;
  const angle = (window as Window & { orientation?: number }).orientation;
  return {
    type: screen.orientation?.type ?? null,
    angle: typeof angle === "number" ? angle : null,
    screenW: screen.width,
    screenH: screen.height,
    coarse: !!window.matchMedia?.("(pointer: coarse)").matches,
  };
}
