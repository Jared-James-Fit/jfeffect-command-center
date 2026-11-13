/**
 * JF Effect is a portrait app on phones (TikTok's, Instagram's): turned on its
 * side, nothing reflows into a wider layout. The installed iPhone app is locked
 * to portrait by iOS itself (Info.plist, ios-build.yml) and Android's
 * home-screen app by the manifest's `orientation`; Safari and iPhone home-screen
 * web apps can't lock it, so there a phone held sideways gets one screen asking
 * to turn it back (PortraitOnly). Tablets and computers turn freely.
 */

/** A phone's short side is under this (an iPad mini's is 744). */
export const PHONE_SHORT_SIDE_MAX = 600;

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
  if (!r.coarse) return false;
  const short = Math.min(r.screenW, r.screenH);
  if (!(short > 0) || short >= PHONE_SHORT_SIDE_MAX) return false;
  if (r.type) return r.type.startsWith("landscape");
  if (typeof r.angle === "number") return Math.abs(r.angle) === 90;
  return false;
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
