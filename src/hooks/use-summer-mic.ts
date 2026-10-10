/**
 * Cleo's mic. Two ways to listen:
 *
 * - dictate (what the app uses): records everything until the person taps to
 *   send. Pauses never end it. Capped at `maxMs`, where it sends what it has
 *   rather than losing it. The screen is kept awake while it listens.
 * - hands-free: stops by itself when the person stops talking (a loudness gate
 *   calibrated on the first moments of room noise). Resolves null when
 *   nothing was said.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getMicStream } from "@/lib/audio-session";

export type MicTake = { blob: Blob; mime: string; durationMs: number };

type Opts = { silenceMs?: number; maxMs?: number; noSpeechMs?: number; dictate?: boolean };

/** Long dictations stay small: speech needs nothing like music bitrates. */
const SPEECH_BITS_PER_SECOND = 48_000;

/** Keeps the phone from locking mid-sentence; silently does nothing where unsupported. */
async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as any).wakeLock?.request?.("screen");
    return () => void lock?.release?.().catch(() => {});
  } catch {
    return () => {};
  }
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // keep looking
    }
  }
  return "";
}

export function micSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export function useSummerMic({ silenceMs = 1300, maxMs = 45_000, noSpeechMs = 7_000, dictate = false }: Opts = {}) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const finishRef = useRef<((keep: boolean) => void) | null>(null);

  const cleanupRef = useRef<() => void>(() => {});
  useEffect(() => () => cleanupRef.current(), []);

  /** Listen for one question. */
  const start = useCallback(async (): Promise<MicTake | null> => {
    if (!micSupported()) throw new Error("This device can't record audio here.");
    finishRef.current?.(false);
    // iOS: the app's sound effects leave the audio session in a mode that
    // can't record; getMicStream switches it for the capture and restores it.
    const { stream, restore } = await getMicStream({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: SPEECH_BITS_PER_SECOND });
    } catch {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    }
    const release = dictate ? await keepAwake() : () => {};
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    let ctx: AudioContext | null = null;
    let raf = 0;
    let timer = 0;
    let clock = 0;
    const startedAt = performance.now();
    let heardAt = 0;
    let lastLoud = 0;
    let floor = 0;
    let floorSamples = 0;
    let loudFrames = 0;

    return new Promise<MicTake | null>((resolve) => {
      let settled = false;
      const finish = (keep: boolean) => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(raf);
        window.clearTimeout(timer);
        window.clearInterval(clock);
        const stopAll = () => {
          stream.getTracks().forEach((t) => t.stop());
          restore();
          release();
          setElapsedMs(0);
          void ctx?.close().catch(() => {});
          setListening(false);
          setLevel(0);
          finishRef.current = null;
          cleanupRef.current = () => {};
        };
        // Dictation keeps anything longer than a blip: the transcriber decides
        // whether words were said, not a loudness guess (quiet voices count).
        const said = dictate ? performance.now() - startedAt > 700 : !!heardAt;
        if (!keep || !said) {
          rec.onstop = () => {
            stopAll();
            resolve(null);
          };
        } else {
          rec.onstop = () => {
            stopAll();
            resolve({ blob: new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }), mime: rec.mimeType || mime || "audio/webm", durationMs: performance.now() - startedAt });
          };
        }
        try {
          if (rec.state !== "inactive") rec.stop();
          else rec.onstop?.(new Event("stop"));
        } catch {
          stopAll();
          resolve(null);
        }
      };
      finishRef.current = finish;
      cleanupRef.current = () => finish(false);

      rec.start(250);
      setListening(true);
      setElapsedMs(0);
      clock = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 250);
      timer = window.setTimeout(() => finish(true), maxMs);

      try {
        const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
        ctx = new AC();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const now = performance.now();
          setLevel(Math.min(1, rms * 6));
          if (now - startedAt < 300) {
            floor = (floor * floorSamples + rms) / (floorSamples + 1);
            floorSamples += 1;
          } else {
            const gate = Math.min(0.09, Math.max(0.022, floor * 2.8));
            if (rms > gate) {
              loudFrames += 1;
              lastLoud = now;
              if (loudFrames >= 3 && !heardAt) heardAt = now;
            } else {
              loudFrames = 0;
            }
            if (!dictate && heardAt && now - lastLoud > silenceMs) return finish(true);
            if (!dictate && !heardAt && now - startedAt > noSpeechMs) return finish(false);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // No analyser: count it as speech; the owner taps to send.
        heardAt = performance.now();
      }
    });
  }, [silenceMs, maxMs, noSpeechMs, dictate]);

  /** Send what was said so far. */
  const stop = useCallback(() => finishRef.current?.(true), []);
  /** Throw it away. */
  const cancel = useCallback(() => finishRef.current?.(false), []);

  return { listening, level, elapsedMs, start, stop, cancel };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
