import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, CreditCard, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { listenChannel } from "@/lib/realtime-channel";
import { cn } from "@/lib/utils";
import { saleMoney } from "@/lib/sale-money";
import { money, paymentLineText, defaultSaleProduct } from "@/lib/session-sale";
import { CopyPaymentLinkButton } from "@/components/payments/copy-payment-link-button";
import {
  EMPTY_SALE, SessionSalePicker, quoteFor, runSessionSale, useSaleProducts, useSellSessions, type SaleDraft,
} from "@/components/schedule/session-sale-picker";

type LineSession = {
  id: string;
  client_id: string;
  status: string;
  title?: string | null;
  uses_credit?: boolean | null;
};

/**
 * Is this session paid for? The sale its credit is on (pt_session_sale_id),
 * read live: Paid, Waiting on the link (Copy it), part paid, or not on any
 * sale yet — then Charge for it sells it right here, the same as at booking.
 */
export function SessionPaymentLine({ session, first }: { session: LineSession; first: string }) {
  const qc = useQueryClient();
  const sellFn = useSellSessions();
  const [selling, setSelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SaleDraft>({ ...EMPTY_SALE, on: true });
  const active = session.uses_credit !== false && !["Cancelled", "Rescheduled"].includes(session.status);

  const { data: saleId, isLoading } = useQuery({
    queryKey: ["session-sale-id", session.id],
    enabled: active,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("pt_session_sale_id", { _pt_session_id: session.id });
      if (error) throw error;
      return (data ?? null) as string | null;
    },
  });
  const { data: sale } = useQuery({
    queryKey: ["sale-live", saleId ?? null],
    enabled: !!saleId,
    staleTime: 30_000,
    queryFn: async () => (await supabase.from("purchase_records").select("*").eq("id", saleId!).maybeSingle()).data as any,
  });
  useEffect(() => {
    if (!saleId) return;
    const channel = listenChannel(`session-sale-${saleId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "purchase_records", filter: `id=eq.${saleId}` }, () =>
        qc.invalidateQueries({ queryKey: ["sale-live", saleId] }),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [saleId, qc]);

  const { data: products = [], isLoading: productsLoading } = useSaleProducts(selling);
  useEffect(() => {
    if (selling && !draft.touched && !draft.productId && products.length) {
      setDraft((d) => ({ ...d, productId: defaultSaleProduct(products)?.id ?? null }));
    }
  }, [selling, products, draft.touched, draft.productId]);

  if (!active || isLoading) return null;

  if (!saleId) {
    const quote = quoteFor(draft, 1, products, session.title ?? undefined);
    return (
      <div className="space-y-2 rounded-lg border border-border bg-secondary/30 px-3 py-2" data-session-payment="none">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm">Not on a paid package yet</span>
          {!selling && (
            <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setSelling(true)}>
              <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Charge for it
            </Button>
          )}
        </div>
        {selling && (
          <>
            <SessionSalePicker
              value={draft}
              onChange={(d) => (d.on ? setDraft(d) : setSelling(false))}
              products={products}
              loading={productsLoading}
              count={1}
              first={first}
              title={session.title ?? undefined}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" className="h-10" onClick={() => setSelling(false)}>Not now</Button>
              <Button
                className="h-10"
                disabled={busy || !quote}
                onClick={async () => {
                  setBusy(true);
                  await runSessionSale(sellFn as any, qc, { clientId: session.client_id, sessionIds: [session.id], draft, first });
                  setBusy(false);
                  setSelling(false);
                  qc.invalidateQueries({ queryKey: ["session-sale-id", session.id] });
                }}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {quote ? `${draft.send ? "Send" : "Make"} ${money(quote.totalCents)} link` : "Pick a price"}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!sale) return null;
  const m = saleMoney(sale);
  // Before a payment there's no tax rate on the sale, so its price reads "+ tax"; once paid, what came in.
  const priceText = `${money(m.priceCents, m.currency)}${m.state === "waiting" && !m.rate ? " + tax" : ""} · ${sale.offer_name}`;
  const line = paymentLineText(m.state, { priceText, leftText: m.leftCents ? money(m.leftCents, m.currency) : null, first });
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border px-3 py-2",
        line.tone === "paid" ? "border-success/30 bg-success/10"
          : line.tone === "waiting" || line.tone === "owed" ? "border-amber-500/30 bg-amber-500/10"
          : "border-border bg-secondary/30",
      )}
      data-session-payment={line.tone}
    >
      <div className="flex items-start gap-2">
        {line.tone === "paid"
          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />}
        <span className="min-w-0 flex-1 text-sm">{line.text}</span>
      </div>
      {(line.tone === "waiting" || line.tone === "owed") && (
        <CopyPaymentLinkButton purchaseId={sale.id} label="Copy payment link" />
      )}
    </div>
  );
}
