import { cn } from "@/lib/utils";

const TICKS = 8;

/**
 * The iOS / Instagram activity indicator: eight rounded ticks, the lead one
 * brightest, turning a tick at a time. While you pull to refresh it builds up
 * tick by tick (`shown`), then spins once it's loading.
 */
export function ActivitySpinner({ size = 22, shown = TICKS, spinning = true, className }: {
  size?: number;
  /** How many ticks are drawn (0–8), for the pull. */
  shown?: number;
  spinning?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={cn("shrink-0", spinning && "activity-spin", className)}
      data-activity-spinner
    >
      {Array.from({ length: TICKS }, (_, i) => (
        <line
          key={i}
          x1="12"
          y1="2.6"
          x2="12"
          y2="7"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          transform={`rotate(${i * (360 / TICKS)} 12 12)`}
          // spinning: a tail fading behind the lead tick; pulling: each tick appears whole
          opacity={i < shown ? (spinning ? 0.22 + (0.78 * (i + 1)) / TICKS : 0.85) : 0}
        />
      ))}
    </svg>
  );
}
