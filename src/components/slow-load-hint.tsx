import { cn } from "@/lib/utils";

/** What a loading screen says once it's been a few seconds (opening from a link can be slow). */
export const SLOW_LOAD_HINT = "Hang tight, this can take up to a minute to open.";

/**
 * Shown under a loading state after a few seconds. The delay is pure CSS
 * (`.slow-load-hint`), so it also appears on server-rendered loading screens
 * before the app's JavaScript has arrived, which is exactly when it's slow.
 */
export function SlowLoadHint({ className }: { className?: string }) {
  return <p className={cn("slow-load-hint text-xs text-muted-foreground", className)}>{SLOW_LOAD_HINT}</p>;
}
