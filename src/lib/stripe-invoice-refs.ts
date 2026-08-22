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
  const payments: any[] = invoice["payments"]?.data ?? invoice["payments"] ?? [];
  for (const p of Array.isArray(payments) ? payments : []) {
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
  const payments: any[] = invoice["payments"]?.data ?? invoice["payments"] ?? [];
  for (const p of Array.isArray(payments) ? payments : []) {
    const ch = p?.payment?.charge;
    const id = str(typeof ch === "object" ? ch?.id : ch);
    if (id) return id;
  }
  return null;
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
