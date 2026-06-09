import { useEffect, useState } from "react";
import { Volume2, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { playSound, subscribeSound } from "@/lib/sound-player";

export function ChatSoundCard({
  url, title, durationMs, mine, disabled,
}: {
  url: string;
  title: string;
  durationMs?: number | null;
  mine: boolean;
  disabled?: boolean;
}) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return subscribeSound((s) => setPlaying(s.url === url && s.playing));
  }, [url]);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    void playSound(url);
  };

  const seconds = durationMs ? Math.max(1, Math.round(durationMs / 100) / 10) : null;

  return (
    <div
      data-no-doubletap
      className={cn(
        "flex w-[260px] max-w-full items-center gap-3 rounded-2xl border p-3",
        mine
          ? "border-primary-foreground/30 bg-primary-foreground/5"
          : "border-border bg-background/60",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={playing ? "Pause sound" : "Play sound"}
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95",
          mine ? "bg-primary-foreground/15 text-primary-foreground" : "bg-primary text-primary-foreground",
          disabled && "opacity-50",
        )}
      >
        {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn(
          "flex items-center gap-1 text-[10px] uppercase tracking-wide",
          mine ? "opacity-70" : "text-muted-foreground",
        )}>
          <Volume2 className="h-3 w-3" />
          Sound Effect
        </div>
        <div className="truncate text-sm font-medium leading-tight">{title}</div>
        {seconds != null && (
          <div className={cn(
            "mt-0.5 text-[10px]",
            mine ? "opacity-60" : "text-muted-foreground",
          )}>
            {seconds}s
          </div>
        )}
        {disabled && (
          <div className="text-[10px] text-muted-foreground">Playback disabled</div>
        )}
      </div>
    </div>
  );
}