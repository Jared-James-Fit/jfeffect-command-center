/**
 * App appearance: Light, Dark or System (follow the device).
 *
 * The preference is a per-viewer convenience kept in localStorage and saved to
 * the user's account (user_preferences, see theme-account-sync) so it follows
 * them across devices until they change it. It only applies inside the app and
 * its sign-in flows (THEMED_PATH_RE): the public marketing pages are designed
 * light and stay light.
 *
 * Nobody's appearance is ever changed for them. With no choice made:
 *  - an account made before `DARK_DEFAULT_SINCE` keeps what it has always had
 *    (light), until they pick something in Account;
 *  - everyone else (new accounts, first-time visitors) starts in dark.
 *
 * The same rules run twice: once as an inline <head> script (THEME_BOOT_SCRIPT)
 * so the first paint is already correct, and again from React (useThemeSync)
 * so in-app navigation, the picker and the device's own setting stay in step.
 * `resolveTheme` / `defaultPreference` are the one pure copy of the rules and
 * the boot script is generated from the same constants.
 */
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";

/** What gets painted. */
export type Theme = "light" | "dark";
/** What the person chose. */
export type ThemePreference = Theme | "system";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

export const THEME_STORAGE_KEY = "jf-theme";
export const THEME_CHANGE_EVENT = "jf-theme-change";
/** The default this device uses while no choice was made ("light" for a long-time account), kept so a signed-out launch matches. */
export const THEME_DEFAULT_KEY = "jf-theme-default";

/**
 * Accounts made before this have only ever had light unless they chose dark,
 * so with no saved choice they keep light. Accounts made from here on start
 * in dark.
 */
export const DARK_DEFAULT_SINCE = "2026-11-25T00:00:00Z";

/**
 * App areas that honour the preference (and the public challenge pages, for
 * app users), plus the sign-in and account-setup pages a person passes through
 * on the way in, so signing in never flashes the other theme.
 */
export const THEMED_PATH_RE =
  /^\/(portal|admin|coach|m|media|notifications|finance|challenges|athletes|auth|recover|reset-password|setup|staff-setup|member-setup|activate|welcome)(\/|$)/;

/**
 * The colour of the bar above the page (the iPhone home-screen app's solid status
 * bar, Android's): each theme's own page background (--background), so the status
 * bar and the app read as one surface. Crew's paged feed sets black while it's open.
 */
export const THEME_COLOR: Record<Theme, string> = { light: "#f6f7f8", dark: "#0d0d0f" };

export function isPreference(v: unknown): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

/** The default for an account: long-time accounts keep light, new ones start dark. */
export function defaultPreferenceFor(accountCreatedAt: string | null | undefined): Theme {
  const created = accountCreatedAt ? Date.parse(accountCreatedAt) : NaN;
  // Unknown age: never flip anyone to dark by guessing.
  if (!Number.isFinite(created)) return "light";
  return created < Date.parse(DARK_DEFAULT_SINCE) ? "light" : "dark";
}

/** What's painted for a preference: System follows the device, a public page is light. */
export function resolveTheme(
  preference: ThemePreference,
  opts: { systemDark: boolean; pathname: string },
): Theme {
  if (!THEMED_PATH_RE.test(opts.pathname)) return "light";
  if (preference === "system") return opts.systemDark ? "dark" : "light";
  return preference;
}

function ls(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

/** The person's own choice on this device, or null when they never made one. */
export function readStoredPreference(): ThemePreference | null {
  const v = ls(THEME_STORAGE_KEY);
  return isPreference(v) ? v : null;
}

/** What applies with no choice made on this device (light for a long-time account, else dark). */
export function readDefaultPreference(): Theme {
  return ls(THEME_DEFAULT_KEY) === "light" ? "light" : "dark";
}

/** The preference in force: their choice, else the default. */
export function readPreference(): ThemePreference {
  return readStoredPreference() ?? readDefaultPreference();
}

export function systemPrefersDark(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** What's painted right now for the current preference and page. */
export function effectiveTheme(pathname = typeof window === "undefined" ? "/" : window.location.pathname): Theme {
  return resolveTheme(readPreference(), { systemDark: systemPrefersDark(), pathname });
}

/** Apply the preference to <html> for the given path (public pages are forced light). */
export function applyTheme(
  preference: ThemePreference = readPreference(),
  pathname = typeof window === "undefined" ? "/" : window.location.pathname,
): Theme {
  const effective = resolveTheme(preference, { systemDark: systemPrefersDark(), pathname });
  if (typeof document === "undefined") return effective;
  const root = document.documentElement;
  root.classList.toggle("dark", effective === "dark");
  root.style.colorScheme = effective;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[effective]));
  return effective;
}

/** When the local choice was last made (ISO), used to reconcile with the account copy. */
export const THEME_UPDATED_AT_KEY = "jf-theme-updated-at";
/** Which signed-in user the local choice belongs to (so accounts never inherit each other's). */
export const THEME_OWNER_KEY = "jf-theme-owner";

export type ThemeChangeSource = "user" | "account";
export type ThemeChangeDetail = { theme: ThemePreference; source: ThemeChangeSource; at: string };

export function readThemeUpdatedAt(): string | null {
  return ls(THEME_UPDATED_AT_KEY);
}

/** Record the default this device falls back to while no choice was made. Never touches a choice. */
export function setDefaultPreference(theme: Theme) {
  try { window.localStorage.setItem(THEME_DEFAULT_KEY, theme); } catch { /* storage unavailable */ }
  applyTheme();
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/** Forget the device's choice (a different account's, or none) and fall back to the default. */
export function clearPreference() {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.localStorage.removeItem(THEME_UPDATED_AT_KEY);
  } catch { /* storage unavailable */ }
  switchingFlip(() => applyTheme());
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/** Brief no-transition window so every surface flips at once instead of each element animating its own colour change. */
function switchingFlip(apply: () => void) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  apply();
  window.setTimeout(() => root.classList.remove("theme-switching"), 60);
}

/**
 * Change the appearance. `source: "user"` (the picker) stamps the choice so it
 * is saved to the account; `source: "account"` applies the account's saved
 * choice on this device without echoing it back.
 */
export function setTheme(preference: ThemePreference, opts: { source?: ThemeChangeSource; at?: string } = {}) {
  const source = opts.source ?? "user";
  const at = opts.at ?? new Date().toISOString();
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    window.localStorage.setItem(THEME_UPDATED_AT_KEY, at);
  } catch {
    /* private mode — still apply for this session */
  }
  switchingFlip(() => applyTheme(preference));
  window.dispatchEvent(new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, { detail: { theme: preference, source, at } }));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === THEME_DEFAULT_KEY || e.key === null) {
      applyTheme();
      cb();
    }
  };
  window.addEventListener(THEME_CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Current preference (what they chose, or the default) and setter. */
export function useTheme() {
  const preference = useSyncExternalStore<ThemePreference>(subscribe, readPreference, () => "dark");
  const set = useCallback((t: ThemePreference) => setTheme(t), []);
  return { preference, setTheme: set };
}

function subscribeSystem(cb: () => void) {
  let mq: MediaQueryList | null = null;
  try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { /* no matchMedia */ }
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
}

/** The theme actually painted on this page (follows the device while on System). */
export function useResolvedTheme(pathname?: string): Theme {
  const { preference } = useTheme();
  const systemDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => false);
  return resolveTheme(preference, {
    systemDark,
    pathname: pathname ?? (typeof window === "undefined" ? "/" : window.location.pathname),
  });
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Keep <html> in sync with the preference as the route changes and as the
 * device's own appearance changes (System). A layout effect, so a route that
 * crosses between a public page and the app is painted in its theme from the
 * first frame instead of a frame late.
 */
export function useThemeSync(pathname: string) {
  const { preference } = useTheme();
  useIsoLayoutEffect(() => {
    applyTheme(preference, pathname);
  }, [preference, pathname]);
  useEffect(() => {
    if (preference !== "system") return;
    return subscribeSystem(() => applyTheme("system", pathname));
  }, [preference, pathname]);
}

/**
 * The saved Supabase session carries the account's creation date, so a device
 * with no choice made can still tell a long-time account from a new one before
 * any script or request has run.
 */
const SESSION_KEY_RE = "^sb-.*-auth-token$";

/** Inline boot script — must mirror resolveTheme() / defaultPreferenceFor(). Runs before first paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var p=null;try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="system"){p=null;var def=null;try{def=localStorage.getItem(${JSON.stringify(THEME_DEFAULT_KEY)})}catch(e){}if(def==="light"||def==="dark"){p=def}else{p="dark";try{var re=new RegExp(${JSON.stringify(SESSION_KEY_RE)});for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&re.test(k)){var s=JSON.parse(localStorage.getItem(k)||"null");var c=s&&s.user&&s.user.created_at?Date.parse(s.user.created_at):NaN;if(c===c&&c<${Date.parse(DARK_DEFAULT_SINCE)})p="light";if(c!==c)p="light";try{localStorage.setItem(${JSON.stringify(THEME_DEFAULT_KEY)},p)}catch(e){}break}}}catch(e){}}}var t=p;if(!${THEMED_PATH_RE.toString()}.test(location.pathname)){t="light"}else if(p==="system"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}if(t==="dark")d.classList.add("dark");d.style.colorScheme=t;var cs=${JSON.stringify(THEME_COLOR)}[t];var m=document.querySelectorAll('meta[name="theme-color"]');for(var j=0;j<m.length;j++)m[j].setAttribute("content",cs);}catch(e){}})();`;

/**
 * Right after the head's tags (THEME_BOOT_SCRIPT runs before they exist): the
 * bar above the page takes the theme already applied, from the very first
 * frame (the iPhone home-screen app's solid status bar reads it at launch).
 */
export const THEME_COLOR_SCRIPT = `(function(){try{var c=document.documentElement.classList.contains("dark")?${JSON.stringify(THEME_COLOR.dark)}:${JSON.stringify(THEME_COLOR.light)};var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",c);}catch(e){}})();`;
