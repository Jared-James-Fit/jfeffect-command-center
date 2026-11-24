import { Check, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DRAFT_STATUS_HINT,
  DRAFT_STATUS_WORDS,
  type DraftStatus,
} from "@/lib/program-draft-status";

/**
 * Where the work stands, one quiet line by the program's name: "Saving…",
 * "Draft saved", "All changes saved", "Offline · saved on this device",
 * "Draft restored". Never a pop-up over the builder; its meaning is its title.
 */
export function DraftStatusLine({
  status,
  className,
}: {
  status: DraftStatus;
  className?: string;
}) {
  const w = DRAFT_STATUS_WORDS[status];
  return (
    <span
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap",
        w.tone === "warn" ? "text-warning" : "text-muted-foreground",
        className,
      )}
      title={DRAFT_STATUS_HINT[status]}
      aria-live="polite"
      data-draft-status={status}
    >
      {status === "saving" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : status === "offline" ? (
        <CloudOff className="h-3 w-3" aria-hidden />
      ) : w.tone === "good" ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : null}
      <span>{w.text}</span>
      <span className="sr-only">. {DRAFT_STATUS_HINT[status]}</span>
    </span>
  );
}
