/**
 * Speak instead of typing, the same everywhere (Cleo, pain, Tell Cleo /
 * Adjust program, nutrition and cardio changes): tap the mic, speak (the live
 * waveform and the time), tap to finish, and the words land in the box to
 * read and change before anything is sent. The recording is temporary: it's
 * held in memory only to be turned into words, and when that fails it's kept
 * (never stored anywhere) so Try again doesn't ask them to say it twice; it's
 * dropped on success, dismiss, a new recording or leaving the screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceCapture } from "@/hooks/use-voice-capture";
import { blobToBase64, type VoiceTake } from "@/lib/voice/voice-capture";
import { micErrorMessage, type VoiceState } from "@/lib/voice/voice-meter";
import { feedback } from "@/lib/feedback";

export type TranscribeResult = { ok: true; text: string } | { ok: false; reason: string };
export type Transcribe = (audio: string, mime: string) => Promise<TranscribeResult>;

export type DictationFail = { message: string; canRetry: boolean };

/** Under this, a take is a slip of the finger: no transcriber call. */
const MIN_TAKE_MS = 700;
/** How long "completed" shows before the mic is ready again. */
const COMPLETED_MS = 2200;

export function useVoiceDictation({
  transcribe,
  onText,
  maxMs,
  tooShort = "That was too short. Tap the mic, say it, then tap again to finish.",
}: {
  transcribe: Transcribe | null;
  onText: (text: string) => void;
  maxMs: number;
  tooShort?: string;
}) {
  const capture = useVoiceCapture({ maxMs });
  const [phase, setPhase] = useState<"idle" | "transcribing" | "completed" | "error">("idle");
  const [fail, setFail] = useState<DictationFail | null>(null);
  const kept = useRef<VoiceTake | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;
  const doneTimer = useRef(0);
  useEffect(() => () => {
    window.clearTimeout(doneTimer.current);
    kept.current = null;
  }, []);

  const hear = useCallback(async (take: VoiceTake) => {
    const t = transcribeRef.current;
    if (!t) return;
    setFail(null);
    setPhase("transcribing");
    try {
      const r = await t(await blobToBase64(take.blob), take.mime);
      if (r.ok && r.text.trim()) {
        kept.current = null;
        feedback("tap");
        onTextRef.current(r.text.trim());
        setPhase("completed");
        window.clearTimeout(doneTimer.current);
        doneTimer.current = window.setTimeout(() => setPhase((p) => (p === "completed" ? "idle" : p)), COMPLETED_MS);
      } else if (r.ok) {
        kept.current = null;
        setFail({ message: "Didn't catch any words. Try again a little closer, or type it.", canRetry: false });
        setPhase("error");
      } else {
        kept.current = take;
        setFail({ message: r.reason, canRetry: true });
        setPhase("error");
      }
    } catch {
      kept.current = take;
      setFail({ message: "Couldn't send that. Check your connection and try again.", canRetry: true });
      setPhase("error");
    }
  }, []);

  const start = useCallback(async () => {
    if (!transcribeRef.current || capture.state !== "ready" || phase === "transcribing") return;
    feedback("press");
    kept.current = null;
    setFail(null);
    setPhase("idle");
    window.clearTimeout(doneTimer.current);
    try {
      const take = await capture.record();
      if (!take) return; // cancelled
      if (take.durationMs < MIN_TAKE_MS) {
        setFail({ message: tooShort, canRetry: false });
        setPhase("error");
        return;
      }
      await hear(take);
    } catch (e) {
      setFail({ message: micErrorMessage(e), canRetry: false });
      setPhase("error");
    }
  }, [capture, phase, hear, tooShort]);

  const state: VoiceState =
    capture.state === "requesting" ? "requesting"
    : capture.state === "recording" ? "recording"
    : capture.state === "processing" ? "processing"
    : phase === "transcribing" ? "transcribing"
    : phase === "completed" ? "completed"
    : phase === "error" ? "error"
    : "ready";

  return {
    supported: capture.supported && !!transcribe,
    state,
    meter: capture.meter,
    maxMs,
    fail,
    start,
    /** Done talking: turn it into words. */
    finish: capture.stop,
    /** Mic button: start, or finish while recording. */
    toggle: () => (capture.state === "recording" ? capture.stop() : void start()),
    /** Throw the take away. */
    cancel: () => {
      capture.cancel();
      kept.current = null;
      setFail(null);
      setPhase("idle");
    },
    /** Send the kept recording again. */
    retry: () => {
      if (kept.current) void hear(kept.current);
    },
    dismiss: () => {
      kept.current = null;
      setFail(null);
      setPhase("idle");
    },
  };
}

export type VoiceDictation = ReturnType<typeof useVoiceDictation>;
