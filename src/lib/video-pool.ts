/**
 * Crew's video elements: made once and reused, never one per clip. The feed
 * borrows from FEED_POOL (`acquireFeedVideo` / `releaseFeedVideo`), the
 * full-screen clips keep REEL_SLOTS of their own, moved page to page
 * (`reelVideo`).
 *
 * Why: clips play with sound by default, and an iPhone (Safari and the
 * home-screen app) lets a video make sound only once that element was first
 * played from a tap. A new element per clip would go quiet on every clip.
 * Every real tap anywhere (`click`, a `touchend` that didn't move, a key)
 * allows every pooled element sound from then on (`unlockVideoSound`), and a
 * feed clip that had to start muted gets its sound on that same tap (and the
 * tap does nothing else to it, `justGaveSound`). A swipe's end tries too, in
 * case the phone counts it, until the first time it says no
 * (`swipeUnlocks`), so a feed you only swipe through gets its sound the
 * moment the phone allows it. The installed app (Capacitor) never asks, so
 * there clips have sound from the first one.
 */
import { REEL_SLOTS } from "@/lib/reels";

export const FEED_POOL = 6;

/** Every element made here (pooled, plus any extra a busy feed borrowed). */
const known = new Set<HTMLVideoElement>();
/** Elements that have played with sound from a tap (the phone allows them sound now). */
const unlocked = new WeakSet<HTMLVideoElement>();
/** Feed clips playing muted only because the phone held their sound back. */
const blocked = new Set<HTMLVideoElement>();
let reels: HTMLVideoElement[] | null = null;
let feed: HTMLVideoElement[] | null = null;
const feedFree: HTMLVideoElement[] = [];

function make(): HTMLVideoElement {
  const v = document.createElement("video");
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.setAttribute("disableremoteplayback", "");
  v.playsInline = true;
  v.loop = true;
  known.add(v);
  return v;
}

function ensure() {
  if (typeof document === "undefined") return;
  if (!reels)
    reels = Array.from({ length: REEL_SLOTS }, () => {
      // the full-screen clips buffer the ones either side whole
      const v = make();
      v.preload = "auto";
      return v;
    });
  if (!feed) {
    feed = Array.from({ length: FEED_POOL }, make);
    feedFree.push(...feed);
  }
  installUnlock();
}

/** The full-screen clips' element for a page's slot. */
export function reelVideo(slot: number): HTMLVideoElement {
  ensure();
  const all = reels!;
  return all[((slot % all.length) + all.length) % all.length];
}

/** A feed clip's element (a pooled one, else a new one, which stays quiet until a tap). */
export function acquireFeedVideo(): HTMLVideoElement {
  ensure();
  const v = feedFree.pop() ?? make();
  v.preload = "metadata";
  return v;
}

/** Done with it: stopped, emptied (its buffer and decoder go back) and returned to the pool. */
export function releaseFeedVideo(v: HTMLVideoElement) {
  v.pause();
  blocked.delete(v);
  v.removeAttribute("src");
  v.removeAttribute("data-ambient-audio");
  try {
    v.load();
  } catch {
    /* no player here (tests) */
  }
  v.remove();
  if (feed?.includes(v)) {
    if (!feedFree.includes(v)) feedFree.push(v);
  } else known.delete(v);
}

export const SOUND_BLOCKED_EVENT = "jf-sound-blocked";

/** True while this clip plays muted because the phone wanted a tap before its sound. */
export function soundBlocked(v: HTMLVideoElement | null): boolean {
  return !!v && blocked.has(v);
}

function setBlocked(v: HTMLVideoElement, on: boolean) {
  if (on === blocked.has(v)) return;
  if (on) blocked.add(v);
  else blocked.delete(v);
  v.dispatchEvent(new Event(SOUND_BLOCKED_EVENT));
}

function isNotAllowed(e: unknown) {
  return (e as { name?: string } | null)?.name === "NotAllowedError";
}

/**
 * Play a feed clip, with sound when `sound` (else muted). Sound the phone
 * refuses without a tap: it plays muted, marked blocked, and the next tap
 * anywhere gives it its sound (or its own speaker does).
 */
export function playFeedVideo(v: HTMLVideoElement, sound: boolean) {
  v.muted = !sound;
  if (!sound) setBlocked(v, false);
  const p = v.play() as Promise<void> | undefined;
  p?.then?.(
    () => {
      if (!v.muted) {
        unlocked.add(v);
        setBlocked(v, false);
      }
    },
    (e: unknown) => {
      if (v.muted || !isNotAllowed(e)) return;
      v.muted = true;
      setBlocked(v, true);
      void (v.play() as Promise<void> | undefined)?.catch?.(() => undefined);
    },
  );
}

/**
 * Inside a tap: give a blocked feed clip its sound (its own speaker). Should
 * the phone still say no (a swipe it didn't count), it goes back to playing
 * muted and blocked, and `refused` hears it.
 */
export function unmuteBlocked(v: HTMLVideoElement, refused?: () => void) {
  v.muted = false;
  setBlocked(v, false);
  const p = v.play() as Promise<void> | undefined;
  p?.then?.(
    () => unlocked.add(v),
    (e: unknown) => {
      if (!isNotAllowed(e)) return;
      v.muted = true;
      setBlocked(v, true);
      void (v.play() as Promise<void> | undefined)?.catch?.(() => undefined);
      refused?.();
    },
  );
}

/** When a tap last gave a held-back clip its sound: that tap is for the sound, not a pause or a mute. */
let soundGivenAt = 0;
/** True for the tap that just gave a clip the phone held quiet its sound (its click comes right after). */
export function justGaveSound(now = Date.now()): boolean {
  return now - soundGivenAt < 600;
}

/**
 * Whether a swipe's end counts as a tap for sound on this phone: unknown until
 * one is tried, false (for the visit) the first time the phone says no, so a
 * phone that doesn't count them is asked once, never on every swipe.
 */
let swipeUnlocks: boolean | null = null;
/** What the phone said to a swipe so far (null: not asked yet). */
export function swipeGivesSound(): boolean | null {
  return swipeUnlocks;
}

/** Whether a tap may give blocked feed clips their sound (the feed's speaker isn't off). */
let soundWanted: () => boolean = () => true;
export function setSoundWanted(fn: () => boolean) {
  soundWanted = fn;
}

/**
 * Call inside a tap: every element made here may play with sound from now
 * on. A blocked feed clip gets its sound now (unless the tap was on its own
 * speaker, `skip`, which decides for itself).
 */
export function unlockVideoSound(skip?: Element | null, swipe = false) {
  if (typeof document === "undefined") return;
  ensure();
  const refused = () => {
    if (swipe) swipeUnlocks = false;
  };
  for (const v of known) {
    if (blocked.has(v)) {
      if (skip && skip.contains(v)) continue;
      if (soundWanted()) {
        if (!swipe) soundGivenAt = Date.now();
        unmuteBlocked(v, refused);
      }
      continue;
    }
    if (unlocked.has(v) || !v.paused) continue;
    const muted = v.muted;
    v.muted = false;
    try {
      const p = v.play() as Promise<void> | undefined;
      // refused: it wasn't a tap the phone counts, so it's tried again on the next one
      p?.then?.(
        () => {
          unlocked.add(v);
          if (swipe) swipeUnlocks = true;
        },
        (e: unknown) => {
          if (!isNotAllowed(e)) unlocked.add(v);
          else refused();
        },
      );
    } catch {
      /* no player here (tests) */
    }
    v.pause();
    v.muted = muted;
  }
}

let installed = false;
function installUnlock() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const onTap = (e: Event) => {
    const t = e.target as Element | null;
    unlockVideoSound(
      t?.closest?.("[data-inline-video]") && t?.closest?.("[data-video-sound]")
        ? t.closest("[data-inline-video]")
        : null,
    );
  };
  // a touch that stayed put is a tap; one that moved (a swipe) is tried too, until the phone says no
  let start: { x: number; y: number } | null = null;
  window.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "touchend",
    (e) => {
      const t = e.changedTouches[0];
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) < 10) onTap(e);
      else if (start && t && swipeUnlocks !== false) unlockVideoSound(null, true);
      start = null;
    },
    { capture: true, passive: true },
  );
  window.addEventListener("click", onTap, true);
  window.addEventListener("keydown", onTap, true);
}

if (typeof window !== "undefined") installUnlock();

/** For tests: start again. */
export function resetVideoPool() {
  for (const v of known) {
    v.pause();
    v.removeAttribute("src");
    v.remove();
  }
  known.clear();
  blocked.clear();
  feedFree.length = 0;
  soundGivenAt = 0;
  swipeUnlocks = null;
  reels = null;
  feed = null;
}
