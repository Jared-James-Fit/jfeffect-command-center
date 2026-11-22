/**
 * A clip that should be playing keeps playing (Nov 22 2026).
 *
 * The phone stops a clip on its own now and then: the app goes to the
 * background and comes back, a call, a notification or Siri interrupts, the
 * audio session changes, iOS pauses a clip that was unmuted without a tap, the
 * network drops for a moment. The feed only ever played a clip when it came
 * on screen, so a clip stopped by anything else sat on the frame it was on,
 * frozen, until it was swiped away and back.
 *
 *   - a pause nobody here asked for (the clip is still wanted): played again
 *     after a beat, at most RESUME_MAX times in RESUME_WINDOW_MS, so a phone
 *     that keeps stopping it isn't fought;
 *   - back on screen (visibility, pageshow, focus): a wanted clip that's
 *     paused plays again;
 *   - waiting for data: `onWaiting(true)` once it's waited WAIT_SHOW_MS (a quiet
 *     spinner says it's loading, never a frozen frame that looks broken), and
 *     stuck with no new frame for STALL_MS it's reloaded where it was;
 *   - an error: reloaded once where it was before it's called failed.
 *
 * Who decides whether it's wanted stays the caller's (`wanted`): a clip the
 * caller paused (off screen, held, scrubbed) is never played here.
 */
export const RESUME_DELAY_MS = 250;
export const RESUME_MAX = 3;
export const RESUME_WINDOW_MS = 10_000;
export const WAIT_SHOW_MS = 600;
export const STALL_MS = 6_000;
/** At most one stall reload in this long. */
export const RELOAD_GAP_MS = 20_000;

type Listen = {
  addEventListener(type: string, fn: () => void, opts?: unknown): void;
  removeEventListener(type: string, fn: () => void, opts?: unknown): void;
};

/** What it needs of a <video> (a test can stand in for one). */
export type KeepPlayingVideo = Listen & {
  paused: boolean;
  currentTime: number;
  currentSrc?: string;
  getAttribute(name: string): string | null;
  load(): void;
};

export type KeepPlayingEnv = {
  doc?: (Listen & { visibilityState?: string }) | null;
  win?: Listen | null;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
};

export function keepPlaying(
  v: KeepPlayingVideo,
  opts: {
    /** Whether the caller wants it playing right now. */
    wanted: () => boolean;
    /** Play it (the caller's own way: its sound rules). */
    resume: () => void;
    onWaiting?: (waiting: boolean) => void;
    onFailed?: () => void;
  },
  env: KeepPlayingEnv = {},
): () => void {
  const doc = env.doc !== undefined ? env.doc : typeof document === "undefined" ? null : document;
  const win = env.win !== undefined ? env.win : typeof window === "undefined" ? null : window;
  const now = env.now ?? (() => Date.now());
  const later = env.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel =
    env.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const hidden = () => doc?.visibilityState === "hidden";

  let resumeTimer: unknown = null;
  let showTimer: unknown = null;
  let stallTimer: unknown = null;
  let tries: number[] = [];
  let showing = false;
  let waitingAt: number | null = null;
  let lastTime = -1;
  let lastReload = -Infinity;
  let errorReloads = 0;
  let gone = false;

  const clear = (t: unknown) => {
    if (t != null) cancel(t);
  };
  const setShowing = (on: boolean) => {
    if (showing === on) return;
    showing = on;
    opts.onWaiting?.(on);
  };
  const stopWaiting = () => {
    waitingAt = null;
    clear(showTimer);
    clear(stallTimer);
    showTimer = stallTimer = null;
    setShowing(false);
  };

  const resumeSoon = (fresh = false) => {
    if (fresh) tries = [];
    clear(resumeTimer);
    resumeTimer = later(() => {
      resumeTimer = null;
      if (gone || !v.paused || !opts.wanted() || hidden()) return;
      const t = now();
      tries = tries.filter((x) => t - x < RESUME_WINDOW_MS);
      if (tries.length >= RESUME_MAX) return;
      tries.push(t);
      opts.resume();
    }, RESUME_DELAY_MS);
  };

  // where it was, loaded again (the same link), and playing on if it's still wanted
  const reload = () => {
    const src = v.currentSrc || v.getAttribute("src");
    if (!src) return false;
    lastReload = now();
    const at = v.currentTime;
    const onMeta = () => {
      if (gone) return;
      try {
        if (at > 0) v.currentTime = at;
      } catch {
        /* not seekable yet: from the start */
      }
      if (opts.wanted() && !hidden()) opts.resume();
    };
    v.addEventListener("loadedmetadata", onMeta, { once: true });
    try {
      v.load();
    } catch {
      return false;
    }
    return true;
  };

  const onPause = () => {
    if (opts.wanted()) resumeSoon();
    else stopWaiting();
  };
  const onWaiting = () => {
    if (waitingAt != null) return;
    waitingAt = now();
    lastTime = v.currentTime;
    clear(showTimer);
    showTimer = later(() => {
      showTimer = null;
      if (waitingAt != null && opts.wanted()) setShowing(true);
    }, WAIT_SHOW_MS);
    clear(stallTimer);
    stallTimer = later(() => {
      stallTimer = null;
      if (gone || waitingAt == null || !opts.wanted() || hidden()) return;
      if (v.currentTime !== lastTime) return stopWaiting();
      if (now() - lastReload < RELOAD_GAP_MS) return;
      reload();
    }, STALL_MS);
  };
  const onProgress = () => {
    if (waitingAt == null) return;
    if (v.currentTime !== lastTime) stopWaiting();
  };
  const onPlaying = () => {
    stopWaiting();
    errorReloads = 0;
  };
  const onError = () => {
    if (gone) return;
    if (errorReloads < 1) {
      errorReloads += 1;
      later(() => {
        if (!gone && !reload()) opts.onFailed?.();
      }, 800);
      return;
    }
    stopWaiting();
    opts.onFailed?.();
  };
  const onBack = () => {
    if (hidden() || gone) return;
    if (v.paused && opts.wanted()) resumeSoon(true);
  };

  const events: [string, () => void][] = [
    ["pause", onPause],
    ["waiting", onWaiting],
    ["stalled", onWaiting],
    ["timeupdate", onProgress],
    ["playing", onPlaying],
    ["error", onError],
  ];
  events.forEach(([k, f]) => v.addEventListener(k, f));
  doc?.addEventListener("visibilitychange", onBack);
  win?.addEventListener("pageshow", onBack);
  win?.addEventListener("focus", onBack);
  return () => {
    gone = true;
    events.forEach(([k, f]) => v.removeEventListener(k, f));
    doc?.removeEventListener("visibilitychange", onBack);
    win?.removeEventListener("pageshow", onBack);
    win?.removeEventListener("focus", onBack);
    clear(resumeTimer);
    clear(showTimer);
    clear(stallTimer);
    if (showing) opts.onWaiting?.(false);
  };
}
