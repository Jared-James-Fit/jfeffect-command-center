import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { SessionActionsSheet, whenLabel, type ActionSession, type ChangeRequest } from "@/components/schedule/session-actions-sheet";
import { listenChannel } from "@/lib/realtime-channel";

type Row = ChangeRequest & {
  session: ActionSession | null;
  client: { full_name: string | null } | null;
};

/**
 * Client requests to move or cancel a session, waiting on the coach. Shown at
 * the top of the calendar and on the client's Sessions tab; tapping one opens
 * the session with the answer buttons ready. Hidden when there's nothing to do.
 */
export function ChangeRequestsCard({ clientId, onEdit }: { clientId?: string; onEdit?: (s: ActionSession) => void }) {
  const qc = useQueryClient();
  const [active, setActive] = useState<Row | null>(null);
  const channelId = useId();

  const { data: rows = [] } = useQuery<Row[]>({
    queryKey: ["schedule-change-requests", clientId ?? "all"],
    staleTime: 15_000,
    queryFn: async () => {
      let q = (supabase as any)
        .from("pt_session_change_requests")
        .select(
          "*, session:pt_sessions(id, client_id, title, session_type, session_date, start_time, end_time, timezone, location, status, uses_credit, google_event_id), client:clients(full_name)",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(50);
      if (clientId) q = q.eq("client_id", clientId);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as Row[]).filter((r) => r.session);
    },
  });

  useEffect(() => {
    const ch = listenChannel(`schedule-requests-${clientId ?? "all"}-${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pt_session_change_requests" }, () => {
        qc.invalidateQueries({ queryKey: ["schedule-change-requests"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [clientId, qc, channelId]);

  if (!rows.length) return null;

  return (
    <>
      <Card className="space-y-2 border-amber-500/40 bg-amber-500/5 p-3 sm:p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-300">
          <CalendarClock className="h-4 w-4" /> {rows.length} schedule request{rows.length === 1 ? "" : "s"}
        </div>
        <ul className="divide-y divide-border/60">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setActive(r)}
                className="flex w-full items-center gap-3 py-2.5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {clientId ? "" : `${r.client?.full_name ?? "Client"} · `}
                    {r.kind === "move" ? "wants to move" : "can't make it"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.session ? whenLabel(r.session.session_date, r.session.start_time) : ""}
                    {r.preferred_times ? ` → ${r.preferred_times}` : ""}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <SessionActionsSheet
        session={active?.session ?? null}
        clientName={active?.client?.full_name}
        open={!!active}
        onOpenChange={(o) => { if (!o) setActive(null); }}
        onEdit={onEdit}
      />
    </>
  );
}
