/**
 * "/" is two things: the installed app's start page (a launch opens Crew, or
 * the workout they were in the middle of: launch-home.ts) and jfeffect.com's
 * front door for everyone else. The server renders the landing page (fast,
 * and what search engines see); before the first paint this script marks
 * <html data-launch="app"> for anyone signed in on this browser or inside the
 * installed app, and styles.css shows them the launch splash instead, so the
 * app never flashes a marketing page.
 *
 * `?landing` always shows the page (the coach checking it while signed in).
 */

export type LaunchInput = { hasSession: boolean; standalone: boolean; native: boolean; forceLanding: boolean };

/** Pure (tested): what "/" is for this visitor. */
export function launchMode(i: LaunchInput): "app" | "landing" {
  if (i.forceLanding) return "landing";
  return i.hasSession || i.standalone || i.native ? "app" : "landing";
}

/** Same rule, in the head before the first paint (keep in step with launchMode and hasPersistedAuthSession). */
export const LAUNCH_BOOT_SCRIPT =
  '(function(){try{if(location.pathname!=="/")return;var r=document.documentElement;if(/[?&]landing\\b/.test(location.search)){r.removeAttribute("data-launch");return}var app=false;try{var ls=window.localStorage;for(var i=0;i<ls.length;i++){var k=ls.key(i);if(k&&k.indexOf("sb-")===0&&k.slice(-11)==="-auth-token"&&ls.getItem(k)){app=true;break}}}catch(e){app=true}if(!app){var c=window.Capacitor;app=window.navigator.standalone===true||!!(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||!!(c&&(typeof c.isNativePlatform==="function"?c.isNativePlatform():c.isNative))}if(app)r.setAttribute("data-launch","app");else r.removeAttribute("data-launch")}catch(e){}})();';

/** Inside the installed app (home-screen web app or the native shell). */
export function installedApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as any).Capacitor;
  const native = !!(cap && (typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : cap.isNative));
  return native || (window.navigator as any).standalone === true || !!window.matchMedia?.("(display-mode: standalone)").matches;
}

/** The same decision after hydration (a client-side visit to "/" never ran the head script). */
export function currentLaunchMode(): "app" | "landing" {
  if (typeof window === "undefined") return "landing";
  let hasSession = false;
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token") && ls.getItem(k)) {
        hasSession = true;
        break;
      }
    }
  } catch {
    hasSession = true;
  }
  const forceLanding = /[?&]landing\b/.test(window.location.search);
  return launchMode({ hasSession, standalone: installedApp(), native: false, forceLanding });
}
