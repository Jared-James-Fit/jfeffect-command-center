import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Mic, Pause, Play, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LiveWaveform, WaveformBars, fakePeaks, useVoiceRecorder } from "@/components/chat-shared";
import { VOICE_MAX_SECONDS } from "@/lib/community-media";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * A voice memo, played in place: play / pause, a waveform you can tap to
 * jump, and the time. Starts inside the tap (iOS only plays audio a tap
 * started).
 */
export function VoiceMemoPlayer({ src, duration, seed = 1, className }: { src: string | null; duration: number | null | undefined; seed?: number; className?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const total = duration && duration > 0 ? duration : 0;
  const peaks = useMemo(() => fakePeaks(32, seed), [seed]);
  useEffect(() => () => audio.current?.pause(), []);

  const toggle = () => {
    if (!src) return;
    let a = audio.current;
    if (!a) {
      a = new Audio(src);
      a.preload = "auto";
      a.ontimeupdate = () => setAt(a!.currentTime);
      a.onended = () => {
        setPlaying(false);
        setAt(0);
      };
      a.onpause = () => setPlaying(false);
      a.onplay = () => setPlaying(true);
      audio.current = a;
    }
    if (a.paused) a.play().catch(() => toast.error("That voice memo couldn't play"));
    else a.pause();
  };
  const seek = (ratio: number) => {
    const a = audio.current;
    if (!a || !total) return;
    a.currentTime = ratio * total;
    setAt(a.currentTime);
  };

  return (
    <div data-voice-memo className={cn("flex w-[230px] max-w-full items-center gap-2.5 rounded-2xl bg-muted/70 py-1.5 pl-1.5 pr-3", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        disabled={!src}
        aria-label={playing ? "Pause voice memo" : "Play voice memo"}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground active:scale-95 disabled:opacity-50"
      >
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
        <WaveformBars peaks={peaks} progress={total ? at / total : 0} onSeek={seek} mine={false} />
      </div>
      <span className="shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">{clock(playing || at > 0 ? at : total)}</span>
    </div>
  );
}

export type RecordedVoice = { blob: Blob; duration: number; url: string };

/**
 * Record a voice memo: the mic button starts it, a live waveform and timer
 * show while it runs (cancel or done), and it stops itself at two minutes.
 */
export function useVoiceMemoRecorder(onDone: (v: RecordedVoice) => void) {
  const rec = useVoiceRecorder();
  const busy = useRef(false);
  const finish = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await rec.stop();
      if (!r) return;
      if (r.duration < 0.8) return void toast.message("Hold on a little longer to record");
      onDone({ blob: r.blob, duration: Math.min(r.duration, VOICE_MAX_SECONDS), url: URL.createObjectURL(r.blob) });
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    if (rec.recording && rec.elapsed >= VOICE_MAX_SECONDS) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.recording, rec.elapsed]);
  return {
    recording: rec.recording,
    elapsed: rec.elapsed,
    levels: rec.liveLevels,
    start: () => rec.start().catch((e: any) => toast.error(e?.message ?? "Couldn't use the microphone")),
    finish,
    cancel: rec.cancel,
  };
}

/** While recording: the live waveform and time, with cancel and done. */
export function RecordingBar({ elapsed, levels, onCancel, onDone, className }: { elapsed: number; levels: number[]; onCancel: () => void; onDone: () => void; className?: string }) {
  return (
    <div data-recording className={cn("flex min-h-11 flex-1 items-center gap-2 rounded-2xl bg-muted/70 px-1.5", className)}>
      <button type="button" onClick={onCancel} aria-label="Cancel recording" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted">
        <X className="h-4 w-4" />
      </button>
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
      <span className="w-9 shrink-0 text-[12px] font-bold tabular-nums">{clock(elapsed)}</span>
      <LiveWaveform levels={levels} />
      <button type="button" onClick={onDone} aria-label="Done recording" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground active:scale-95">
        <Check className="h-4 w-4" strokeWidth={3} />
      </button>
    </div>
  );
}

/** The mic, where Send goes while there's nothing to send. */
export function MicButton({ onClick, disabled, className }: { onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Record a voice memo"
      className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground active:scale-95 disabled:opacity-50", className)}
    >
      <Mic className="h-5 w-5" />
    </button>
  );
}
