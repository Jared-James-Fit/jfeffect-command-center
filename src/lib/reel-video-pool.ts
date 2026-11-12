/**
 * The full-screen clips' video elements: REEL_SLOTS of them, made once and
 * moved from page to page (ReelsViewer), never one per clip.
 *
 * Why: an iPhone (Safari and the home-screen app) lets a video play with
 * sound only once that element was first played from a tap, and a swipe
 * isn't a tap. A new element per clip would go quiet on every swipe. The
 * tap that opens the clips (and the speaker) runs `unlockReelSound` inside
 * itself, so every pooled element is allowed sound from then on, whichever
 * clip it's showing.
 */
import { REEL_SLOTS } from "@/lib/reels";

let pool: HTMLVideoElement[] | null = null;

function make(): HTMLVideoElement {
  const v = document.createElement("video");
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.setAttribute("disableremoteplayback", "");
  v.playsInline = true;
  v.loop = true;
  v.preload = "auto";
  return v;
}

function elements(): HTMLVideoElement[] {
  if (!pool) pool = Array.from({ length: REEL_SLOTS }, make);
  return pool;
}

/** The pooled element for a page's slot. */
export function reelVideo(slot: number): HTMLVideoElement {
  const all = elements();
  return all[((slot % all.length) + all.length) % all.length];
}

/**
 * Call inside a tap: every pooled element may play with sound from now on.
 * `keep`: the one on screen, left playing (the caller plays it).
 */
export function unlockReelSound(keep?: HTMLVideoElement | null) {
  if (typeof document === "undefined") return;
  for (const v of elements()) {
    if (v === keep || !v.paused) continue;
    const muted = v.muted;
    v.muted = false;
    try {
      const p = v.play() as Promise<void> | undefined;
      p?.catch?.(() => undefined);
    } catch {
      /* no player here (tests): nothing to allow */
    }
    v.pause();
    v.muted = muted;
  }
}

/** For tests: start again. */
export function resetReelVideos() {
  pool?.forEach((v) => {
    v.pause();
    v.removeAttribute("src");
    v.remove();
  });
  pool = null;
}
