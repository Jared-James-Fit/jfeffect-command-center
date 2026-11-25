/**
 * The app's one microphone recorder (every voice recording: Cleo, pain,
 * Tell Cleo / Adjust program, chats' voice messages, Crew voice memos). It
 * opens the mic (through getMicStream, which prepares iOS's audio session),
 * records with MediaRecorder, and measures the real loudness with one
 * AnalyserNode into `meter`, a plain object the waveform reads each frame:
 * nothing re-renders React per frame. It owns the mic exclusively (mic-owner),
 * keeps the screen awake while it records, and always lets go of the mic:
 * on stop, cancel, the page hidden (backgrounded), the track ended (a call,
 * a headset unplugged, iOS taking the mic) or the audio interrupted; in every
 * case but cancel it keeps what was said.
 */
import { getMicStream } from "@/lib/audio-session";
import { claimMic } from "@/lib/voice/mic-owner";
import { isIosWebKit, levelFromRms, pickRecorderMime, rmsOf, smoothLevel, updateFloor, downsamplePeaks } from "@/lib/voice/voice-meter";

export type VoiceTake = {
  blob: Blob;
  mime: string;
  durationMs: number;
  /** The take's waveform for a voice message (48 bars, 0..1). */
  peaks: number[];
};

/** Why a take ended. Only "user" is a tap; the rest finished it for them. */
export type VoiceEndReason = "user" | "limit" | "interrupted" | "hidden" | "replaced";

/** Read every frame by the waveform; written only by the capture. */
export type VoiceMeter = {
  /** Smoothed loudness now, 0..1 (0 in silence). */
  level: number;
  /** performance.now() when recording began, 0 when not recording. */
  startedAt: number;
  /** The cap, for "· 12s left". */
  maxMs: number;
  active: boolean;
};

export function createMeter(): VoiceMeter {
  return { level: 0, startedAt: 0, maxMs: 0, active: false };
}

export function micSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/** Speech needs nothing like music bitrates: long takes stay small. */
const SPEECH_BITS_PER_SECOND = 48_000;

async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as any).wakeLock?.request?.("screen");
    return () => void lock?.release?.().catch(() => {});
  } catch {
    return () => {};
  }
}

export type CaptureOptions = {
  maxMs: number;
  /** Mic constraints: dictation and voice messages keep the call processing (speech into a mic is what it's for). */
  constraints?: MediaTrackConstraints | boolean;
  meter: VoiceMeter;
  /** The mic is open and recording (the permission prompt, if any, is answered). */
  onRecording?: () => void;
  /** The take ended without a tap (the cap, backgrounding, an interruption, another recorder). */
  onAutoEnd?: (reason: VoiceEndReason) => void;
};

export type Capture = {
  /** Resolves when the take ends: the audio, or null when cancelled or empty. */
  done: Promise<VoiceTake | null>;
  /** Finish and keep it. */
  stop: () => void;
  /** Throw it away. */
  cancel: () => void;
};

/**
 * Open the mic and record one take. Rejects (permission refused, no mic, the
 * audio session busy) before anything records; once it resolves the take is
 * running and `done` says how it ended.
 */
export async function startCapture(opts: CaptureOptions): Promise<Capture> {
  if (!micSupported()) {
    const e = new Error("This device can't record audio here.");
    e.name = "NotSupportedError";
    throw e;
  }
  const { meter } = opts;
  // The mic is claimed before it opens, so a recorder already running lets go first.
  let onReplaced: () => void = () => {
    replacedEarly = true;
  };
  let replacedEarly = false;
  const releaseMic = claimMic(() => onReplaced());
  let stream!: MediaStream;
  let restore!: () => void;
  try {
    ({ stream, restore } = await getMicStream(opts.constraints ?? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }));
  } catch (e) {
    releaseMic();
    throw e;
  }
  const ios = isIosWebKit(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0);
  const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m), ios);
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: SPEECH_BITS_PER_SECOND });
  } catch {
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      restore();
      releaseMic();
      throw e;
    }
  }
  const releaseWake = await keepAwake();
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let ctx: AudioContext | null = null;
  let raf = 0;
  let limit = 0;
  const raw: number[] = [];
  let lastPeakAt = 0;
  let floor = 0;
  let floorSamples = 0;
  const startedAt = performance.now();
  let settled = false;
  let resolveDone!: (t: VoiceTake | null) => void;
  const done = new Promise<VoiceTake | null>((r) => (resolveDone = r));

  const teardown = () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(limit);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    stream.getTracks().forEach((t) => t.stop());
    restore();
    releaseWake();
    releaseMic();
    void ctx?.close().catch(() => {});
    ctx = null;
    meter.level = 0;
    meter.startedAt = 0;
    meter.active = false;
  };

  const finish = (keep: boolean, reason: VoiceEndReason) => {
    if (settled) return;
    settled = true;
    const durationMs = performance.now() - startedAt;
    if (reason !== "user" && keep) opts.onAutoEnd?.(reason);
    rec.onstop = () => {
      teardown();
      if (!keep || !chunks.length) return resolveDone(null);
      const type = rec.mimeType || mime || "audio/webm";
      resolveDone({ blob: new Blob(chunks, { type }), mime: type, durationMs, peaks: downsamplePeaks(raw, 48) });
    };
    try {
      if (rec.state !== "inactive") rec.stop();
      else rec.onstop?.(new Event("stop"));
    } catch {
      teardown();
      resolveDone(null);
    }
  };

  onReplaced = () => finish(true, "replaced");
  const onVisibility = () => {
    if (document.visibilityState === "hidden") finish(true, "hidden");
  };
  const onPageHide = () => finish(true, "hidden");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  for (const t of stream.getAudioTracks()) t.addEventListener("ended", () => finish(true, "interrupted"), { once: true });
  rec.onerror = () => finish(true, "interrupted");

  rec.start(250);
  meter.startedAt = startedAt;
  meter.maxMs = opts.maxMs;
  meter.level = 0;
  meter.active = true;
  limit = window.setTimeout(() => finish(true, "limit"), opts.maxMs);

  try {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    ctx = new AC();
    const audio = ctx;
    // Safari: a phone call or Siri interrupts the context; keep what was said.
    audio.onstatechange = () => {
      if ((audio.state as string) === "interrupted") finish(true, "interrupted");
    };
    const src = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (settled) return;
      analyser.getByteTimeDomainData(buf);
      const rms = rmsOf(buf);
      const now = performance.now();
      // the room's own noise from the first 300 ms: silence then draws as silence
      if (now - startedAt < 300) floor = updateFloor(floor, rms, floorSamples++);
      meter.level = smoothLevel(meter.level, levelFromRms(rms, floor));
      if (now - lastPeakAt > 80) {
        raw.push(meter.level);
        lastPeakAt = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  } catch {
    // no analyser: it still records; the waveform stays calm
  }
  opts.onRecording?.();
  // another recording started while this one was still opening the mic: it wins
  if (replacedEarly) finish(false, "replaced");

  return { done, stop: () => finish(true, "user"), cancel: () => finish(false, "user") };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
