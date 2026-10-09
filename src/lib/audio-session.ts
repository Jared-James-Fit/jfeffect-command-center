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
