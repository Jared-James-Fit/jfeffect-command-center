/**
 * App appearance (light / dark).
 *
 * Light is the default and the designed baseline. Dark is opt-in per device
 * (a per-viewer convenience, so localStorage is the right home) and only
 * applies inside the signed-in app — public/marketing pages always stay light.
 *
 * The same rules run twice: once as an inline <head> script (THEME_BOOT_SCRIPT)
 * so the first paint is already correct, and again from React (useThemeSync)
 * so in-app navigation and the toggle stay in step.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "jf-theme";
export const THEME_CHANGE_EVENT = "jf-theme-change";

/** Signed-in app areas that honour the dark preference. */
export const THEMED_PATH_RE = /^\/(portal|admin|coach|m|media|notifications)(\/|$)/;

/** Browser chrome / PWA status bar colour (light keeps the original brand value). */
export const THEME_COLOR: Record<Theme, string> = { light: "#0a0a0a", dark: "#111114" };

export function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Apply a theme to <html> for the given path (public pages are forced light). */
export function applyTheme(theme: Theme, pathname = typeof window === "undefined" ? "/" : window.location.pathname) {
  if (typeof document === "undefined") return;
  const effective: Theme = theme === "dark" && THEMED_PATH_RE.test(pathname) ? "dark" : "light";
  const root = document.documentElement;
  root.classList.toggle("dark", effective === "dark");
  root.style.colorScheme = effective;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[effective]));
}

export function setTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode — still apply for this session */
  }
  // Brief no-transition window so every surface flips at once instead of
  // each element animating its own colour change.
  const root = document.documentElement;
  root.classList.add("theme-switching");
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
  window.setTimeout(() => root.classList.remove("theme-switching"), 60);
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) {
      applyTheme(readStoredTheme());
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

/** Current stored preference + setter. */
export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribe, readStoredTheme, () => "light");
  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme]);
  return { theme, setTheme, toggle };
}

/** Keep <html> in sync with the preference as the route changes. */
export function useThemeSync(pathname: string) {
  const { theme } = useTheme();
  useEffect(() => {
    applyTheme(theme, pathname);
  }, [theme, pathname]);
}

/** Inline boot script — must mirror applyTheme(). Runs before first paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="dark"&&${THEMED_PATH_RE.toString()}.test(location.pathname)?"dark":"light";var r=document.documentElement;if(t==="dark")r.classList.add("dark");r.style.colorScheme=t;var c=${JSON.stringify(THEME_COLOR)}[t];var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",c);}catch(e){}})();`;
