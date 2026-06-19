import { useEffect, useRef, useState } from "react";
import { Clock, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Big, dummy-proof rest-timer button.
 * - Tap to start countdown from `seconds`.
 * - Shows MM:SS while running.
 * - When it hits 0, resets back to the original label so the user can tap it again.
 */
export function RestTimerButton({
  seconds,
  label,
  className,
}: {
  seconds: number | null;
  label: string;
  className?: string;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const start = () => {
    if (!seconds || seconds <= 0) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRemaining(seconds);
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r == null) return null;
        if (r <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          // Beep + vibrate so they know rest is up, then reset.
          try {
            if (typeof navigator !== "undefined" && navigator.vibrate) {
              navigator.vibrate([180, 80, 180]);
            }
          } catch {}
          return null;
        }
        return r - 1;
      });
    }, 1000);
  };

  const running = remaining != null;
  const display =
    remaining != null
      ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
      : label;

  return (
    <button
      type="button"
      onClick={start}
      disabled={!seconds || seconds <= 0}
      aria-label={running ? `Rest timer ${display} remaining` : `Start rest timer for ${label}`}
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-base font-bold tabular-nums shadow-sm transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100",
        running
          ? "border-primary bg-primary text-primary-foreground"
          : "border-primary/60 bg-primary/10 text-foreground hover:bg-primary/20",
        className,
      )}
    >
      {running ? <Clock className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      <span>{running ? display : `Rest: ${label} — Tap to start`}</span>
    </button>
  );
}