/**
 * The app's one voice-recording vocabulary (pure, tested in voice-recording.test.ts):
 * the states every recorder moves through, how the microphone's real loudness
 * becomes a bar on screen, the saved waveform of a voice message, the clock,
 * the recorder format and what a failure says. Used by the capture engine
 * (voice-capture.ts), the waveform (components/voice) and every place a voice
 * is recorded: Cleo, pain, Tell Cleo / Adjust program, chats, Crew voice memos.
 */

/**
 * ready → requesting (the permission prompt / the mic opening) → recording →
 * processing (the recorder handing over the audio) → transcribing (dictation
 * only) → completed, or error from any of them.
 */
export type VoiceState = "ready" | "requesting" | "recording" | "processing" | "transcribing" | "completed" | "error";

/** What a recording is for: dictation's audio is only ever held to be turned into words; a voice message is kept. */
export type VoicePurpose = "dictation" | "voice-message";

/** Loudness of one analyser frame (byte time-domain data, 128 = silence), 0..1. */
export function rmsOf(buf: ArrayLike<number>): number {
  if (!buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

/**
 * A frame's loudness as a bar height, 0..1: anything at or under the room's
 * floor is 0 (silence stays calm, never a jitter), then a gentle curve so a
 * normal speaking voice fills most of the height and a shout doesn't clip
 * everything to the top. Real amplitude only: no level is ever invented.
 */
export function levelFromRms(rms: number, floor = 0): number {
  const gate = Math.max(0.008, floor * 1.4);
  if (!(rms > gate)) return 0;
  const over = (rms - gate) / (0.32 - gate);
  return Math.max(0, Math.min(1, Math.sqrt(Math.max(0, over))));
}

/**
 * Smooths the level frame to frame: it rises quickly with the voice and falls
 * back slowly, so the bars move like speech rather than flicker.
 */
export function smoothLevel(prev: number, next: number, attack = 0.55, release = 0.14): number {
  const k = next > prev ? attack : release;
  const v = prev + (next - prev) * k;
  return v < 0.002 ? 0 : Math.min(1, v);
}

/** Running estimate of the room's noise from the first moments (and quiet stretches) of a recording. */
export function updateFloor(floor: number, rms: number, samples: number): number {
  if (samples <= 0) return rms;
  return (floor * samples + rms) / (samples + 1);
}

/** A voice message's saved waveform: the take's levels as `count` bars (each the loudest of its slice). */
export function downsamplePeaks(raw: readonly number[], count = 48): number[] {
  if (!raw.length || count <= 0) return [];
  const out: number[] = [];
  const step = raw.length / count;
  for (let i = 0; i < count; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.min(raw.length, Math.floor((i + 1) * step)));
    let max = 0;
    for (let j = a; j < b && j < raw.length; j++) if (raw[j] > max) max = raw[j];
    out.push(Number(max.toFixed(3)));
  }
  return out;
}

/**
 * Bar heights in pixels for the live waveform: the newest level on the right,
 * every bar at least `min` tall (a calm line in silence), rounded to whole
 * pixels so the canvas stays crisp.
 */
export function barHeights(levels: readonly number[], count: number, max: number, min = 3): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = levels[levels.length - count + i] ?? 0;
    out.push(Math.round(min + Math.max(0, Math.min(1, v)) * (max - min)));
  }
  return out;
}

/** "0:07", "1:42", "12:03". */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The recorder format. iPhones and iPads (WebKit, the installed app's web
 * view too) get MP4/AAC first, which every player plays back; everything else
 * WebM/Opus. Speech-to-text takes either.
 */
export function pickRecorderMime(isTypeSupported: (m: string) => boolean, iosWebKit: boolean): string {
  const order = iosWebKit
    ? ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac"];
  for (const m of order) {
    try {
      if (isTypeSupported(m)) return m;
    } catch {
      // keep looking
    }
  }
  return "";
}

export function isIosWebKit(ua: string, platform = "", maxTouchPoints = 0): boolean {
  return /iP(?:hone|ad|od)/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}

/** Why the microphone couldn't be used, in words a person can act on. */
export function micErrorMessage(e: unknown): string {
  const err = e as { name?: string; message?: string } | null;
  const name = err?.name ?? "";
  const msg = String(err?.message ?? "");
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return "The microphone is off for JF Effect. Turn it on in your browser or phone settings, or type it.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError")
    return "No microphone was found on this device. Type it instead.";
  if (name === "NotReadableError" || name === "AbortError" || name === "InvalidStateError" || /audio ?session|interrupt/i.test(msg))
    return "Your phone's audio is busy (music or a call?). Pause it and tap the mic again.";
  if (name === "NotSupportedError" || /not supported/i.test(msg)) return "This device can't record audio here. Type it instead.";
  return msg && msg.length < 140 ? msg : "Couldn't use the microphone. Type it instead.";
}

/** A permission refusal: retrying the same tap won't help until they change the setting. */
export function isMicDenied(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError";
}
