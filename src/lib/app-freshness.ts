// Keep the phone on the latest version, quietly.
//
// The iPhone app is a shell around jfeffect.com, and service workers (what
// normally notices a new deploy) don't run in it. So the app kept running
// whatever version it loaded until iOS happened to kill it: a published fix
// could take days to reach a phone.
//
// The app asks the server which build is live when it comes back to the
// foreground (and every few minutes). A newer build is picked up by reloading
// at a moment nothing can be lost, which looks like the app opening:
//   - coming back after `RESUME_MIN_AWAY_MS` to a screen that's only a list
//     (home, inbox, notifications);
//   - coming back, or sitting in the background, for `NEW_VISIT_AWAY_MS` (the
//     app's own "new visit", feed-anchor.ts) on any screen that isn't one where
//     something is being done (a workout, a form, a builder, sign-in, payment,
//     meet day), with nothing open, typed or waiting to sync.
// Otherwise it waits for the next such moment. It never asks: the "JF Effect
// has been updated" prompt is gone (Nov 25 2026). An old build that can't load
// a screen recovers on its own (chunk-recovery.ts reloads once for a page; a
// sheet says "Couldn't load this section" with Try again, lazy-chunk.tsx).

export const RUNNING_BUILD = typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "dev";

/** Reload on a list screen only after being away at least this long (a real "reopen"). */
export const RESUME_MIN_AWAY_MS = 30_000;
/** Away (or in the background) this long is a new visit: any calm screen may reload. Same as feed-anchor's RESUME_NEW_VISIT_MS. */
export const NEW_VISIT_AWAY_MS = 30 * 60_000;
const RELOADED_KEY = "jf-reloaded-for-build";

/** Screens where a reload can't lose anything: home, messages/inbox lists, notifications. */
export function isSafeToReloadPath(pathname: string): boolean {
  const p = clean(pathname);
  if (/^\/(admin|portal|m|coach)?$/.test(p)) return true;
  if (p === "/notifications") return true;
  return /\/(messages|communication|inbox|chat)(\/|$)/.test(p);
}

/**
 * Screens where someone is in the middle of something: never reloaded under them, whatever the
 * time away (a workout being logged, a form or check-in, a program / plan being built or
 * imported, meet day, a meeting being presented, signing up, signing in, paying, booking).
 */
export function isBusyPath(pathname: string): boolean {
  const p = clean(pathname);
  if (/^\/portal\/workouts\/(?!analytics$|prs$)[^/]+$/.test(p)) return true;
  if (/^\/portal\/(check-in|check-ins\/[^/]+)$/.test(p)) return true;
  if (/^\/portal\/(programs\/(new|import)|nutrition-studio)$/.test(p)) return true;
  if (
    /^\/admin\/(blocks\/[^/]+|program-library\/[^/]+|competition\/[^/]+|meetings\/[^/]+\/present)$/.test(
      p,
    )
  )
    return true;
  if (/^\/admin\/client-programs\/[^/]+\/next-program$/.test(p)) return true;
  return /^\/(auth|activate|join|apply|coaching\/apply|setup|staff-setup|member-setup|reset-password|welcome|m\/welcome|signup\/[^/]+|sign\/[^/]+|book(\/[^/]+)?|b\/[^/]+|autopay\/[^/]+|challenges\/[^/]+\/join)$/.test(
    p,
  );
}

function clean(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export type FreshnessDecision = "none" | "reload" | "wait";

/**
 * What to do about a build that isn't the one running. Never a prompt: `wait` means try again at
 * the next reopen or background stretch.
 *  - `awayMs`: how long the app was out of sight before this check (0 while it's on screen);
 *  - `hidden`: the check runs while it's still out of sight (a computer's background tab, where
 *    timers keep running), so a reload there is never seen.
 */
export function decideOnNewBuild(input: {
  live: string;
  running: string;
  awayMs: number;
  hidden?: boolean;
  pathname: string;
  unsaved: boolean;
  alreadyReloadedFor: string | null;
}): FreshnessDecision {
  const { live, running } = input;
  if (!live || live === "dev" || running === "dev" || live === running) return "none";
  // Reloaded for this build already and still not on it (e.g. a stale CDN copy): never loop.
  if (input.alreadyReloadedFor === live) return "wait";
  if (input.unsaved || isBusyPath(input.pathname)) return "wait";
  if (input.awayMs >= NEW_VISIT_AWAY_MS) return "reload";
  if (!input.hidden && input.awayMs >= RESUME_MIN_AWAY_MS && isSafeToReloadPath(input.pathname))
    return "reload";
  return "wait";
}

export function alreadyReloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_KEY);
  } catch {
    return null;
  }
}
export function markReloadingFor(build: string) {
  try {
    sessionStorage.setItem(RELOADED_KEY, build);
  } catch {
    /* noop */
  }
}
