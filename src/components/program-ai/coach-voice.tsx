/**
 * Speak instead of typing (coaches): tap the mic, say it, tap again; the words
 * land in the box to read and change before anything is sent. Recorded with
 * the app's own mic (useSummerMic: the right format for iPhones and the
 * installed app, the screen kept awake, two minutes at most), turned into
 * words by transcribeCoachVoiceFn (OpenAI). A take that couldn't be turned
 * into words is kept with Try again, never lost. Where a phone can't record
 * (no mic, a browser without MediaRecorder) the mic simply isn't shown:
 * typing always works.
 */
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { blobToBase64, micSupported, useSummerMic, type MicTake } from "@/hooks/use-summer-mic";
import { transcribeCoachVoiceFn } from "@/lib/program-ai/voice.functions";
import { feedback } from "@/lib/feedback";

export function useCoachVoice(onText: (text: string) => void, feature: "program_edit" | "program_notes" = "program_edit") {
  const mic = useSummerMic({ dictate: true, maxMs: 120_000 });
  const hearFn = useServerFn(transcribeCoachVoiceFn);
  const [recording, setRecording] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [fail, setFail] = useState<{ message: string; take: MicTake | null } | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const supported = typeof window !== "undefined" && micSupported();

  const hear = async (take: MicTake) => {
    setFail(null);
    setHearing(true);
    try {
      const r = await hearFn({ data: { audio: await blobToBase64(take.blob), mime: take.mime, feature } });
      if (r.ok && r.text.trim()) {
        feedback("tap");
        onTextRef.current(r.text.trim());
      } else if (r.ok) setFail({ message: "Didn't catch any words. Try again a little closer to the phone, or type it.", take: null });
      else setFail({ message: r.reason, take });
    } catch {
      setFail({ message: "Couldn't send that. Check your connection and try again.", take });
    } finally {
      setHearing(false);
    }
  };

  const toggle = async () => {
    if (recording) {
      mic.stop();
      return;
    }
    feedback("tap");
    setFail(null);
    setRecording(true);
    const began = Date.now();
    try {
      const take = await mic.start();
      setRecording(false);
      if (!take) {
        if (Date.now() - began < 1500) setFail({ message: "That was too short. Tap the mic, say it, then tap the square.", take: null });
        return;
      }
      await hear(take);
    } catch (e: any) {
      const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
      setFail({ message: denied ? "The microphone is off for JF Effect. Turn it on in your browser or phone settings, or type it." : (e?.message ?? "Couldn't use the microphone. Type it instead."), take: null });
    } finally {
      setRecording(false);
    }
  };

  return {
    supported,
    recording,
    hearing,
    level: mic.level,
    seconds: Math.floor(mic.elapsedMs / 1000),
    fail,
    toggle,
    retry: () => (fail?.take ? hear(fail.take) : undefined),
    dismiss: () => setFail(null),
  };
}

export type CoachVoice = ReturnType<typeof useCoachVoice>;

export function VoiceButton({ voice, className, disabled }: { voice: CoachVoice; className?: string; disabled?: boolean }) {
  if (!voice.supported) return null;
  return (
    <button
      type="button"
      onClick={() => void voice.toggle()}
      disabled={disabled || voice.hearing}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50",
        voice.recording ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-secondary",
        className,
      )}
      aria-label={voice.recording ? "Stop and use what I said" : "Say it instead of typing"}
      title={voice.recording ? "Tap to finish" : "Speak"}
      data-coach-voice
    >
      {voice.hearing ? <Loader2 className="h-4 w-4 animate-spin" /> : voice.recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
    </button>
  );
}

/** One line under the box: listening (with the level and the seconds), turning it into words, or why it didn't work. */
export function VoiceStatus({ voice, className }: { voice: CoachVoice; className?: string }) {
  if (voice.recording)
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)} role="status" data-coach-voice-status="listening">
        <span className="flex h-4 items-center gap-[3px]" aria-hidden>
          {[0.55, 0.85, 1, 0.85, 0.55].map((k, i) => (
            <span key={i} className="w-[3px] rounded-full bg-foreground transition-[height] duration-100" style={{ height: `${Math.round(3 + Math.min(1, voice.level * 1.4) * k * 13)}px` }} />
          ))}
        </span>
        Listening · {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, "0")} · tap the square when you're done
      </div>
    );
  if (voice.hearing) return <div className={cn("text-xs text-muted-foreground", className)} role="status" data-coach-voice-status="hearing">Turning what you said into words…</div>;
  if (voice.fail)
    return (
      <div className={cn("flex flex-wrap items-center gap-x-2 text-xs text-warning", className)} role="alert" data-coach-voice-status="failed">
        <span>{voice.fail.message}</span>
        {voice.fail.take && (
          <button type="button" onClick={() => void voice.retry()} className="font-semibold underline underline-offset-2">
            Try again
          </button>
        )}
      </div>
    );
  return null;
}
