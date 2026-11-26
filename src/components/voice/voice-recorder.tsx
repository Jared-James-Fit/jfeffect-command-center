/**
 * The recording controls every voice input uses (design system: build new
 * voice features from these and `useVoiceDictation` / `useVoiceCapture`):
 *
 *   VoiceMicButton      the mic; a stop square while recording; a spinner while
 *                       the mic opens or the words are coming back
 *   VoiceRecordingBar   cancel · ● time · live waveform · done, compact (a
 *                       composer's row) or expanded (more room for the wave)
 *   VoiceStatusLine     one line under a box: waiting for the mic, recording
 *                       (waveform, time, cancel), turning it into words, added,
 *                       or why it didn't work with Try again
 *
 * JF red only for what's live (the recording dot, a recording mic); the rest
 * is neutral and follows light and dark.
 */
import type { ReactNode } from "react";
import { Check, Loader2, Mic, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceMeter } from "@/lib/voice/voice-capture";
import type { VoiceState } from "@/lib/voice/voice-meter";
import { VoiceTimer, VoiceWaveform } from "@/components/voice/voice-waveform";
import type { VoiceDictation } from "@/hooks/use-voice-dictation";

const BUSY: VoiceState[] = ["requesting", "processing", "transcribing"];

export function VoiceMicButton({
  state,
  onClick,
  disabled,
  size = "md",
  variant = "muted",
  className,
  label,
}: {
  state: VoiceState;
  onClick: () => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  /** muted: a grey tile; quiet: an icon only; solid: the brand button. */
  variant?: "muted" | "quiet" | "solid";
  className?: string;
  label?: string;
}) {
  const recording = state === "recording";
  const busy = BUSY.includes(state);
  const box = size === "sm" ? "h-9 w-9" : size === "lg" ? "h-12 w-12" : "h-11 w-11";
  const icon = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors active:scale-95 disabled:cursor-default disabled:opacity-60",
        box,
        recording
          ? "bg-primary text-primary-foreground"
          : variant === "solid"
            ? "bg-primary text-primary-foreground"
            : variant === "quiet"
              ? "text-muted-foreground hover:text-foreground"
              : "bg-muted text-foreground hover:bg-secondary",
        className,
      )}
      aria-label={recording ? "Stop and use what I said" : label ?? "Say it instead of typing"}
      title={recording ? "Tap to finish" : "Speak"}
      data-voice-mic={state}
    >
      {busy ? <Loader2 className={cn(icon, "animate-spin")} /> : recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className={icon} />}
    </button>
  );
}

export function VoiceRecordingBar({
  meter,
  onCancel,
  onDone,
  done = "check",
  layout = "compact",
  className,
  doneLabel = "Done",
}: {
  meter: VoiceMeter;
  onCancel: () => void;
  onDone: () => void;
  /** check: done turns it into text / a preview; stop: the same, said as stop. */
  done?: "check" | "stop";
  layout?: "compact" | "expanded";
  className?: string;
  doneLabel?: string;
}) {
  const cancelBtn = (
    <button
      type="button"
      onClick={onCancel}
      className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Cancel recording"
      title="Cancel"
      data-voice-cancel
    >
      <X className="h-5 w-5" />
    </button>
  );
  const doneBtn = (
    <button
      type="button"
      onClick={onDone}
      className={cn(
        "grid shrink-0 cursor-pointer place-items-center rounded-full bg-foreground text-background hover:opacity-90 active:scale-95",
        layout === "expanded" ? "h-12 w-12" : "h-10 w-10",
      )}
      aria-label={doneLabel}
      title={doneLabel}
      data-voice-done
    >
      {done === "stop" ? <Square className="h-4 w-4 fill-current" /> : <Check className="h-5 w-5" strokeWidth={2.5} />}
    </button>
  );
  const clock = (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden />
      <VoiceTimer meter={meter} />
    </span>
  );
  if (layout === "expanded")
    return (
      <div className={cn("flex flex-col gap-2", className)} role="status" aria-live="polite" aria-label="Recording" data-voice-recording="expanded">
        <VoiceWaveform meter={meter} height={48} className="text-foreground" />
        <div className="flex items-center gap-2">
          {cancelBtn}
          <span className="flex flex-1 justify-center">{clock}</span>
          {doneBtn}
        </div>
      </div>
    );
  return (
    <div className={cn("flex min-h-11 items-center gap-2", className)} role="status" aria-live="polite" aria-label="Recording" data-voice-recording="compact">
      {cancelBtn}
      {clock}
      <VoiceWaveform meter={meter} height={28} className="flex-1 text-foreground" />
      {doneBtn}
    </div>
  );
}

/** One line under a box for dictation's states (nothing while ready unless `idle` is given). */
export function VoiceStatusLine({ voice, className, idle, stopHint = "tap the square when you're done" }: { voice: VoiceDictation; className?: string; idle?: ReactNode; stopHint?: string }) {
  const s = voice.state;
  if (s === "requesting")
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)} role="status" data-voice-status="requesting">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Waiting for the microphone…
      </div>
    );
  if (s === "recording")
    return (
      <div className={cn("flex min-h-9 items-center gap-2 text-xs text-muted-foreground", className)} role="status" aria-live="polite" data-voice-status="recording">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden />
        <VoiceTimer meter={voice.meter} className="shrink-0 font-medium" />
        <VoiceWaveform meter={voice.meter} height={22} className="min-w-[64px] flex-1 text-foreground" />
        <span className="hidden shrink-0 min-[380px]:inline">{stopHint}</span>
        <button type="button" onClick={voice.cancel} className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-muted hover:text-foreground" aria-label="Cancel recording" data-voice-cancel>
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  if (s === "processing" || s === "transcribing")
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)} role="status" data-voice-status={s}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Turning what you said into words…
      </div>
    );
  if (s === "completed")
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)} role="status" data-voice-status="completed">
        <Check className="h-3.5 w-3.5 text-success" strokeWidth={3} aria-hidden /> Added. Check it before you send.
      </div>
    );
  if (s === "error" && voice.fail)
    return (
      <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground", className)} role="alert" data-voice-status="error">
        <span className="min-w-0 flex-1">{voice.fail.message}</span>
        {voice.fail.canRetry && (
          <button type="button" onClick={voice.retry} className="cursor-pointer font-semibold underline underline-offset-2" data-voice-retry>
            Try again
          </button>
        )}
        <button type="button" onClick={voice.dismiss} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  return idle ? <>{idle}</> : null;
}
