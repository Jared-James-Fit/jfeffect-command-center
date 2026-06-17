/**
 * Shared logging-quality pill used by both client and member workout
 * summaries. Colors map to the five buckets returned by
 * `categorizeLoggingQuality()` in `src/lib/workout-completeness.ts`.
 */
import { cn } from "@/lib/utils";
import type { LoggingQuality } from "@/lib/workout-completeness";

const LABEL: Record<LoggingQuality, string> = {
  complete: "Fully logged",
  mostly_logged: "Mostly logged",
  partially_logged: "Partially logged",
  minimal_logging: "Minimal logging",
  no_logs: "No logs",
};

const STYLE: Record<LoggingQuality, string> = {
  complete: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  mostly_logged: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  partially_logged: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  minimal_logging: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  no_logs: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

export function LoggingQualityBadge({
  quality,
  percentage,
  showPercent = true,
  className,
}: {
  quality: LoggingQuality;
  percentage?: number | null;
  showPercent?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        STYLE[quality],
        className,
      )}
    >
      <span>{LABEL[quality]}</span>
      {showPercent && percentage != null && Number.isFinite(percentage) && (
        <span className="opacity-70">· {Math.round(percentage)}%</span>
      )}
    </span>
  );
}