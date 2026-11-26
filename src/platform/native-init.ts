/**
 * Native shell initialization (iOS/Android via Capacitor). All imports are
 * dynamic so the web bundle never pays the cost and never crashes if a
 * plugin isn't installed in a given environment. Safe no-op on the web.
 *
 * Called once from __root.tsx after mount.
 */
import { isNative, getPlatform } from "./index";

let initialized = false;

/** The status bar's page colours, the same as THEME_COLOR in theme.ts. */
const NATIVE_BAR: Record<"light" | "dark", string> = { light: "#F6F7F8", dark: "#0D0D0F" };

/**
 * Keep the phone's status bar in step with the theme painted in the app:
 * light text on a dark page, dark text on a light one. Capacitor's `Style.Dark`
 * means "for a dark background" (light content). A no-op on the web.
 */
export async function syncNativeChrome(theme: "light" | "dark") {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light }).catch(() => {});
    if (getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: NATIVE_BAR[theme] }).catch(() => {});
    }
  } catch { /* plugin not installed in this build */ }
}

export async function initNativeShell() {
  if (initialized) return;
  initialized = true;
  if (!isNative()) return;

  // No tap or window.open reaches a purchase or sales page in the app (App Store 3.1.1).
  try {
    const { installShellPurchaseGuard } = await import("@/lib/native-purchases");
    installShellPurchaseGuard(window as any);
  } catch { /* never blocks the rest of the shell */ }

  // Whatever the boot script painted; the root keeps it in step afterwards.
  await syncNativeChrome(document.documentElement.classList.contains("dark") ? "dark" : "light");

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
    // Top up Apple Health / Health Connect data when the app comes back to the foreground
    // (only on phones where the athlete connected it; throttled inside).
    const healthTopUp = () =>
      import("./health").then((m) => m.autoSyncHealthStore()).catch(() => {});
    App.addListener("appStateChange", (state: { isActive: boolean }) => {
      if (state?.isActive) void healthTopUp();
    }).catch(() => {});
    void healthTopUp();
  } catch { /* plugin not installed */ }
}