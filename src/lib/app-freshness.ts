// Keep the phone on the latest version.
//
// The iPhone app is a shell around jfeffect.com, and service workers (what
// normally notices a new deploy) don't run in it. So the app kept running
// whatever version it loaded until iOS happened to kill it: a published fix
// could take days to reach a phone, and "it looks the same" after publishing.
//
// Now the app asks the server which build is live when it comes back to the
// foreground (and every few minutes). If it's newer, and the person is on a
// screen where nothing can be lost, it reloads right then, which looks like
// the app opening. Anywhere else (mid-workout, a form, typing, an upload in
// progress) it shows the existing "JF Effect has been updated" prompt instead.

export const RUNNING_BUILD = typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "dev";

/** Reload on its own only after being away at least this long (a real "reopen"). */
export const RESUME_MIN_AWAY_MS = 30_000;
const RELOADED_KEY = "jf-reloaded-for-build";

/** Screens where a reload can't lose anything: home, messages/inbox lists, notifications. */
export function isSafeToReloadPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (/^\/(admin|portal|m|coach)?$/.test(p)) return true;
  if (p === "/notifications") return true;
  return /\/(messages|communication|inbox|chat)(\/|$)/.test(p);
}

export type FreshnessDecision = "none" | "reload" | "prompt";

export function decideOnNewBuild(input: {
  live: string;
  running: string;
  awayMs: number;
  pathname: string;
  unsaved: boolean;
  alreadyReloadedFor: string | null;
}): FreshnessDecision {
  const { live, running } = input;
  if (!live || live === "dev" || running === "dev" || live === running) return "none";
  // Reloaded for this build already and still not on it (e.g. a stale CDN copy): never loop.
  if (input.alreadyReloadedFor === live) return "prompt";
  if (input.awayMs >= RESUME_MIN_AWAY_MS && !input.unsaved && isSafeToReloadPath(input.pathname)) return "reload";
  return "prompt";
}

export function alreadyReloadedFor(): string | null {
  try { return sessionStorage.getItem(RELOADED_KEY); } catch { return null; }
}
export function markReloadingFor(build: string) {
  try { sessionStorage.setItem(RELOADED_KEY, build); } catch { /* noop */ }
}
