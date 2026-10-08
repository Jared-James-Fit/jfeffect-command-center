/**
 * Hands-free mic for Summer: records one spoken question and stops by itself
 * when the owner stops talking (or taps). Resolves null when nothing was said.
 *
 * Voice activity is a simple loudness gate calibrated on the first moments of
 * room noise: good enough for "talk, pause, she answers", no extra library.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type MicTake = { blob: Blob; mime: string; durationMs: number };

type Opts = { silenceMs?: number; maxMs?: number; noSpeechMs?: number };

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

export function useSummerMic({ silenceMs = 1300, maxMs = 45_000, noSpeechMs = 7_000 }: Opts = {}) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const finishRef = useRef<((keep: boolean) => void) | null>(null);

  const cleanupRef = useRef<() => void>(() => {});
  useEffect(() => () => cleanupRef.current(), []);

  /** Listen for one question. */
  const start = useCallback(async (): Promise<MicTake | null> => {
    if (!micSupported()) throw new Error("This device can't record audio here.");
    finishRef.current?.(false);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    let ctx: AudioContext | null = null;
    let raf = 0;
    let timer = 0;
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
        const stopAll = () => {
          stream.getTracks().forEach((t) => t.stop());
          void ctx?.close().catch(() => {});
          setListening(false);
          setLevel(0);
          finishRef.current = null;
          cleanupRef.current = () => {};
        };
        if (!keep || !heardAt) {
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
            if (heardAt && now - lastLoud > silenceMs) return finish(true);
            if (!heardAt && now - startedAt > noSpeechMs) return finish(false);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // No analyser: count it as speech; the owner taps to send.
        heardAt = performance.now();
      }
    });
  }, [silenceMs, maxMs, noSpeechMs]);

  /** Send what was said so far. */
  const stop = useCallback(() => finishRef.current?.(true), []);
  /** Throw it away. */
  const cancel = useCallback(() => finishRef.current?.(false), []);

  return { listening, level, start, stop, cancel };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
