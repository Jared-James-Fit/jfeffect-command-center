/**
 * One recorder holds the microphone at a time. Starting a recording anywhere
 * first finishes the one that was running (it keeps what it heard: a voice
 * message goes to its preview, dictation to its transcript), so two recorders
 * never fight over the mic and none is left holding it open.
 */
type Holder = { id: number; finish: () => void };

let holder: Holder | null = null;
let nextId = 1;

/** Take the mic. Returns the release to call when this recording ends (safe to call twice). */
export function claimMic(finish: () => void): () => void {
  const prev = holder;
  const me: Holder = { id: nextId++, finish };
  holder = me;
  if (prev) {
    try {
      prev.finish();
    } catch {
      // the previous recorder is gone; the mic is ours either way
    }
  }
  return () => {
    if (holder?.id === me.id) holder = null;
  };
}

/** Somebody is recording right now. */
export function micInUse(): boolean {
  return holder !== null;
}

/** Tests only. */
export function _resetMicOwner() {
  holder = null;
}
