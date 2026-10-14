// Thin platform abstractions. Today: web-only implementations.
// Capacitor-ready: swap the impl in each module behind the same exported API.
export * from "./notifications";
export * from "./share";
export * from "./haptics";
export * from "./camera";
export * from "./storage";

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  // iOS Safari uses navigator.standalone
  const ios = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mm || ios;
}

/**
 * True when running inside a Capacitor-wrapped native shell (iOS/Android app).
 * Returns false during SSR and in the regular browser. Use to hide web-only
 * surfaces (install prompts, web checkout) from the native app.
 */
export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cap = (window as any).Capacitor;
    if (cap && typeof cap.isNativePlatform === "function") {
      return !!cap.isNativePlatform();
    }
    return !!cap?.isNative;
  } catch {
    return false;
  }
}

export function getPlatform(): "ios" | "android" | "web" {
  if (typeof window === "undefined") return "web";
  const cap = (window as any).Capacitor;
  const p = cap?.getPlatform?.();
  if (p === "ios" || p === "android") return p;
  return "web";
}
/**
 * The first iOS build (TestFlight / App Store) that carries the camera and
 * photo permission text. Older ones can't use the camera at all: the live
 * camera is refused, and the phone's own camera closes the app.
 */
export const IOS_CAMERA_MIN_BUILD = 1842;

/** The installed native app's build number, or null on the web (or when it can't tell). */
export async function nativeAppBuild(): Promise<number | null> {
  if (!isNative()) return null;
  try {
    const info = await (window as any).Capacitor?.Plugins?.App?.getInfo?.();
    const n = Number(info?.build);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** This iPhone app is a build from before the camera worked in it (it needs updating). */
export async function iosAppTooOldForCamera(): Promise<boolean> {
  if (getPlatform() !== "ios") return false;
  const build = await nativeAppBuild();
  return build != null && build < IOS_CAMERA_MIN_BUILD;
}

/** iOS: JF Effect's own page in Settings (where Camera is switched on). */
export function openAppSettings() {
  if (getPlatform() === "ios") window.location.href = "app-settings:";
}

/** TestFlight, to update the app. */
export function openTestFlight() {
  if (getPlatform() === "ios") window.location.href = "itms-beta://";
}
