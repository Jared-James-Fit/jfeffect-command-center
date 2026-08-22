/**
 * Canonical PT session inventory model.
 *
 * ONE user-facing term: "Sessions". Internal tables still use legacy names
 * (session_ledger_events, session credits, pt_sessions) — that is fine and
 * intentionally left alone; this adapter is the single place the UI reads
 * from so every screen speaks the same language.
 *
 * Definitions (canonical — do not invent new counters):
 *   PURCHASED  total sessions granted/sold to the client (incl. adjustments)
 *   USED       sessions already completed / consumed
 *   SCHEDULED  sessions reserved by a booking that hasn't happened yet
 *   REMAINING  purchased - used              (sessions still owned)
 *   AVAILABLE  remaining - scheduled         (sessions free to book)
 */

export type SessionBalanceRow = {
  purchase_id: string | null;
  offer_name?: string | null;
  granted?: number | null;
  used?: number | null;
  reserved?: number | null;
  remaining?: number | null;
  expires_at?: string | null;
  currency?: string | null;
};

export type AdhocLedgerEvent = { session_count: number | null; event_type: string };

export type SessionsSummary = {
  purchased: number;
  used: number;
  scheduled: number;
  remaining: number;
  available: number;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/** Ad-hoc (no purchase attached) grants/adjustments net into the balance. */
export function adhocTotals(events: AdhocLedgerEvent[]): { granted: number; net: number } {
  let granted = 0;
  let net = 0;
  for (const e of events) {
    const c = n(e.session_count);
    net += c;
    if (c > 0) granted += c;
  }
  return { granted, net };
}

export function summarizeSessions(
  balance: SessionBalanceRow[],
  adhoc: AdhocLedgerEvent[] = [],
  scheduledCount = 0,
): SessionsSummary {
  const extra = adhocTotals(adhoc);
  const purchased = balance.reduce((s, r) => s + n(r.granted), 0) + extra.granted;
  const used = balance.reduce((s, r) => s + n(r.used), 0);
  const remaining = balance.reduce((s, r) => s + n(r.remaining), 0) + extra.net;
  const scheduled = Math.max(scheduledCount, 0);
  return {
    purchased,
    used,
    scheduled,
    remaining: Math.max(remaining, 0),
    available: Math.max(remaining - scheduled, 0),
  };
}

export type PackageValue = {
  sessions: number;
  packageValueMinor: number | null;
  amountPaidMinor: number | null;
  outstandingMinor: number | null;
  listRatePerSessionMinor: number | null;
  paidRatePerSessionMinor: number | null;
  currency: string;
};

/** Package money math — list value vs what was actually paid. */
export function packageValue(purchase: {
  sessions_purchased?: number | null;
  contract_value_cents?: number | null;
  full_payable_amount?: number | null;
  amount_paid_cents?: number | null;
  amount_outstanding_cents?: number | null;
  currency?: string | null;
}): PackageValue {
  const sessions = Math.max(n(purchase.sessions_purchased), 0);
  const packageValueMinor =
    purchase.contract_value_cents != null
      ? n(purchase.contract_value_cents)
      : purchase.full_payable_amount != null
        ? Math.round(Number(purchase.full_payable_amount) * 100)
        : null;
  const amountPaidMinor = purchase.amount_paid_cents != null ? n(purchase.amount_paid_cents) : null;
  const outstandingMinor =
    purchase.amount_outstanding_cents != null
      ? n(purchase.amount_outstanding_cents)
      : packageValueMinor != null && amountPaidMinor != null
        ? Math.max(packageValueMinor - amountPaidMinor, 0)
        : null;
  return {
    sessions,
    packageValueMinor,
    amountPaidMinor,
    outstandingMinor,
    listRatePerSessionMinor:
      packageValueMinor != null && sessions > 0 ? Math.round(packageValueMinor / sessions) : null,
    paidRatePerSessionMinor:
      amountPaidMinor != null && sessions > 0 ? Math.round(amountPaidMinor / sessions) : null,
    currency: purchase.currency ?? "CAD",
  };
}

/**
 * Stripe tax separation.
 *
 * `payment_ledger.amount_minor` is the GROSS amount Stripe actually charged
 * (subtotal + tax) and `tax_minor` is the tax portion of that charge.
 * Contract/package values (`contract_value_cents`, offer prices) are stored
 * PRE-TAX. Comparing a gross payment against a pre-tax contract overstates
 * what the client has paid toward the package, so every money surface must
 * net the tax out first.
 */
export type LedgerPaymentRow = {
  txn_type?: string | null;
  amount_minor?: number | null;
  tax_minor?: number | null;
  voided?: boolean | null;
};

export type PaymentTotals = {
  /** Total charged by Stripe, tax included. */
  grossMinor: number;
  /** Tax portion of the charges. */
  taxMinor: number;
  /** Gross minus tax — the amount that counts toward the contract. */
  netMinor: number;
  /** Refunds (gross) already netted out of the numbers above. */
  refundedMinor: number;
  /** True when a ledger row carried tax, so callers can label the split. */
  hasTax: boolean;
};

const PAYMENT_TYPES = new Set(["payment", "deposit", "credit_applied"]);
const REFUND_TYPES = new Set(["refund", "partial_refund"]);

export function paymentTotals(rows: LedgerPaymentRow[]): PaymentTotals {
  let grossMinor = 0;
  let taxMinor = 0;
  let refundedMinor = 0;
  for (const r of rows) {
    if (r.voided) continue;
    const type = (r.txn_type ?? "payment").toLowerCase();
    const amount = n(r.amount_minor);
    const tax = n(r.tax_minor);
    if (PAYMENT_TYPES.has(type)) {
      grossMinor += amount;
      taxMinor += tax;
    } else if (REFUND_TYPES.has(type)) {
      refundedMinor += amount;
      grossMinor -= amount;
      taxMinor -= tax;
    }
  }
  taxMinor = Math.max(taxMinor, 0);
  return {
    grossMinor: Math.max(grossMinor, 0),
    taxMinor,
    netMinor: Math.max(grossMinor - taxMinor, 0),
    refundedMinor,
    hasTax: taxMinor > 0,
  };
}

export type PackageValueWithTax = PackageValue & {
  /** Tax charged on this package's payments. */
  taxPaidMinor: number;
  /** Gross charged (what appears on the client's Stripe receipts). */
  grossPaidMinor: number;
  /** Pre-tax paid amount — the only figure that counts against the contract. */
  netPaidMinor: number;
  /** True when tax was separated from the ledger for this package. */
  taxSeparated: boolean;
};

/**
 * Package money math using the payment ledger so Stripe tax is excluded from
 * contract progress and per-session rates. Falls back to the purchase record
 * totals when no ledger rows exist for the package.
 */
export function packageValueWithTax(
  purchase: Parameters<typeof packageValue>[0],
  ledger: LedgerPaymentRow[] = [],
): PackageValueWithTax {
  const base = packageValue(purchase);
  const totals = paymentTotals(ledger);
  if (ledger.length === 0) {
    return {
      ...base,
      taxPaidMinor: 0,
      grossPaidMinor: base.amountPaidMinor ?? 0,
      netPaidMinor: base.amountPaidMinor ?? 0,
      taxSeparated: false,
    };
  }
  const netPaidMinor = totals.netMinor;
  const outstandingMinor =
    base.packageValueMinor != null ? Math.max(base.packageValueMinor - netPaidMinor, 0) : base.outstandingMinor;
  return {
    ...base,
    amountPaidMinor: netPaidMinor,
    outstandingMinor,
    paidRatePerSessionMinor: base.sessions > 0 ? Math.round(netPaidMinor / base.sessions) : null,
    taxPaidMinor: totals.taxMinor,
    grossPaidMinor: totals.grossMinor,
    netPaidMinor,
    taxSeparated: totals.hasTax,
  };
}

export function fmtMoneyMinor(minor: number | null | undefined, currency = "CAD"): string {
  if (minor == null) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(minor / 100);
}


/**
 * Sessions granted by a sold product, honouring the product's fulfillment
 * rule. Mirrors public.grant_sessions_if_paid_in_full() so the UI and tests
 * can reason about fulfillment without hitting the database.
 */
export type SessionFulfillment = "first_payment" | "per_installment" | "manual";

export function sessionsEntitled(input: {
  sessionsIncluded: number;
  fulfillment?: SessionFulfillment | null;
  amountPaidMinor: number;
  contractValueMinor?: number | null;
}): number {
  const total = Math.max(Math.trunc(input.sessionsIncluded || 0), 0);
  if (total === 0) return 0;
  const mode = input.fulfillment ?? "first_payment";
  if (mode === "manual") return 0;
  if (input.amountPaidMinor <= 0) return 0;
  if (mode === "per_installment" && input.contractValueMinor && input.contractValueMinor > 0) {
    return Math.min(total, Math.floor((total * input.amountPaidMinor) / input.contractValueMinor));
  }
  return total;
}

/** Idempotent top-up: what a fulfillment run should insert given prior grants. */
export function sessionsToGrant(entitled: number, alreadyGranted: number): number {
  return Math.max(entitled - Math.max(alreadyGranted, 0), 0);
}

/** Human labels for ledger events — never says "credit". */
export function sessionEventLabel(eventType: string, source?: string | null): string {
  switch (eventType) {
    case "granted":
      return source === "admin_adjust" ? "Sessions added" : "Sessions added";
    case "reserved":
      return "Session reserved (booked)";
    case "released":
      return source === "convert_on_complete" ? "Reserved session used" : "Session returned";
    case "used":
    case "consumed":
      return "Session used";
    case "adjusted":
      return source === "revert_on_uncomplete" ? "Session returned" : "Manual session adjustment";
    case "expired":
      return "Sessions expired";
    case "transferred_in":
      return "Sessions transferred in";
    case "transferred_out":
      return "Sessions transferred out";
    case "refunded":
      return "Sessions refunded";
    case "voided":
      return "Sessions voided";
    default:
      return eventType;
  }
}
