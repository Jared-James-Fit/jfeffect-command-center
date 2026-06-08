import { Check, Loader2, CloudOff, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SaveState } from "@/hooks/use-autosave";

/**
 * Tiny, aesthetic inline "Saving… / Saved ✓" pill.
 * Designed to sit next to a field label or under a form section.
 */
export function SavedIndicator({
  state,
  className,
  labels,
}: {
  state: SaveState;
  className?: string;
  labels?: Partial<Record<SaveState, string>>;
}) {
  if (state === "idle") return null;
  const text =
    labels?.[state] ??
    (state === "saving"
      ? "Saving…"
      : state === "saved"
      ? "Saved"
      : state === "offline"
      ? "Offline — will retry"
      : "Couldn't save");

  const Icon =
    state === "saving"
      ? Loader2
      : state === "saved"
      ? Check
      : state === "offline"
      ? CloudOff
      : AlertTriangle;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium tabular-nums transition-opacity duration-300",
        state === "saving" && "text-muted-foreground",
        state === "saved" && "text-success",
        state === "offline" && "text-muted-foreground",
        state === "error" && "text-destructive",
        className,
      )}
      aria-live="polite"
    >
      <Icon className={cn("h-3 w-3", state === "saving" && "animate-spin")} />
      {text}
    </span>
  );
}