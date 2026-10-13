/**
 * iOS Safari / WebKit Audio Session (navigator.audioSession).
 *
 * The app sets the session to "ambient" for UI sounds (app-sounds.ts) and to
 * "playback" for voice notes. Neither allows the microphone: getUserMedia then
 * fails with "AudioSession category is not compatible with audio capture".
 * Every recorder switches to "play-and-record" right before asking for the
 * mic and puts the previous type back when it's done.
 *
 * No-ops where the API doesn't exist (everything except recent WebKit).
 */

export type AudioSessionType = "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";

function session(): { type: AudioSessionType } | null {
  try {
    const s = (navigator as any)?.audioSession;
    return s && "type" in s ? s : null;
  } catch {
    return null;
  }
}

/** Sets the type and returns the previous one (null when unsupported). */
export function setAudioSessionType(type: AudioSessionType): AudioSessionType | null {
  const s = session();
  if (!s) return null;
  const prev = s.type;
  try {
    s.type = type;
  } catch {
    // some versions throw while a capture is active; keep going
  }
  return prev;
}

/** Call right before getUserMedia. Returns a function that restores the previous type. */
export function prepareForCapture(): () => void {
  const prev = setAudioSessionType("play-and-record");
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (prev && prev !== "play-and-record") setAudioSessionType(prev);
  };
}

/** True for the WebKit error a wrong session type produces. */
export function isAudioSessionError(e: unknown): boolean {
  return /AudioSession|audio capture/i.test(String((e as any)?.message ?? e ?? ""));
}

/**
 * getUserMedia for audio with the session prepared. If WebKit still refuses,
 * retry once with the session on "auto". Returns the stream and the restore.
 */
export async function getMicStream(constraints: MediaTrackConstraints | boolean = true): Promise<{ stream: MediaStream; restore: () => void }> {
  let restore = prepareForCapture();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    return { stream, restore };
  } catch (e) {
    if (!isAudioSessionError(e)) {
      restore();
      throw e;
    }
    restore();
    const prev = setAudioSessionType("auto");
    restore = () => {
      if (prev && prev !== "auto") setAudioSessionType(prev);
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      return { stream, restore };
    } catch (e2) {
      restore();
      throw e2;
    }
  }
}

// ------------------------------------------------------------------ video & audio playback

/**
 * Why demo videos were sometimes silent: UI sounds put the page on "ambient"
 * (so they mix with the user's music and follow the silent switch), and on
 * iOS that category is page-wide, so a demo video or a chat video played with
 * the Ring/Silent switch on came out silent. While any media with sound is
 * on screen we hold "playback" (like YouTube: plays through the silent
 * switch) and put the page back to what it was once the last one closes.
 */
let holds = 0;
let baseType: AudioSessionType | null = null;

/** The type the page sits at when nothing is playing (app-sounds sets "ambient"). Applied later if media is holding. */
export function setBaseAudioSessionType(type: AudioSessionType) {
  if (holds > 0) baseType = type;
  else setAudioSessionType(type);
}

/** Hold "playback" while media with sound is up. Returns the release (safe to call twice). */
export function holdPlaybackSession(): () => void {
  if (holds++ === 0) baseType = setAudioSessionType("playback");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) {
      if (baseType && baseType !== "playback") setAudioSessionType(baseType);
      baseType = null;
    }
  };
}

/** For tests. */
export function playbackHolds() {
  return holds;
}

let mediaWatchInstalled = false;
/**
 * Native <video>/<audio> anywhere in the app: hold "playback" while one is
 * playing with sound (muted feed autoplays don't count; unmuting does).
 */
export function installMediaPlaybackSession(doc: Document | undefined = typeof document === "undefined" ? undefined : document) {
  if (mediaWatchInstalled || !doc) return;
  mediaWatchInstalled = true;
  const held = new WeakSet<HTMLMediaElement>();
  const audible = (el: HTMLMediaElement) => !el.paused && !el.ended && !el.muted && el.volume > 0;
  const start = (e: Event) => {
    const el = e.target as HTMLMediaElement | null;
    if (!el || typeof (el as any).paused !== "boolean" || held.has(el) || !audible(el)) return;
    held.add(el);
    const release = holdPlaybackSession();
    // On the element itself: a player removed mid-play still fires its pause
    // here (a document listener never hears a detached element).
    const stop = () => {
      if (audible(el)) return;
      for (const type of STOP_EVENTS) el.removeEventListener(type, stop);
      held.delete(el);
      release();
    };
    for (const type of STOP_EVENTS) el.addEventListener(type, stop);
  };
  for (const type of ["play", "playing", "volumechange"]) doc.addEventListener(type, start, true);
}
const STOP_EVENTS = ["pause", "ended", "emptied", "volumechange", "abort"] as const;
