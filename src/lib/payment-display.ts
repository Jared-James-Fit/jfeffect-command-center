/**
 * Shared PaymentDisplay resolver.
 *
 * One source of truth for how a purchase renders on:
 *   - Client "My Purchases" (list + detail)
 *   - Admin client profile purchase cards
 *   - Admin Transactions detail
 *
 * Rules:
 *   - Money math uses *_cents fields when present, else *_amount fields.
 *   - Outstanding = contract_value_cents - amount_paid_cents (clamped ≥ 0)
 *     minus refunds/credits that are already netted in amount_paid_cents.
 *   - "Paid in Full" wording is used whenever outstanding <= 0 AND amount paid > 0.
 *   - Next billing date is only surfaced when is_recurring is true.
 *   - Receipt / hosted invoice / invoice PDF URLs are surfaced only when present.
 *   - No Stripe IDs are exposed to clients (caller decides whether to render admin fields).
 */

export type PaymentDisplayStatus =
  | "paid"
  | "partially_paid"
  | "unpaid"
  | "past_due"
  | "refunded"
  | "voided"
  | "cancelled"
  | "active_subscription"
  | "pending_setup";

export type PaymentDisplay = {
  status: PaymentDisplayStatus;
  statusLabel: string;
  statusTone: string; // Tailwind classes for a Badge
  currency: string;
  contractTotal: number;   // major units — the true amount owed after discounts
  amountPaid: number;      // major units — verified paid
  amountOutstanding: number; // major units — 0 when paid in full
  amountRefunded: number;  // major units
  isPaidInFull: boolean;
  isRecurring: boolean;
  nextBillingDate: string | null; // ISO, only when recurring & active
  paymentDate: string | null;     // ISO
  paymentMethodLabel: string | null;
  productName: string;
  productDescription: string | null;
  productDescriptionMissing: boolean; // true = admin-facing warning
  receiptUrl: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  stripePaymentIntentId: string | null;
  stripeSubscriptionId: string | null;
};

type PurchaseInput = {
  offer_name?: string | null;
  offer_type?: string | null;
  short_description?: string | null;
  full_description?: string | null;
  currency?: string | null;
  full_payable_amount?: number | string | null;
  amount_paid?: number | string | null;
  amount_paid_cents?: number | null;
  amount_refunded_cents?: number | null;
  contract_value_cents?: number | null;
  payment_status?: string | null;
  is_recurring?: boolean | null;
  paid_at?: string | null;
  purchased_at?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_receipt_url?: string | null;
  payment_frequency?: string | null;
  // Joined via ledger (optional)
  latest_ledger?: {
    method?: string | null;
    receipt_url?: string | null;
    hosted_invoice_url?: string | null;
    invoice_pdf_url?: string | null;
    transaction_date?: string | null;
  } | null;
  // Joined subscription info (optional)
  next_billing_date?: string | null;
};

function toNum(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

function centsToMajor(cents: number | null | undefined, fallback = 0): number {
  if (cents == null || !Number.isFinite(cents)) return fallback;
  return Math.round(cents) / 100;
}

function methodLabel(method?: string | null): string | null {
  if (!method) return null;
  const m = method.toLowerCase();
  if (m === "stripe") return "Credit card (Stripe)";
  if (m === "etransfer") return "E-transfer";
  if (m === "cash") return "Cash";
  if (m === "debit") return "Debit";
  if (m === "credit_card") return "Credit card";
  if (m === "bank_transfer") return "Bank transfer";
  if (m === "cheque") return "Cheque";
  if (m === "credit_balance") return "Credit balance";
  if (m === "legacy_backfill") return "Manual (legacy)";
  return method.charAt(0).toUpperCase() + method.slice(1);
}

/**
 * Resolve a purchase row + optional ledger row into a single display model.
 * Reads only from data the caller already fetched — no side effects.
 */
export function resolvePaymentDisplay(p: PurchaseInput): PaymentDisplay {
  const currency = (p.currency ?? "USD").toUpperCase();

  // Money — prefer *_cents when set; fall back to numeric amount fields.
  const paidCents =
    p.amount_paid_cents != null
      ? p.amount_paid_cents
      : Math.round(toNum(p.amount_paid) * 100);
  const contractCents =
    p.contract_value_cents != null
      ? p.contract_value_cents
      : Math.round(toNum(p.full_payable_amount) * 100);
  const refundedCents = p.amount_refunded_cents ?? 0;

  const amountPaid = centsToMajor(paidCents);
  const contractTotal = centsToMajor(contractCents);
  const amountRefunded = centsToMajor(refundedCents);
  const rawOutstanding = contractCents - paidCents;
  const amountOutstanding = rawOutstanding > 0 ? centsToMajor(rawOutstanding) : 0;

  const rawStatus = (p.payment_status ?? "").trim();
  const isPaidInFull = amountPaid > 0 && amountOutstanding === 0;
  const isRecurring = !!p.is_recurring;

  // Status resolution — prefer authoritative row status, then derive.
  let status: PaymentDisplayStatus;
  if (rawStatus === "Refunded") status = "refunded";
  else if (rawStatus === "Voided") status = "voided";
  else if (rawStatus === "Cancelled" || rawStatus === "Expired") status = "cancelled";
  else if (rawStatus === "Active Subscription") status = "active_subscription";
  else if (rawStatus === "Overdue" || rawStatus === "Failed" || rawStatus === "Manual Payment Needed" || rawStatus === "Past Due")
    status = "past_due";
  else if (isPaidInFull || rawStatus === "Paid") status = "paid";
  else if (amountPaid > 0 && amountOutstanding > 0) status = "partially_paid";
  else if (rawStatus === "Unpaid") status = "unpaid";
  else status = "pending_setup";

  const statusLabel = (() => {
    switch (status) {
      case "paid": return "Paid in Full";
      case "partially_paid": return "Partially Paid";
      case "unpaid": return "Unpaid";
      case "past_due": return "Past Due";
      case "refunded": return "Refunded";
      case "voided": return "Voided";
      case "cancelled": return "Cancelled";
      case "active_subscription": return "Active Subscription";
      case "pending_setup": return "Payment setup pending";
    }
  })();

  const statusTone = (() => {
    switch (status) {
      case "paid":
      case "active_subscription":
        return "border-emerald-500/40 text-emerald-500 bg-emerald-500/10";
      case "partially_paid":
        return "border-amber-500/40 text-amber-500 bg-amber-500/10";
      case "past_due":
      case "unpaid":
        return "border-destructive/40 text-destructive bg-destructive/5";
      case "refunded":
      case "voided":
      case "cancelled":
        return "border-border text-muted-foreground";
      case "pending_setup":
        return "border-warning/40 text-warning bg-warning/5";
    }
  })();

  // Description resolution — prefer stored fields; caller can enrich with offer data.
  const short = (p.short_description ?? "").trim();
  const full = (p.full_description ?? "").trim();
  const productDescription = full || short || null;
  const productDescriptionMissing = !productDescription;

  // Method
  const paymentMethodLabel = methodLabel(p.latest_ledger?.method ?? null);

  // Next billing date — only surface for genuinely recurring, non-terminated purchases
  const terminated = status === "cancelled" || status === "refunded" || status === "voided";
  const nextBillingDate =
    isRecurring && !terminated && p.next_billing_date ? p.next_billing_date : null;

  return {
    status,
    statusLabel,
    statusTone,
    currency,
    contractTotal,
    amountPaid,
    amountOutstanding,
    amountRefunded,
    isPaidInFull,
    isRecurring,
    nextBillingDate,
    paymentDate: p.paid_at ?? p.latest_ledger?.transaction_date ?? p.purchased_at ?? null,
    paymentMethodLabel,
    productName: p.offer_name ?? "Purchase",
    productDescription,
    productDescriptionMissing,
    receiptUrl: p.latest_ledger?.receipt_url ?? p.stripe_receipt_url ?? null,
    hostedInvoiceUrl: p.latest_ledger?.hosted_invoice_url ?? null,
    invoicePdfUrl: p.latest_ledger?.invoice_pdf_url ?? null,
    stripePaymentIntentId: p.stripe_payment_intent_id ?? null,
    stripeSubscriptionId: p.stripe_subscription_id ?? null,
  };
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}