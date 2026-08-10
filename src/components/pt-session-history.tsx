import { Badge } from "@/components/ui/badge";
import { ScrollText } from "lucide-react";
import {
  friendlyEventLabel,
  fmtEventDelta,
  fmtEventTime,
  type PtLedgerEvent,
} from "@/lib/pt-session-manage";

/**
 * Compact credit / event history for one PT session.
 * Events come from getPtSessionCreditEvents (parent fetches).
 */
export function PtSessionHistory({
  events,
  loading,
}: {
  events: PtLedgerEvent[];
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        <ScrollText className="h-3 w-3" /> Session history
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading history…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No credit events for this session yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((e) => {
            const delta = fmtEventDelta(e);
            const tone =
              delta.startsWith("+")
                ? "border-success/40 bg-success/10 text-success"
                : delta.startsWith("-")
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-secondary/40 text-muted-foreground";
            return (
              <li key={e.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <span className="font-semibold">{friendlyEventLabel(e)}</span>
                  <span className="text-muted-foreground"> · {fmtEventTime(e.created_at)}</span>
                  {e.note && (
                    <div className="truncate text-muted-foreground">{e.note}</div>
                  )}
                </div>
                <Badge variant="outline" className={`${tone} shrink-0 tabular-nums`}>{delta}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}