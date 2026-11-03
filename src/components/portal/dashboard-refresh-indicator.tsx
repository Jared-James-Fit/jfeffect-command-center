import { useEffect, useRef, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Subtle dashboard status pill, shown only when it matters:
 *
 * - offline, showing the last saved version;
 * - the most recent refresh failed but cached data is still visible.
 *
 * Nothing while a refresh is simply running: a background refetch isn't news,
 * and a pill that came and went with every query shifted the page (pull to
 * refresh has its own spinner).
 */
export function DashboardRefreshIndicator() {
  const fetching = useIsFetching();
  const qc = useQueryClient();
  const [staleWarn, setStaleWarn] = useState(false);
  const wasFetchingRef = useRef(false);
  const online = useOnlineStatus();

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

  if (!online) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500"
        title="You're offline — showing your last saved dashboard."
      >
        <WifiOff className="h-3 w-3" aria-hidden />
        Offline mode — showing last saved version.
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