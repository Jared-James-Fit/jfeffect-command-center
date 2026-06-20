import { WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Full-card offline state for dashboards when no cached data is available.
 *
 * Render this when `useOnlineStatus()` is false AND the dashboard's primary
 * query has no cached data to fall back on. Provides a Retry button that
 * refetches once the user is back online.
 */
export function DashboardOfflineEmpty({ onRetry }: { onRetry?: () => void }) {
  const qc = useQueryClient();
  const online = useOnlineStatus();

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    // Invalidate everything so queries refetch on next mount/connection.
    qc.invalidateQueries();
    if (online && typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <main className="grid min-h-[80dvh] place-items-center px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-border/60 bg-card/60 px-6 py-8 text-center backdrop-blur">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-amber-500/10 text-amber-500">
          <WifiOff className="h-6 w-6" aria-hidden />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-base font-semibold text-foreground">
            You&apos;re offline
          </h1>
          <p className="text-sm text-muted-foreground">
            Connect to the internet and try again.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={handleRetry} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    </main>
  );
}

/**
 * True when the user is offline AND we have no cached query data to render.
 * Used to decide whether a dashboard should show the offline-empty state
 * instead of its skeletons.
 */
export function useIsOfflineWithoutCache(): boolean {
  const online = useOnlineStatus();
  const qc = useQueryClient();
  if (online) return false;
  const queries = qc.getQueryCache().getAll();
  const hasAnyData = queries.some((q) => q.state.data !== undefined);
  return !hasAnyData;
}