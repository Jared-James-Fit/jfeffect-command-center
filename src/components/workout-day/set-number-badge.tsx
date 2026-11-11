import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A set's number, which is also whether it's done: a quiet outlined number
 * while it's open, the same number in solid green once it's done (green =
 * done, design system), a spinner while that saves and red when it didn't.
 */
export function SetNumberBadge({
  setIndex,
  done,
  saving = false,
  error = false,
  focusMode = false,
}: {
  setIndex: number;
  done: boolean;
  saving?: boolean;
  error?: boolean;
  focusMode?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums transition-colors",
        focusMode ? "h-9 w-9 text-base" : "h-8 w-8 text-sm sm:h-7 sm:w-7 sm:text-xs",
        error
          ? "border-destructive bg-destructive/10 text-destructive"
          : done
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-border bg-background text-muted-foreground",
        saving && "opacity-70",
      )}
    >
      {saving ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : error ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : (
        setIndex
      )}
    </span>
  );
}
