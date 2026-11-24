import type { ReactNode } from "react";
import { AlertCircle, Check, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useElapsed } from "@/hooks/use-load-phase";
import { elapsedClock, uploadWords } from "@/lib/loading/load-state";
import { cn } from "@/lib/utils";

/**
 * Two kinds of long work, said honestly (lib/loading/load-state.ts):
 *  - an upload: the bytes that have actually gone (a real percent), or a moving
 *    stripe while its size isn't known, never a made-up number;
 *  - work with no measurable progress (an AI draft, a sync, a report): what it's
 *    doing in words, how long it's been at it, what's done and what's next, and
 *    a way out when it fails. No percent at all.
 */

/** A bar: filled to a real fraction, or a stripe moving along while it's unknown. */
export function ProgressBar({ fraction, className, label }: { fraction: number | null; className?: string; label?: string }) {
  const known = fraction != null && Number.isFinite(fraction);
  const pct = known ? Math.max(0, Math.min(1, fraction as number)) * 100 : null;
  return (
    <div
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(pct as number) : undefined}
    >
      {known ? (
        <div className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      ) : (
        <div className="jf-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-foreground/70" />
      )}
    </div>
  );
}

export type UploadStatus = "uploading" | "processing" | "done" | "error";

/**
 * One file going up: its name, the real bytes sent ("4.2 MB of 10.0 MB · 42%"),
 * then "Finishing…" while the server checks it, Done, or what failed with
 * Try again. Cancel while it's going, when the caller can stop it.
 */
export function UploadProgress({
  name,
  loaded = 0,
  total = 0,
  status,
  error,
  onCancel,
  onRetry,
  className,
}: {
  name?: ReactNode;
  loaded?: number;
  total?: number;
  status: UploadStatus;
  error?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  const words = status === "uploading" ? uploadWords(loaded, total) : null;
  const fraction = status === "uploading" ? (total > 0 ? loaded / total : null) : status === "done" ? 1 : null;
  return (
    <div className={cn("space-y-1.5", className)} data-upload-status={status} aria-live="polite">
      <div className="flex items-center gap-2 text-xs">
        {status === "done" ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
        ) : status === "error" ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{name ?? "Uploading"}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {status === "uploading"
            ? (words ?? "Uploading…")
            : status === "processing"
              ? "Finishing…"
              : status === "done"
                ? "Done"
                : "Didn't upload"}
        </span>
        {status === "uploading" && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="-m-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Cancel upload"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {status !== "error" && <ProgressBar fraction={fraction} label="Upload progress" />}
      {status === "error" && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{error || "Check your connection and try again."}</p>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry} className="h-9">
              <RefreshCw /> Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export type WorkStep = { label: string; done: boolean };

/**
 * Long work with no measurable percent (an AI draft, a sync, a report being
 * made): a spinner and what it's doing, how long it's been at it once that's
 * worth saying (10 s+), the steps done and the one running, a note past
 * `expectedMs` that it's taking longer than usual, and on failure what went
 * wrong with Try again. Never a fake percent.
 */
export function WorkingOn({
  label,
  detail,
  steps,
  startedAt,
  expectedMs,
  failed,
  error,
  onRetry,
  onCancel,
  cancelLabel = "Cancel",
  className,
}: {
  label: ReactNode;
  /** A line under it ("You can leave this screen; it keeps going."). */
  detail?: ReactNode;
  steps?: WorkStep[];
  /** When the work really started (a server timestamp), so the clock survives a reload. */
  startedAt?: number | null;
  /** How long this usually takes; past it, it says so. */
  expectedMs?: number;
  failed?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  className?: string;
}) {
  const elapsed = useElapsed(!failed, { since: startedAt ?? null });
  const longer = !failed && expectedMs != null && elapsed > expectedMs;
  const current = steps?.findIndex((s) => !s.done) ?? -1;
  return (
    <div className={cn("space-y-3 rounded-2xl border border-border p-4", className)} data-working={failed ? "failed" : "running"} aria-live="polite">
      <div className="flex items-start gap-3">
        {failed ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{failed ? (error ? "It didn't finish" : label) : label}</p>
          {failed && error && <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>}
          {!failed && detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
        </div>
        {!failed && elapsed >= 10_000 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-working-elapsed>
            {elapsedClock(elapsed)}
          </span>
        )}
      </div>
      {steps && steps.length > 0 && (
        <ol className="space-y-1.5 pl-7 text-xs">
          {steps.map((s, i) => (
            <li
              key={s.label}
              className={cn(
                "flex items-center gap-2",
                s.done ? "text-muted-foreground" : i === current ? "font-medium text-foreground" : "text-muted-foreground/70",
              )}
            >
              {s.done ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : i === current && !failed ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span className="h-3.5 w-3.5 rounded-full border border-border" />
              )}
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {longer && <p className="text-xs text-muted-foreground">Taking longer than usual. It's still working.</p>}
      {(failed ? onRetry : onCancel) && (
        <div className="flex justify-end gap-2">
          {failed && onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry} className="h-9">
              <RefreshCw /> Try again
            </Button>
          )}
          {!failed && onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel} className="h-9">
              {cancelLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
