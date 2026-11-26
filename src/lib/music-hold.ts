/**
 * Only one piece of music at a time. Background music (the Rankings theme)
 * listens here and fades out while anything else with sound plays, then comes
 * back when it stops:
 *  - something with music of its own on screen (the Monthly Recap story)
 *    takes a hold directly (`holdBackgroundMusic`);
 *  - media that holds the page's "playback" session (a demo video, a voice
 *    memo, a chat video: audio-session.ts) takes one through it;
 *  - and any <video> / <audio> in the page playing with its sound on (a feed
 *    clip on "ambient" included) takes one while it plays
 *    (`installMediaMusicHold`, from the music itself the first time it plays).
 */
const EVENT = "jf:music-hold";
let holds = 0;

/** Hold the background music; call the returned function (once) to let it go. */
export function holdBackgroundMusic(): () => void {
  holds++;
  announce();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    announce();
  };
}

export function backgroundMusicHeld(): boolean {
  return holds > 0;
}

/** Called with true while something holds the music, false once nothing does. */
export function onBackgroundMusicHold(fn: (held: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = () => fn(holds > 0);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

function announce() {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* old browser */ }
}

let mediaWatch = false;
/**
 * Any <video>/<audio> in the document playing with sound holds the music
 * while it plays (muted clips don't; unmuting one does). The release is on the
 * element itself, so a player taken off the page mid-play still lets go.
 */
export function installMediaMusicHold(doc: Document | undefined = typeof document === "undefined" ? undefined : document) {
  if (mediaWatch || !doc) return;
  mediaWatch = true;
  const releases = new Map<HTMLMediaElement, () => void>();
  const audible = (el: HTMLMediaElement) => !el.paused && !el.ended && !el.muted && el.volume > 0;
  const check = (el: HTMLMediaElement) => {
    const now = audible(el);
    const held = releases.get(el);
    if (now && !held) {
      releases.set(el, holdBackgroundMusic());
      for (const type of STOP_EVENTS) el.addEventListener(type, onStop);
    } else if (!now && held) {
      held();
      releases.delete(el);
      for (const type of STOP_EVENTS) el.removeEventListener(type, onStop);
    }
  };
  function onStop(this: HTMLMediaElement) {
    check(this);
  }
  const start = (e: Event) => {
    const el = e.target as HTMLMediaElement | null;
    if (!el || typeof (el as { paused?: unknown }).paused !== "boolean") return;
    check(el);
  };
  for (const type of ["play", "playing", "volumechange"]) doc.addEventListener(type, start, true);
}
const STOP_EVENTS = ["pause", "ended", "emptied", "volumechange", "abort"] as const;
