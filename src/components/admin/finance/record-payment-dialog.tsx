/**
 * Record money that came in on a sale, from the finance desk: the same dialog
 * and the same payment row as the admin's (recordPayment), so the payment is
 * on the client's Billing, in the books' transactions and in GST/HST at once.
 * Never a typed "paid so far" or a hand-set status: what's paid is the sum of
 * the payment rows.
 */
import { RecordPaymentDialog as SaleRecordPaymentDialog, type RecordMoney } from "@/components/admin/sale-payment-dialogs";
import type { OpenSaleRow } from "@/lib/business-books";
import { fmtCad } from "@/lib/business-tax";

export type PaymentToRecord = Pick<OpenSaleRow, "id" | "client" | "offer" | "outstandingMinor" | "clientId" | "rate" | "nextCents" | "viaStripe">;

/** What the dialog needs, from a row of the collect list (the Billing model's numbers). */
export function recordMoneyFor(row: PaymentToRecord): RecordMoney {
  return {
    next: row.nextCents ? { cents: row.nextCents, date: null } : null,
    leftCents: row.outstandingMinor,
    kind: (row.viaStripe ? "plan" : "one_time") as RecordMoney["kind"],
    priceCents: row.outstandingMinor,
    currency: "CAD",
    rate: row.rate ?? null,
  };
}

export function RecordPaymentDialog({
  sale, onOpenChange, onSaved,
}: {
  sale: PaymentToRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  if (!sale) return null;
  return (
    <SaleRecordPaymentDialog
      sale={{ id: sale.id, client_id: sale.clientId ?? null, offer_name: sale.offer, currency: "CAD", stripe_subscription_id: sale.viaStripe ? "stripe" : null }}
      money={recordMoneyFor(sale)}
      open
      onOpenChange={onOpenChange}
      onDone={onSaved}
      proof={false}
      description={`${sale.client ?? "Client"} · ${sale.offer ?? "Sale"} · ${fmtCad(sale.outstandingMinor)} outstanding`}
    />
  );
}
