import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A set's number, which is also whether it's done: a neutral grey circle
 * while it's open, the same number in solid green once it's done (the theme's
 * success green: done, design system), a spinner while that saves and red
 * when it didn't.
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
        "inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums transition-colors duration-200",
        focusMode ? "h-9 w-9 text-base" : "h-8 w-8 text-sm sm:h-7 sm:w-7 sm:text-xs",
        error
          ? "border-destructive bg-destructive/10 text-destructive"
          : done
            ? "border-success bg-success text-white"
            : "border-transparent bg-muted text-muted-foreground",
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
