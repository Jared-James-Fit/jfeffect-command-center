import { Dumbbell, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pinned status bar shown at the top of a workout in progress.
 * Format:  5/8 Exercises · 18/27 Sets
 *
 * Purely presentational — counters are passed in so the
 * single source of truth stays in WorkoutDayView.
 */
export function WorkoutStatusBar({
  exercisesDone,
  exercisesTotal,
  setsDone,
  setsTotal,
  className,
}: {
  exercisesDone: number;
  exercisesTotal: number;
  setsDone: number;
  setsTotal: number;
  className?: string;
}) {
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
      <div className="mx-auto flex max-w-3xl items-center justify-end gap-3 text-sm">
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