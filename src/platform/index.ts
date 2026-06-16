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