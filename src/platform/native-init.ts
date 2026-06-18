/**
 * Native shell initialization (iOS/Android via Capacitor). All imports are
 * dynamic so the web bundle never pays the cost and never crashes if a
 * plugin isn't installed in a given environment. Safe no-op on the web.
 *
 * Called once from __root.tsx after mount.
 */
import { isNative, getPlatform } from "./index";

let initialized = false;

export async function initNativeShell() {
  if (initialized) return;
  initialized = true;
  if (!isNative()) return;

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // Dark content on the app's dark backgrounds; safe to call early.
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    if (getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#0B0B0F" }).catch(() => {});
    }
  } catch { /* plugin not installed in this build */ }

  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {});
    await Keyboard.setScroll({ isDisabled: false }).catch(() => {});
  } catch { /* plugin not installed */ }

  try {
    const { App } = await import("@capacitor/app");
    // Surface backgrounded/foregrounded events for session refresh later.
    App.addListener("appStateChange", () => { /* hook point */ }).catch(() => {});
  } catch { /* plugin not installed */ }
}