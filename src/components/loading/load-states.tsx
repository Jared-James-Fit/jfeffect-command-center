import type { ReactNode } from "react";
import { AlertCircle, CloudOff, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLoadPhase, useShowAfter } from "@/hooks/use-load-phase";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { describeLoadError, type LoadErrorWords } from "@/lib/loading/load-state";
import { cn } from "@/lib/utils";

/**
 * The loading system's small states, one look everywhere (lib/loading/load-state.ts
 * for the rules): an error with Try again, offline, empty, a wait that's slow or
 * stalled, and a small inline "loading" for a section too small for a skeleton.
 * Neutral, sentence case; red only for a failure.
 */

type Size = "card" | "inline" | "page";

const FRAME: Record<Size, string> = {
  page: "mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-16 text-center",
  card: "flex flex-col items-center gap-2 rounded-2xl border border-border px-4 py-6 text-center",
  inline: "flex items-center gap-2 py-2 text-sm",
};

/** A load that failed: what happened in plain words, and Try again when that can help. */
export function ErrorState({
  error,
  what,
  title,
  onRetry,
  retrying = false,
  size = "card",
  className,
}: {
  error?: unknown;
  /** "your sales", "this client's workouts": completes "Couldn't load …". */
  what?: string;
  /** Overrides the worked-out title. */
  title?: string;
  onRetry?: () => unknown;
  retrying?: boolean;
  size?: Size;
  className?: string;
}) {
  const online = useOnlineStatus();
  const words: LoadErrorWords = describeLoadError(error, { online, what });
  const Icon = words.kind === "offline" ? CloudOff : AlertCircle;
  const canRetry = !!onRetry && words.retryable;
  if (size === "inline") {
    return (
      <div role="alert" className={cn(FRAME.inline, "text-muted-foreground", className)} data-load-state="error">
        <Icon className={cn("h-4 w-4 shrink-0", words.kind === "offline" ? "text-muted-foreground" : "text-destructive")} />
        <span className="min-w-0 flex-1">{title ?? words.title}</span>
        {canRetry && (
          <Button size="sm" variant="ghost" loading={retrying} onClick={() => void onRetry?.()} className="h-8 shrink-0">
            Try again
          </Button>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className={cn(FRAME[size], className)} data-load-state="error" data-error-kind={words.kind}>
      <Icon className={cn("h-5 w-5", words.kind === "offline" ? "text-muted-foreground" : "text-destructive")} />
      <p className="text-sm font-semibold">{title ?? words.title}</p>
      {words.detail && <p className="text-xs text-muted-foreground">{words.detail}</p>}
      {canRetry && (
        <Button size="sm" variant="outline" loading={retrying} onClick={() => void onRetry?.()} className="mt-1 h-10 min-w-[7.5rem]">
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

/** Waiting for a connection with nothing saved to show: it loads by itself once the phone is back online. */
export function OfflineState({ what, size = "card", className }: { what?: string; size?: Size; className?: string }) {
  return (
    <div role="status" className={cn(FRAME[size], size === "inline" && "text-muted-foreground", className)} data-load-state="offline">
      <CloudOff className={size === "inline" ? "h-4 w-4 shrink-0 text-muted-foreground" : "h-5 w-5 text-muted-foreground"} />
      {size === "inline" ? (
        <span>You're offline. {what ? `${capitalize(what)} will` : "It'll"} load when you're back online.</span>
      ) : (
        <>
          <p className="text-sm font-semibold">You're offline</p>
          <p className="text-xs text-muted-foreground">
            {what ? `${capitalize(what)} will` : "This will"} load by itself when you're back online.
          </p>
        </>
      )}
    </div>
  );
}

/** Nothing here yet (a real, answered empty). */
export function EmptyState({
  title,
  detail,
  icon,
  action,
  size = "card",
  className,
}: {
  title: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  size?: Size;
  className?: string;
}) {
  if (size === "inline") {
    return (
      <p className={cn("py-2 text-sm text-muted-foreground", className)} data-load-state="empty">
        {title}
      </p>
    );
  }
  return (
    <div className={cn(FRAME[size], className)} data-load-state="empty">
      {icon ?? <Inbox className="h-5 w-5 text-muted-foreground" />}
      <p className="text-sm font-semibold">{title}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      {action}
    </div>
  );
}

/**
 * Said under a placeholder once a wait is long: slow ("Taking longer than
 * usual…") and then stalled (Try again), so no wait is ever only a spinner.
 * Renders nothing while the wait is normal.
 */
export function SlowNote({
  active,
  onRetry,
  what,
  className,
}: {
  active: boolean;
  onRetry?: () => unknown;
  what?: string;
  className?: string;
}) {
  const phase = useLoadPhase(active);
  const online = useOnlineStatus();
  if (!active || (phase !== "slow" && phase !== "stalled")) return null;
  if (!online) {
    return (
      <p role="status" className={cn("flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground", className)} data-load-state="offline">
        <CloudOff className="h-3.5 w-3.5" /> You're offline. {what ? `${capitalize(what)} will` : "It'll"} load when you're back online.
      </p>
    );
  }
  return (
    <div role="status" className={cn("flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground", className)} data-load-state={phase}>
      <span>{phase === "slow" ? "Taking longer than usual…" : "Still loading. The connection may be slow."}</span>
      {phase === "stalled" && onRetry && (
        <Button size="sm" variant="outline" onClick={() => void onRetry()} className="h-8">
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

/**
 * A small wait with no shape worth a skeleton (a list inside a sheet, a line
 * of detail): a spinner and words, only after LOAD_TIMING.showAfterMs, then
 * slow / stalled words like every other wait.
 */
export function InlineLoading({
  label = "Loading…",
  onRetry,
  className,
}: {
  label?: string;
  onRetry?: () => unknown;
  className?: string;
}) {
  const shown = useShowAfter(true);
  return (
    <div className={cn("py-2", className)} role="status" aria-label={label} data-load-state="loading">
      <div className={cn("flex items-center justify-center gap-2 text-sm text-muted-foreground", !shown && "invisible")}>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>{label}</span>
      </div>
      <SlowNote active onRetry={onRetry} />
    </div>
  );
}

/**
 * Shown above data that's on screen when its latest refresh failed: the data
 * stays (it was right a moment ago), one quiet line says it may be out of date.
 */
export function RefreshFailedNote({
  onRetry,
  retrying = false,
  className,
}: {
  onRetry?: () => unknown;
  retrying?: boolean;
  className?: string;
}) {
  const online = useOnlineStatus();
  return (
    <div
      role="status"
      className={cn("flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground", className)}
      data-load-state="refresh-failed"
    >
      {online ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : <CloudOff className="h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 flex-1">
        {online ? "Couldn't refresh. Showing what loaded earlier." : "You're offline. Showing what loaded earlier."}
      </span>
      {online && onRetry && (
        <Button size="sm" variant="ghost" loading={retrying} onClick={() => void onRetry()} className="h-7 px-2 text-xs">
          Try again
        </Button>
      )}
    </div>
  );
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
