/**
 * A client's payments laid out in time (payment-schedule.ts), read once and
 * shared by the Billing tab and the Sessions tab's billing line: the same
 * query key (["client-billing", id]) every money screen on the client
 * refreshes, so the two tabs never disagree.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClientBillingOverview } from "@/lib/billing.functions";
import { buildClientPayments, type ClientPayments } from "@/lib/payment-schedule";
import { deviceTodayISO } from "@/lib/schedule-time";

export type ClientBillingOverview = {
  purchases: any[];
  ledger: any[];
  session_events: any[];
  session_balance: any[];
};

export function useClientPayments(clientId: string) {
  const overviewFn = useServerFn(getClientBillingOverview);
  const query = useQuery({
    queryKey: ["client-billing", clientId],
    queryFn: () => overviewFn({ data: { client_id: clientId } }) as Promise<ClientBillingOverview>,
  });
  const today = deviceTodayISO();
  const payments: ClientPayments | null = useMemo(() => {
    const d = query.data;
    if (!d) return null;
    return buildClientPayments({
      sales: d.purchases ?? [],
      ledger: d.ledger ?? [],
      balance: d.session_balance ?? [],
      events: d.session_events ?? [],
      today,
    });
  }, [query.data, today]);
  return { ...query, payments, today };
}
