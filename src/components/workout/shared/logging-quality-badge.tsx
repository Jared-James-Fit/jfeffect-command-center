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
  complete: "border-success/40 bg-success/10 text-success",
  mostly_logged: "border-info/40 bg-info/10 text-info",
  partially_logged: "border-warning/40 bg-warning/10 text-warning",
  minimal_logging: "border-warning/40 bg-warning/10 text-warning",
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