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
    // Mirror the keyboard state into <html data-keyboard-open> so the same
    // CSS that hides the mobile bottom-nav on web (visualViewport-based)
    // also fires on native iOS where Native resize means visualViewport
    // never changes and the web hook would otherwise never trigger.
    const root = document.documentElement;
    Keyboard.addListener("keyboardWillShow", (info: { keyboardHeight: number }) => {
      root.setAttribute("data-keyboard-open", "true");
      root.style.setProperty("--keyboard-inset", `${info?.keyboardHeight ?? 0}px`);
    }).catch(() => {});
    Keyboard.addListener("keyboardWillHide", () => {
      root.removeAttribute("data-keyboard-open");
      root.style.setProperty("--keyboard-inset", "0px");
    }).catch(() => {});
  } catch { /* plugin not installed */ }

  try {
    const { App } = await import("@capacitor/app");
    // Surface backgrounded/foregrounded events for session refresh later.
    App.addListener("appStateChange", () => { /* hook point */ }).catch(() => {});
  } catch { /* plugin not installed */ }
}