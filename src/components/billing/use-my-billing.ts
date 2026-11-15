/**
 * My Purchases' one read: the client's billing through the client-safe server
 * read (my-billing.functions.ts), worked out by the same model as the coach's
 * Billing tab (buildClientPayments) and put in the client's words
 * (my-purchases.ts). The list, a purchase's page and Account's Billing row
 * share it, so they never disagree. "View as client" reads the previewed
 * client's record with the coach's own login (the database decides).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { getMyBilling, type MyBilling } from "@/lib/my-billing.functions";
import { buildClientPayments, type ScheduleSale } from "@/lib/payment-schedule";
import { myPurchases, type MyLedgerRow } from "@/lib/my-purchases";
import { formatMoney } from "@/lib/payment-display";
import { deviceTodayISO } from "@/lib/schedule-time";

/** The client record the portal is showing: the previewed client's, else the signed-in person's own. */
export function usePortalClientId(): { clientId: string | undefined; loading: boolean } {
  const { user } = useAuth();
  const { client } = useClientImpersonation();
  const own = useQuery({
    // Its own key: other screens keep the whole client row under ["my-client", id].
    queryKey: ["my-client-id", user?.id],
    enabled: !client && !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => (await supabase.from("clients").select("id").eq("user_id", user!.id).maybeSingle()).data,
  });
  if (client) return { clientId: client.id, loading: false };
  return { clientId: own.data?.id ?? undefined, loading: own.isLoading };
}

export type MyBillingView = {
  payments: ReturnType<typeof buildClientPayments>;
  sales: ScheduleSale[];
  ledger: MyLedgerRow[];
  money: (cents: number) => string;
  mine: ReturnType<typeof myPurchases>;
};

/** The view a billing read becomes: the coach's model, then the client's words. */
export function myBillingView(d: MyBilling, today: string): MyBillingView {
  const sales = d.sales as unknown as ScheduleSale[];
  const ledger = d.ledger as unknown as MyLedgerRow[];
  const payments = buildClientPayments({ sales, ledger, balance: d.session_balance as any[], events: d.session_events as any[], today });
  const money = (cents: number) => formatMoney(cents / 100, payments.currency);
  return { payments, sales, ledger, money, mine: myPurchases({ payments, sales, ledger, money }) };
}

export const myBillingKey = (clientId: string | undefined) => ["my-billing", clientId] as const;

export function useMyBilling(clientId: string | undefined) {
  const fn = useServerFn(getMyBilling);
  const query = useQuery({
    queryKey: myBillingKey(clientId),
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => fn({ data: { client_id: clientId! } }) as Promise<MyBilling>,
  });
  const today = deviceTodayISO();
  const view = useMemo(() => (query.data ? myBillingView(query.data, today) : null), [query.data, today]);
  return { ...query, view, today };
}
