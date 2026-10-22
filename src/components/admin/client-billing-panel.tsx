import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { buildBillingSummary } from "@/lib/client-billing-summary";
import { ClientBalanceCard } from "@/components/admin/client-balance-card";
import { getClientBillingOverview, renewSessionPackage } from "@/lib/billing.functions";
import { useAuth } from "@/lib/auth";

/**
 * The top of a client's Billing tab: what they owe, in plain words. The sales
 * under it (ClientSalesTable) hold each sale's payments and money actions.
 */
export function ClientBillingPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const isAdmin = useAuth().role === "admin";
  const overview = useServerFn(getClientBillingOverview);
  const renewFn = useServerFn(renewSessionPackage);
  const { data, isLoading } = useQuery({
    queryKey: ["client-billing", clientId],
    queryFn: () => overview({ data: { client_id: clientId } }),
  });
  const renew = useMutation({
    mutationFn: (purchaseId: string) => renewFn({ data: { purchase_id: purchaseId } }),
    onSuccess: () => {
      toast.success("Renewal added", { description: "It's in Sales below, with the sessions already trained and booked on it." });
      for (const key of [["client-billing", clientId], ["client-purchases", clientId], ["pt-balance", clientId], ["pt-pack-purchases", clientId]]) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not add the renewal"),
  });

  if (isLoading) return <Card className="p-6 md:col-span-3 text-sm text-muted-foreground">Loading billing…</Card>;
  if (!data?.ok) return <Card className="p-6 md:col-span-3 text-sm text-destructive">Failed to load billing.</Card>;

  const summary = buildBillingSummary({
    sales: data.purchases as any[],
    ledger: data.ledger as any[],
    balance: data.session_balance as any[],
    events: data.session_events as any[],
  });
  return <ClientBalanceCard summary={summary} onRenew={isAdmin ? (id) => renew.mutate(id) : undefined} renewing={renew.isPending} />;
}
