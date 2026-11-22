/**
 * Only one piece of music at a time. Background music (the Rankings themes)
 * listens here and fades out while something with music of its own is on
 * screen (the Monthly Recap story), then comes back when it closes.
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
