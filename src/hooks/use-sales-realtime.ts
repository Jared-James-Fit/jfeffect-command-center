import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Real-time Stripe ↔ sales sync.
 *
 * Stripe webhooks write straight into `purchase_records`, `payment_ledger` and
 * `session_ledger_events`. Without realtime, admin and client surfaces only
 * notice a payment when their cache window expires (the app-wide staleTime),
 * which is why a completed checkout could still read "Awaiting payment".
 *
 * This hook listens to those three canonical tables and invalidates every
 * money/session query so the UI reflects Stripe within a second. It never
 * writes anything and never bypasses RLS: clients only receive changes to
 * rows they are already allowed to read.
 */
const MONEY_KEY = /purchase|payment|sale|session|transaction|revenue|billing|ledger|offer|product/i;

export function useSalesRealtime(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Webhooks fire several row writes per payment (purchase + ledger +
    // credit grant). Debounce so one payment causes one refetch pass.
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries({
          predicate: (query) => {
            const head = query.queryKey?.[0];
            return typeof head === "string" && MONEY_KEY.test(head);
          },
        });
      }, 250);
    };

    const channel = supabase
      .channel("sales-stripe-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_records" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_ledger" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "session_ledger_events" }, invalidate)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

export default useSalesRealtime;
