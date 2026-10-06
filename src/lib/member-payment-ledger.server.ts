/**
 * Server-only helper: record a Stripe payment for a JF member in
 * member_payment_ledger. Called by the Stripe webhook when a membership invoice
 * is paid. Idempotent on the Stripe invoice id / payment id.
 */
export async function recordStripePayment(
  supabaseAdmin: any,
  memberId: string,
  opts: {
    stripePaymentId?: string | null;
    stripeInvoiceId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeMode?: string | null;
    receiptUrl?: string | null;
    amountCents?: number;
    currency?: string;
    serviceProduct?: string;
    paidAt?: string;
  },
): Promise<void> {
  for (const [col, val] of [
    ["stripe_invoice_id", opts.stripeInvoiceId],
    ["stripe_payment_id", opts.stripePaymentId],
  ] as const) {
    if (!val) continue;
    const { data: existing } = await supabaseAdmin
      .from("member_payment_ledger")
      .select("id")
      .eq(col, val)
      .maybeSingle();
    if (existing) return; // already recorded
  }

  const { error } = await supabaseAdmin.from("member_payment_ledger").insert({
    member_id: memberId,
    payment_date: opts.paidAt ?? new Date().toISOString(),
    amount_cents: opts.amountCents ?? null,
    currency: (opts.currency ?? "usd").toUpperCase(),
    service_product: opts.serviceProduct ?? "JF Membership",
    payment_method: "stripe",
    stripe_payment_id: opts.stripePaymentId ?? null,
    stripe_invoice_id: opts.stripeInvoiceId ?? null,
    stripe_payment_intent_id: opts.stripePaymentIntentId ?? null,
    stripe_customer_id: opts.stripeCustomerId ?? null,
    stripe_subscription_id: opts.stripeSubscriptionId ?? null,
    stripe_mode: opts.stripeMode ?? null,
    receipt_url: opts.receiptUrl ?? null,
    access_granted: true,
    status: "paid",
  });
  if (error) console.error("[member-ledger] insert failed", { memberId, message: error.message });
}
