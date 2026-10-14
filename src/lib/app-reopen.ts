/**
 * Telling a reopen from a reload, so a reopened app always starts on Home.
 *
 * Phones don't always reopen an installed app at its start page ("/"): iOS and
 * Android can hand back the page it was last on. So the app notes what it was
 * doing just before each page load:
 *  - "away": it went to the background (the app switcher, the step before
 *    swiping it closed, or the phone killing it later). The next load is a
 *    reopen → Home.
 *  - "leaving": the page itself unloaded (pull-to-refresh, an update reload,
 *    Stripe or Google sign-in and back). The next load keeps its page.
 *  - "open": on screen.
 * A notification tap (marked with ?jf_open) or a link to a different page
 * than the one it was on always opens that page.
 */

const STATE_KEY = "jf:app-state";
/** Added by notification taps: open this page, not Home. */
export const OPEN_LINK_PARAM = "jf_open";

export type AppState = { path: string; state: "open" | "away" | "leaving"; at: number };

export type AppBoot = {
  /** where this page load started */
  path: string;
  /** what the app was doing just before it */
  previous: AppState | null;
  /** opened by a notification tap */
  link: boolean;
};

function readState(): AppState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    const s = raw ? (JSON.parse(raw) as AppState) : null;
    return s && typeof s.path === "string" && typeof s.state === "string" ? s : null;
  } catch {
    return null;
  }
}

function writeState(state: AppState["state"], path: string) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ path, state, at: Date.now() }));
  } catch { /* storage unavailable */ }
}

// Read once as this page load's JavaScript starts, before anything rewrites it.
const boot: AppBoot | null = typeof window === "undefined"
  ? null
  : (() => {
      const url = new URL(window.location.href);
      return { path: url.pathname, previous: readState(), link: url.searchParams.has(OPEN_LINK_PARAM) };
    })();

export function appBoot(): AppBoot | null {
  return boot;
}

/** Start noting the app's state (call once on the client). Returns a cleanup. */
export function trackAppState(): () => void {
  const path = () => window.location.pathname;
  // Once the page is really unloading (reload, hard navigation) that's the
  // final word, whichever order the browser fires "hidden" and "pagehide" in.
  let unloading = false;
  const onVisibility = () => {
    if (unloading) return;
    writeState(document.visibilityState === "hidden" ? "away" : "open", path());
  };
  const onPageHide = (e: PageTransitionEvent) => {
    if (e.persisted) return; // kept in memory (back/forward cache), not unloaded
    unloading = true;
    writeState("leaving", path());
  };
  const onPageShow = () => {
    unloading = false;
    if (document.visibilityState !== "hidden") writeState("open", path());
  };
  writeState(document.visibilityState === "hidden" ? "away" : "open", path());
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  };
}

/** The page in view changed (in-app navigation). */
export function noteAppPage(path: string) {
  if (typeof document === "undefined" || document.visibilityState === "hidden") return;
  writeState("open", path);
}

/** The installed app: added to the home screen, or the iOS / Android app. */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    if ((window.navigator as unknown as { standalone?: boolean }).standalone === true) return true;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

const HOME_PATHS = new Set(["/portal", "/admin", "/finance"]);
const APP_PREFIXES = ["/portal", "/admin", "/finance"];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Pure: should this page load go to Home instead? Returns where (the role's
 * Home, or "/" to let the launch screen decide) or null to stay.
 */
export function reopenTarget(input: {
  installed: boolean;
  boot: AppBoot | null;
  currentPath: string;
  home: string | null;
}): string | null {
  const { installed, boot: b, currentPath, home } = input;
  if (!installed || !b || b.link) return null;
  const path = currentPath.replace(/\/+$/, "") || "/";
  if (path !== (b.path.replace(/\/+$/, "") || "/")) return null; // already moved on (e.g. signed in first)
  if (!APP_PREFIXES.some((p) => under(path, p)) || HOME_PATHS.has(path)) return null;
  const prev = b.previous;
  if (!prev || prev.state !== "away") return null; // a reload or hand-off, not a reopen
  if ((prev.path.replace(/\/+$/, "") || "/") !== path) return null; // a link to another page
  return home ?? "/";
}
