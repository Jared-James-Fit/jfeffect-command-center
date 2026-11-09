import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, ExternalLink, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { listenChannel } from "@/lib/realtime-channel";
import { saleMoney } from "@/lib/sale-money";
import { money } from "@/lib/session-sale";
import type { SharedAttachment } from "@/components/chat-shared";
import { PlusTax } from "@/components/billing/plus-tax";

/**
 * The payment card in a chat. It reads its sale live (the attachment's status is
 * only what it was when sent), so once Stripe confirms the payment both sides
 * see "Paid" without a refresh: the client's Pay now turns into Paid, the
 * coach's "Waiting on payment" too.
 */
export function PaymentRequestCard({ att, mine, staff }: { att: SharedAttachment; mine: boolean; staff?: boolean }) {
  const purchaseId = (att as any).purchase_id as string | undefined;
  const qc = useQueryClient();
  const { data: sale } = useQuery({
    queryKey: ["sale-live", purchaseId ?? null],
    enabled: !!purchaseId,
    staleTime: 30_000,
    queryFn: async () =>
      (await supabase.from("purchase_records").select("*").eq("id", purchaseId!).maybeSingle()).data as any,
  });
  useEffect(() => {
    if (!purchaseId) return;
    const channel = listenChannel(`sale-live-${purchaseId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "purchase_records", filter: `id=eq.${purchaseId}` }, () =>
        qc.invalidateQueries({ queryKey: ["sale-live", purchaseId] }),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [purchaseId, qc]);

  const state = sale ? saleMoney(sale).state : null;
  const snapshotPaid = att.status === "Paid" || att.status === "Active Subscription";
  const paid = state ? state === "paid" || state === "free" || state === "renews" || state === "cancelling" : snapshotPaid;
  const ended = state === "ended";
  const coachView = staff ?? mine;
  const currency = (att.currency ?? "CAD").toUpperCase();
  const amount = typeof att.amount_cents === "number" ? money(att.amount_cents, currency) : null;
  const paidCents = Number(sale?.amount_paid_cents ?? 0);
  const paidOn = sale?.paid_at
    ? new Date(sale.paid_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <div
      className={cn(
        "w-[260px] max-w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        mine ? "border-primary/30" : "border-border",
      )}
      data-payment-state={paid ? "paid" : ended ? "ended" : "waiting"}
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-secondary/40 px-3 py-2">
        <CreditCard className="h-4 w-4 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-widest">Payment</span>
        {paid ? (
          <Badge variant="outline" className="ml-auto border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="mr-1 h-3 w-3" />Paid
          </Badge>
        ) : ended ? (
          <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">Cancelled</Badge>
        ) : coachView ? (
          <Badge variant="outline" className="ml-auto border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-300">
            <Clock className="mr-1 h-3 w-3" />Waiting
          </Badge>
        ) : null}
      </div>
      <div className="px-3 py-2.5">
        {att.title && <div className="text-sm font-semibold leading-tight">{att.title}</div>}
        {paid && paidCents > 0 ? (
          <div className="mt-0.5 text-lg font-bold tracking-tight">{money(paidCents, currency)}</div>
        ) : amount ? (
          <div className="mt-0.5 text-lg font-bold tracking-tight">
            {amount}<PlusTax className="text-xs font-medium" />
          </div>
        ) : null}
        <div className="text-[11px] text-muted-foreground">
          {paid
            ? paidOn ? `Paid ${paidOn}` : "Paid"
            : ended
              ? "Nothing to pay"
              : coachView
                ? "Not paid yet. It updates here once Stripe confirms."
                : att.payment_structure ?? "Secure checkout by Stripe"}
        </div>
      </div>
      {!paid && !ended && (
        <div className="px-3 pb-3">
          {att.payment_url ? (
            <a href={att.payment_url} target="_blank" rel="noreferrer" className="block">
              <Button size="sm" variant={coachView ? "outline" : "default"} className="w-full">
                {coachView ? "Open payment page" : "Pay now"}
                <ExternalLink className="ml-1.5 h-3 w-3" />
              </Button>
            </a>
          ) : (
            <Button size="sm" variant="outline" className="w-full" disabled>Link unavailable</Button>
          )}
        </div>
      )}
    </div>
  );
}
