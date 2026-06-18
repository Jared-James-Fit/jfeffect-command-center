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