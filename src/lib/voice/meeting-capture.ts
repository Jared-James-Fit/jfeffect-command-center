/**
 * The meeting recorder (Nov 25 2026): the app's one recorder library, for a
 * whole meeting rather than a voice note. It owns the mic like every
 * recording (claimMic, getMicStream), meters real loudness into the same
 * VoiceMeter the waveform reads, and keeps the screen awake, but unlike a
 * voice note it keeps recording when the page is hidden (the coach switches
 * to the video call's tab) and it records in parts: every PART_MS the
 * recorder starts a fresh file, so each part is a complete, playable file
 * that uploads while the meeting goes on, an interruption loses at most the
 * part in progress (and that part's chunks are kept on the device: see
 * meeting-audio-store.ts), and no file is ever too big to transcribe.
 *
 * Two sources:
 *  - "room": the device's microphone hears everyone (an in-person meeting, or a
 *    call on speaker);
 *  - "call_tab": a video call in another browser tab, captured with the tab's
 *    own audio (getDisplayMedia, desktop Chrome and Edge), mixed with the mic.
 *    No page can capture another app's audio, so a call in the Zoom or Meet
 *    app, or on a phone, can't be recorded this way: upload its transcript.
 */
import { getMicStream } from "@/lib/audio-session";
import { claimMic } from "@/lib/voice/mic-owner";
import {
  isIosWebKit,
  levelFromRms,
  pickRecorderMime,
  rmsOf,
  smoothLevel,
} from "@/lib/voice/voice-meter";
import type { VoiceMeter } from "@/lib/voice/voice-capture";

export const PART_MS = 5 * 60_000;
const BITS = 48_000;

export type MeetingSource = "room" | "call_tab";
export type PartReady = {
  seq: number;
  blob: Blob;
  mime: string;
  offsetMs: number;
  durationMs: number;
};
export type MeetingCapture = {
  pause: () => void;
  resume: () => void;
  /** Finish: the last part is handed over, then the mic is let go. */
  stop: () => Promise<{ parts: number; durationMs: number }>;
  paused: () => boolean;
  /** Milliseconds recorded (pauses don't count). */
  elapsed: () => number;
};

/** Whether this browser can capture a call tab's audio. */
export function tabAudioSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const desktopChromium = /Chrome|Edg/.test(ua) && !/Mobile|Android|iPhone|iPad/.test(ua);
  return desktopChromium && !!navigator.mediaDevices?.getDisplayMedia;
}

async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as any).wakeLock?.request?.("screen");
    return () => void lock?.release?.().catch(() => {});
  } catch {
    return () => {};
  }
}

export async function startMeetingCapture(opts: {
  source: MeetingSource;
  meter: VoiceMeter;
  firstSeq: number;
  onPart: (p: PartReady) => void;
  /** every few seconds while a part records: its chunks so far (for recovery) */
  onChunk?: (seq: number, chunks: Blob[], mime: string, offsetMs: number) => void;
  /** the mic or the tab's sharing ended by itself (a call took the mic, the tab stopped sharing) */
  onInterrupted?: (why: string) => void;
}): Promise<MeetingCapture> {
  let interruptedEarly = false;
  let onReplaced: () => void = () => {
    interruptedEarly = true;
  };
  const releaseMic = claimMic(() => onReplaced());
  let mic: MediaStream | null = null;
  let restore: () => void = () => {};
  let tab: MediaStream | null = null;
  try {
    ({ stream: mic, restore } = await getMicStream({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }));
    if (opts.source === "call_tab") {
      tab = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false } as any,
        preferCurrentTab: false,
      } as any);
      if (!tab.getAudioTracks().length) {
        tab.getTracks().forEach((t) => t.stop());
        throw Object.assign(
          new Error(
            "That tab's audio wasn't shared. Pick the call's tab and turn on “Share tab audio”.",
          ),
          { name: "NoTabAudio" },
        );
      }
    }
  } catch (e) {
    mic?.getTracks().forEach((t) => t.stop());
    restore();
    releaseMic();
    throw e;
  }

  const AC: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const micSrc = ctx.createMediaStreamSource(mic!);
  micSrc.connect(dest);
  micSrc.connect(analyser);
  if (tab) {
    const tabSrc = ctx.createMediaStreamSource(new MediaStream(tab.getAudioTracks()));
    tabSrc.connect(dest);
    tabSrc.connect(analyser);
    // only the audio matters: the picture is never kept
    tab.getVideoTracks().forEach((t) => (t.enabled = false));
  }
  const stream = tab ? dest.stream : mic!;
  const ios = isIosWebKit(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0);
  const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m), ios);
  const releaseWake = await keepAwake();

  let seq = opts.firstSeq;
  let rec: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let partStartedAt = 0; // elapsed ms when this part began
  let elapsedBefore = 0; // recorded ms before the current run
  let runStarted = performance.now();
  let isPaused = false;
  let stopping = false;
  let rotateTimer = 0;
  let chunkTimer = 0;
  let raf = 0;
  const elapsed = () => elapsedBefore + (isPaused ? 0 : performance.now() - runStarted);

  const makeRecorder = () => {
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: BITS,
      });
    } catch {
      r = new MediaRecorder(stream);
    }
    return r;
  };

  /** Close the current part (if it has anything) and, unless stopping, start the next. */
  const rotate = (next: boolean): Promise<void> =>
    new Promise((resolve) => {
      const r = rec;
      if (!r || r.state === "inactive") {
        if (next && !stopping) begin();
        return resolve();
      }
      const mySeq = seq;
      const myStart = partStartedAt;
      r.onstop = () => {
        const type = r.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks, { type });
        const durationMs = elapsed() - myStart;
        chunks = [];
        if (blob.size > 0) {
          opts.onPart({ seq: mySeq, blob, mime: type, offsetMs: myStart, durationMs });
          seq = mySeq + 1;
        }
        if (next && !stopping) begin();
        resolve();
      };
      try {
        r.stop();
      } catch {
        resolve();
      }
    });

  const begin = () => {
    rec = makeRecorder();
    chunks = [];
    partStartedAt = elapsed();
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onerror = () => opts.onInterrupted?.("The recorder stopped unexpectedly.");
    rec.start(5000);
    window.clearTimeout(rotateTimer);
    rotateTimer = window.setTimeout(function tick() {
      if (isPaused) {
        rotateTimer = window.setTimeout(tick, 5000);
        return;
      }
      void rotate(true);
    }, PART_MS);
  };

  chunkTimer = window.setInterval(() => {
    if (chunks.length && rec)
      opts.onChunk?.(seq, [...chunks], rec.mimeType || mime || "audio/webm", partStartedAt);
  }, 15_000);

  const buf = new Uint8Array(analyser.fftSize);
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    opts.meter.level = isPaused ? 0 : smoothLevel(opts.meter.level, levelFromRms(rmsOf(buf), 0));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  opts.meter.active = true;
  opts.meter.startedAt = performance.now();
  opts.meter.maxMs = 6 * 3_600_000;

  const ended = (why: string) => opts.onInterrupted?.(why);
  mic!
    .getAudioTracks()
    .forEach((t) =>
      t.addEventListener("ended", () => ended("The microphone was taken by another app or call."), {
        once: true,
      }),
    );
  tab
    ?.getAudioTracks()
    .forEach((t) =>
      t.addEventListener("ended", () => ended("The call tab stopped sharing."), { once: true }),
    );
  onReplaced = () => ended("Another recording took the microphone.");

  begin();
  if (interruptedEarly) ended("Another recording took the microphone.");

  const teardown = () => {
    window.clearTimeout(rotateTimer);
    window.clearInterval(chunkTimer);
    cancelAnimationFrame(raf);
    mic?.getTracks().forEach((t) => t.stop());
    tab?.getTracks().forEach((t) => t.stop());
    restore();
    releaseWake();
    releaseMic();
    void ctx.close().catch(() => {});
    opts.meter.level = 0;
    opts.meter.active = false;
    opts.meter.startedAt = 0;
  };

  return {
    pause: () => {
      if (isPaused || !rec) return;
      elapsedBefore = elapsed();
      isPaused = true;
      try {
        rec.pause();
      } catch {
        /* an older recorder keeps going; the pause is still timed */
      }
    },
    resume: () => {
      if (!isPaused || !rec) return;
      isPaused = false;
      runStarted = performance.now();
      try {
        rec.resume();
      } catch {
        /* see pause */
      }
    },
    paused: () => isPaused,
    elapsed,
    stop: async () => {
      const total = elapsed();
      stopping = true;
      if (isPaused) {
        try {
          rec?.resume();
        } catch {
          /* fine */
        }
        isPaused = false;
      }
      await rotate(false);
      teardown();
      return { parts: seq, durationMs: total };
    },
  };
}

/**
 * A short voice sample (2–8 s) from a recorded part, as 16 kHz mono WAV: the
 * transcriber uses it to keep the same speaker label for the same voice in
 * later parts. Decoded on the device; nothing leaves it except the WAV.
 */
export async function voiceSample(
  blob: Blob,
  startSec: number,
  endSec: number,
): Promise<Blob | null> {
  try {
    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    const from = Math.max(0, startSec);
    const to = Math.min(audio.duration, Math.max(from + 2, Math.min(endSec, from + 8)));
    if (to - from < 2) return null;
    const rate = 16_000;
    const len = Math.floor((to - from) * rate);
    const OAC: typeof OfflineAudioContext =
      (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const off = new OAC(1, len, rate);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start(0, from, to - from);
    const out = await off.startRendering();
    const pcm = out.getChannelData(0);
    const wav = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const w = (o: number, s: string) =>
      [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF");
    wav.setUint32(4, 36 + pcm.length * 2, true);
    w(8, "WAVE");
    w(12, "fmt ");
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 1, true);
    wav.setUint32(24, rate, true);
    wav.setUint32(28, rate * 2, true);
    wav.setUint16(32, 2, true);
    wav.setUint16(34, 16, true);
    w(36, "data");
    wav.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++)
      wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i]!)) * 0x7fff, true);
    return new Blob([wav.buffer], { type: "audio/wav" });
  } catch {
    return null;
  }
}
