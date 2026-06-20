import { useEffect, useRef, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";

/**
 * Subtle dashboard-refresh status pill.
 *
 * - "Updating…" while any portal query is fetching in the background and
 *   we already have cached data on screen.
 * - Small non-intrusive warning if the most recent refresh failed but
 *   cached data is still visible.
 */
export function DashboardRefreshIndicator() {
  const fetching = useIsFetching();
  const qc = useQueryClient();
  const [staleWarn, setStaleWarn] = useState(false);
  const wasFetchingRef = useRef(false);

  useEffect(() => {
    const isFetching = fetching > 0;
    if (isFetching) {
      wasFetchingRef.current = true;
      // Hide the warning while a fresh refresh is in flight.
      if (staleWarn) setStaleWarn(false);
      return;
    }
    if (!wasFetchingRef.current) return;
    wasFetchingRef.current = false;
    // After a fetch settles, look for errored queries that still have
    // (cached) data on screen — that's the "kept cached, refresh failed"
    // case the user wants flagged.
    const queries = qc.getQueryCache().getAll();
    const hasStaleAfterError = queries.some(
      (q) => q.state.status === "error" && q.state.data !== undefined,
    );
    setStaleWarn(hasStaleAfterError);
  }, [fetching, qc, staleWarn]);

  if (fetching > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Updating…
      </span>
    );
  }

  if (staleWarn) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500"
        title="We couldn't refresh just now — showing your last saved data."
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Showing saved data
      </span>
    );
  }

  return null;
}