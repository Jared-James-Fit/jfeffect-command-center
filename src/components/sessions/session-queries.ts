/**
 * The reads a client's sessions are shown from, shared by the Sessions tab
 * and Billing's package appointments so both use one cache entry each (and
 * the Sessions tab's realtime refresh covers both).
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/supabase-paginate";
import type { PackageLedgerEvent } from "@/lib/session-packages";

export const ptSessionsQuery = (clientId: string) => ({
  queryKey: ["pt-sessions", clientId] as const,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("pt_sessions")
      .select("*")
      .eq("client_id", clientId)
      .order("session_date", { ascending: false })
      .order("start_time", { ascending: false });
    if (error) throw error;
    return (data ?? []) as any[];
  },
});

/** The whole session ledger, page by page: which package each session is on. */
export const ptClientLedgerQuery = (clientId: string) => ({
  queryKey: ["pt-client-ledger", clientId] as const,
  queryFn: () =>
    fetchAllPages<PackageLedgerEvent>((from, to) =>
      (supabase as any)
        .from("session_ledger_events")
        .select("id, purchase_id, pt_session_id, event_type, session_count, source, note, related_event_id, effective_date, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
});
