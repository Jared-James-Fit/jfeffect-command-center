import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { latestPackage } from "@/lib/client-owed";
import { creditOutlook, type CreditOutlook } from "@/lib/session-credit";

/**
 * What booking `count` new sessions does to a client's credits (creditOutlook), from
 * their live balance and the package they'd renew. Staff only (session_balance answers
 * staff and the client themselves). Null while it loads.
 */
export function useCreditOutlook(clientId: string | null | undefined, opts: { count?: number; first: string; enabled?: boolean }): CreditOutlook | null {
  const enabled = !!clientId && (opts.enabled ?? true);
  // Same key and shape as the booking dialog's balance, so the two share one fetch.
  const { data: balanceRows } = useQuery<any[]>({
    queryKey: ["pt-balance", clientId ?? null],
    enabled,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("session_balance", { _client_id: clientId });
      return (data ?? []) as any[];
    },
  });
  const { data: sales } = useQuery<any[]>({
    queryKey: ["pt-pack-purchases", "renewal", clientId ?? null],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_records")
        .select("id, offer_name, payment_status, contract_value_cents, full_payable_amount, installment_amount, number_of_payments, is_recurring, amount_paid_cents, currency, sessions_purchased, purchased_at, created_at, archived_at")
        .eq("client_id", clientId!)
        .gt("sessions_purchased", 0)
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });
  if (!balanceRows || !sales) return null;
  const remaining = balanceRows.reduce((sum, r) => sum + Math.max(Number(r.remaining ?? 0), 0), 0);
  return creditOutlook({ remaining, count: opts.count, packageSize: latestPackage(sales)?.size ?? null, first: opts.first });
}
