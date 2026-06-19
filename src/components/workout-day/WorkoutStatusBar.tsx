import { useEffect, useState } from "react";
import { Clock, Dumbbell, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pinned status bar shown at the top of a workout in progress.
 * Format:  Chest Day · 5/8 Exercises · 18/27 Sets · 43:21
 *
 * Purely presentational — counters and started_at are passed in so the
 * single source of truth stays in WorkoutDayView.
 */
export function WorkoutStatusBar({
  title,
  exercisesDone,
  exercisesTotal,
  setsDone,
  setsTotal,
  startedAt,
  completedAt,
  className,
}: {
  title: string;
  exercisesDone: number;
  exercisesTotal: number;
  setsDone: number;
  setsTotal: number;
  startedAt?: string | null;
  completedAt?: string | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || completedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, completedAt]);

  const elapsedSeconds = (() => {
    if (!startedAt) return null;
    const start = new Date(startedAt).getTime();
    if (!Number.isFinite(start)) return null;
    const end = completedAt ? new Date(completedAt).getTime() : now;
    return Math.max(0, Math.floor((end - start) / 1000));
  })();

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  };

  const exercisesComplete = exercisesTotal > 0 && exercisesDone >= exercisesTotal;
  const setsComplete = setsTotal > 0 && setsDone >= setsTotal;

  return (
    <div
      className={cn(
        "sticky top-0 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur md:-mx-8 md:px-8",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 text-sm">
        <div className="min-w-0 flex-1 truncate font-bold tracking-tight">
          {title}
        </div>
        <Stat
          icon={<Dumbbell className="h-3.5 w-3.5" />}
          label="Exercises"
          value={`${exercisesDone}/${exercisesTotal}`}
          done={exercisesComplete}
        />
        <Stat
          icon={<ListChecks className="h-3.5 w-3.5" />}
          label="Sets"
          value={`${setsDone}/${setsTotal}`}
          done={setsComplete}
        />
        {elapsedSeconds !== null && (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs font-black tabular-nums",
              completedAt
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-primary/10 text-primary",
            )}
            aria-label={`Elapsed ${fmt(elapsedSeconds)}`}
          >
            <Clock className="h-3.5 w-3.5" />
            {fmt(elapsedSeconds)}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  done,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  done: boolean;
}) {
  return (
    <div
      className={cn(
        "hidden shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold tabular-nums sm:flex",
        done ? "bg-emerald-500/10 text-emerald-500" : "bg-secondary text-foreground",
      )}
      aria-label={`${label} ${value}`}
    >
      <span className="opacity-70">{icon}</span>
      <span>{value}</span>
      <span className="hidden text-[10px] font-semibold uppercase tracking-wider opacity-60 md:inline">
        {label}
      </span>
    </div>
  );
}