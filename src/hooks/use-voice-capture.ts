/**
 * React side of the app's one recorder (lib/voice/voice-capture.ts). The
 * state changes only at the edges (ready → requesting → recording →
 * processing → ready); the live level and the clock are in `meter`, read by
 * the waveform and timer on their own animation frames, so nothing here
 * re-renders while someone talks. Unmounting throws the take away and lets go
 * of the mic.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createMeter, micSupported, startCapture, type Capture, type VoiceEndReason, type VoiceTake } from "@/lib/voice/voice-capture";

export type CaptureState = "ready" | "requesting" | "recording" | "processing";

export type UseVoiceCaptureOptions = {
  maxMs: number;
  constraints?: MediaTrackConstraints | boolean;
  /** The take ended without a tap (the cap, the app backgrounded, a call, another recorder). */
  onAutoEnd?: (reason: VoiceEndReason) => void;
};

export function useVoiceCapture({ maxMs, constraints, onAutoEnd }: UseVoiceCaptureOptions) {
  const [state, setState] = useState<CaptureState>("ready");
  const meterRef = useRef(createMeter());
  const capRef = useRef<Capture | null>(null);
  const autoRef = useRef(onAutoEnd);
  autoRef.current = onAutoEnd;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      capRef.current?.cancel();
      capRef.current = null;
    };
  }, []);

  /**
   * Open the mic and start a take. Resolves once it's recording, with `done`,
   * the take's own promise (the audio when it ends, by a tap or by itself; null
   * when cancelled). Throws if the mic couldn't open.
   */
  const begin = useCallback(async (): Promise<{ done: Promise<VoiceTake | null> }> => {
    if (capRef.current) return { done: Promise.resolve(null) };
    setState("requesting");
    let cap: Capture;
    try {
      cap = await startCapture({
        maxMs,
        constraints,
        meter: meterRef.current,
        onRecording: () => alive.current && setState("recording"),
        onAutoEnd: (r) => {
          if (alive.current) setState("processing");
          autoRef.current?.(r);
        },
      });
    } catch (e) {
      if (alive.current) setState("ready");
      throw e;
    }
    if (!alive.current) {
      cap.cancel();
      return { done: Promise.resolve(null) };
    }
    capRef.current = cap;
    // (wrapped in an object: a promise returned from an async function would be waited on)
    return {
      done: cap.done.finally(() => {
        if (capRef.current === cap) capRef.current = null;
        if (alive.current) setState("ready");
      }),
    };
  }, [maxMs, constraints]);

  /** Record one take start to end (begin, then wait for it). */
  const record = useCallback(async (): Promise<VoiceTake | null> => (await begin()).done, [begin]);

  /** Finish and keep it (the take arrives through record()). */
  const stop = useCallback(() => {
    if (!capRef.current) return;
    setState("processing");
    capRef.current.stop();
  }, []);

  /** Throw it away. */
  const cancel = useCallback(() => {
    capRef.current?.cancel();
  }, []);

  return { state, meter: meterRef.current, begin, record, stop, cancel, supported: typeof window !== "undefined" && micSupported() };
}

export type VoiceCaptureHandle = ReturnType<typeof useVoiceCapture>;
