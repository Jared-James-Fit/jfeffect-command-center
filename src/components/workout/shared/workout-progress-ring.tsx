import { cn } from "@/lib/utils";
import type { WorkoutProgressStatus } from "@/lib/workout-progress";

/**
 * Compact Apple-Fitness-inspired ring that summarises workout
 * completion. Colour tracks workout status so it always matches the
 * status badge on the parent card.
 */
export function WorkoutProgressRing({
  pct,
  status,
  size = 36,
  strokeWidth = 3,
  showLabel = false,
  className,
  labelText = "Progress",
}: {
  pct: number;
  status: WorkoutProgressStatus;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
  className?: string;
  labelText?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
  const color =
    status === "completed"
      ? "text-emerald-500"
      : status === "in_progress"
        ? "text-amber-500"
        : "text-muted-foreground/50";
  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Workout ${clamped}% complete`}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={strokeWidth}
            className="text-muted-foreground/15"
            stroke="currentColor"
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={strokeWidth}
            className={cn(
              "transition-[stroke-dashoffset] duration-500 ease-out",
              color,
            )}
            stroke="currentColor"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={c}
            strokeDashoffset={c - dash}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span
            className={cn(
              "font-bold tabular-nums leading-none",
              size >= 44 ? "text-[11px]" : "text-[9px]",
              color,
            )}
          >
            {clamped}%
          </span>
        </div>
      </div>
      {showLabel && (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {labelText}
        </span>
      )}
    </div>
  );
}