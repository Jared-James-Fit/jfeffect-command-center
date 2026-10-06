/**
 * stripe-invoice-refs.ts
 *
 * Stripe's newer API versions no longer expose `subscription`, `charge`, or
 * `payment_intent` as top-level fields on an Invoice object. They moved to
 * `parent.subscription_details.subscription` and to the `payments` array.
 *
 * Reading only the legacy fields silently produced `null`, which broke
 * purchase matching (and therefore transaction recording) for every new
 * subscription invoice. These helpers read both shapes.
 */

type AnyRec = Record<string, any> | null | undefined;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

/**
 * Settled entries of an invoice's `payments` list. An invoice can carry
 * cancelled/open attempts (e.g. a card PaymentIntent that was abandoned before
 * the invoice was marked paid another way), and those must never be treated as
 * the payment. Entries without a `status` (legacy shape) are kept.
 */
function paidInvoicePayments(invoice: AnyRec): any[] {
  const raw: any = invoice?.["payments"];
  const list: any[] = Array.isArray(raw) ? raw : raw?.data ?? [];
  return list.filter((p) => p && (p.status === undefined || p.status === "paid"));
}

/**
 * Id of the Stripe payment record behind an invoice that was marked paid
 * outside Stripe (e-transfer, cash, ...). Null for card/PaymentIntent payments.
 */
export function invoicePaymentRecordId(invoice: AnyRec): string | null {
  for (const p of paidInvoicePayments(invoice)) {
    if (p?.payment?.type !== "payment_record") continue;
    const rec = p.payment.payment_record;
    const id = str(typeof rec === "object" ? rec?.id : rec);
    if (id) return id;
  }
  return null;
}

/** Subscription id for an invoice, old or new API shape. */
export function invoiceSubscriptionId(invoice: AnyRec): string | null {
  if (!invoice) return null;
  const legacy = str(invoice["subscription"]);
  if (legacy) return legacy;
  const parent = invoice["parent"];
  const nested = parent?.subscription_details?.subscription;
  return str(typeof nested === "object" ? nested?.id : nested);
}

/** Payment intent id for an invoice, old or new API shape. */
export function invoicePaymentIntentId(invoice: AnyRec): string | null {
  if (!invoice) return null;
  const legacy = str(invoice["payment_intent"]);
  if (legacy) return legacy;
  for (const p of paidInvoicePayments(invoice)) {
    const pi = p?.payment?.payment_intent;
    const id = str(typeof pi === "object" ? pi?.id : pi);
    if (id) return id;
  }
  return null;
}

/** Charge id for an invoice, old or new API shape. */
export function invoiceChargeId(invoice: AnyRec): string | null {
  if (!invoice) return null;
  const legacy = str(invoice["charge"]);
  if (legacy) return legacy;
  for (const p of paidInvoicePayments(invoice)) {
    const ch = p?.payment?.charge;
    const id = str(typeof ch === "object" ? ch?.id : ch);
    if (id) return id;
  }
  return null;
}

/**
 * Map `pi:<id>` / `charge:<id>` -> invoice id for a page of invoices fetched
 * with `expand[]=data.payments`.
 *
 * Newer Stripe API versions dropped `invoice` from Charge objects, so the only
 * way to tie a subscription charge back to the invoice the app stored is via
 * the invoice's own `payments` list.
 */
export function invoiceIdByPaymentRef(invoices: AnyRec[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const inv of invoices) {
    const id = str(inv?.["id"]);
    if (!id) continue;
    const pi = invoicePaymentIntentId(inv);
    const ch = invoiceChargeId(inv);
    if (pi && !out.has(`pi:${pi}`)) out.set(`pi:${pi}`, id);
    if (ch && !out.has(`charge:${ch}`)) out.set(`charge:${ch}`, id);
  }
  return out;
}

/** Tax total for an invoice, old (`tax`) or new (`total_taxes[]`) shape. */
export function invoiceTaxMinor(invoice: AnyRec): number {
  if (!invoice) return 0;
  const legacy = invoice["tax"];
  if (typeof legacy === "number") return legacy;
  const rows: any[] = invoice["total_taxes"] ?? [];
  if (Array.isArray(rows) && rows.length) {
    return rows.reduce((sum, r) => sum + (typeof r?.amount === "number" ? r.amount : 0), 0);
  }
  const total = invoice["total"];
  const subtotal = invoice["subtotal"];
  if (typeof total === "number" && typeof subtotal === "number" && total > subtotal) {
    return total - subtotal;
  }
  return 0;
}
