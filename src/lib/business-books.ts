/**
 * Shared shapes for Taxes & Books: database rows and the mapping into the
 * pure tax engine (business-tax.ts). Safe to import from client and server.
 */
import type { ExpenseEntry, RevenueEntry, TaxPaymentEntry, TaxSettings } from "@/lib/business-tax";
import { DEFAULT_TAX_SETTINGS } from "@/lib/business-tax";

export const RECEIPTS_BUCKET = "business-receipts";

/** The assistant's name, shown on its own everywhere. */
export const ASSISTANT_NAME = "Cleo";

export type ExpenseRow = {
  id: string;
  expense_date: string;
  vendor: string | null;
  description: string | null;
  category: string;
  amount_minor: number;
  tax_minor: number;
  currency: string;
  payment_method: string | null;
  business_use_pct: number;
  receipt_path: string | null;
  receipt_mime: string | null;
  status: "needs_review" | "reviewed";
  source: "manual" | "receipt" | "stripe_fees" | "recurring";
  external_key: string | null;
  /** The repeating bill that added it (source "recurring"). */
  recurring_id?: string | null;
  ai_summary: { confidence?: number; notes?: string | null; pst?: number | null; read?: boolean } | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TaxPaymentRow = {
  id: string;
  paid_on: string;
  kind: "gst_hst" | "income_tax";
  tax_year: number;
  period_label: string | null;
  amount_minor: number;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

export type TaxSettingsRow = {
  business_name: string;
  province: string;
  business_structure: "sole_proprietor" | "corporation";
  gst_registered: boolean;
  gst_number: string | null;
  gst_filing_frequency: "monthly" | "quarterly" | "annual";
  other_income_annual_minor: number;
  accountant_name: string | null;
  notes: string | null;
  stripe_fees_synced_at: string | null;
  /** Cleo's vibe preset and the owner's custom instructions. */
  assistant_tone?: string | null;
  assistant_instructions?: string | null;
};

/** A revenue row ready for the engine, plus what the tables and exports show. */
export type RevenueRow = RevenueEntry & {
  reference: string | null;
  /** The client the payment is from (client payments only), to open their Billing tab. */
  clientId?: string | null;
  /** The sale it went to (client payments only), so it can be named by its package. */
  saleId?: string | null;
  /** Other income: its record, to edit it from Transactions. */
  other?: OtherIncomeRow;
};

/**
 * Money the business earned that isn't a client's sale (business_other_income):
 * a sponsorship, a workshop, a referral payout, a product sold outside the app.
 * amount is what came in, GST/HST included; with none, `no_tax_reason` says why.
 */
export type OtherIncomeRow = {
  id: string;
  received_on: string;
  payer: string | null;
  description: string | null;
  kind: OtherIncomeKind;
  amount_minor: number;
  tax_minor: number;
  no_tax_reason: NoTaxReason | null;
  currency: string;
  method: string | null;
  deposit_account_id: string | null;
  reference: string | null;
  proof_path: string | null;
  proof_mime: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OtherIncomeKind = "sponsorship" | "workshop" | "product" | "referral" | "other";
export const OTHER_INCOME_KINDS: Array<{ key: OtherIncomeKind; label: string; hint: string }> = [
  { key: "sponsorship", label: "Sponsorship", hint: "A brand paying you to promote it" },
  { key: "workshop", label: "Workshop", hint: "A class, clinic, seminar or talk paid outside a client's package" },
  { key: "referral", label: "Referral", hint: "A referral commission or affiliate payout" },
  { key: "product", label: "Product sale", hint: "Something sold outside the app (merch, a program, an ebook)" },
  { key: "other", label: "Other", hint: "Any other business income" },
];
export const otherIncomeKindLabel = (k: string | null | undefined) => OTHER_INCOME_KINDS.find((x) => x.key === k)?.label ?? "Other income";

export type NoTaxReason = "outside_canada" | "not_taxable" | "not_charged";
export const NO_TAX_REASONS: Array<{ key: NoTaxReason; label: string; hint: string }> = [
  { key: "outside_canada", label: "Paid from outside Canada", hint: "Services to a business or person outside Canada are usually zero-rated." },
  { key: "not_taxable", label: "Not taxable", hint: "Exempt or not a taxable supply (your accountant can confirm)." },
  { key: "not_charged", label: "I didn't charge it", hint: "If GST was owed, it's still owed: it's worked out of the amount." },
];

/**
 * A bill that repeats (business_recurring_expenses): the app adds it to the
 * books on its day as an expense to check, never as a confirmed one.
 */
export type RecurringExpenseRow = {
  id: string;
  vendor: string;
  description: string | null;
  category: string;
  amount_minor: number;
  tax_minor: number;
  currency: string;
  payment_method: string | null;
  business_use_pct: number;
  every: "month" | "year";
  day_of_month: number;
  next_on: string;
  active: boolean;
  last_added_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OpenSaleRow = {
  id: string;
  client: string | null;
  offer: string | null;
  status: string | null;
  outstandingMinor: number;
  createdOn: string | null;
  /** For recording a payment against it (from the Billing model). */
  clientId?: string | null;
  rate?: number | null;
  nextCents?: number | null;
  viaStripe?: boolean;
};

export type BooksData = {
  asOf: string;
  settings: TaxSettingsRow | null;
  revenue: RevenueRow[];
  expenses: ExpenseRow[];
  taxPayments: TaxPaymentRow[];
  openSales: OpenSaleRow[];
  years: number[];
  /** Income that isn't a client's (also in `revenue`, as source "other"). */
  otherIncome: OtherIncomeRow[];
  /** Repeating bills set up on purpose. */
  recurring: RecurringExpenseRow[];
};

export function toTaxSettings(row: TaxSettingsRow | null | undefined): TaxSettings {
  if (!row) return DEFAULT_TAX_SETTINGS;
  return {
    businessName: row.business_name || DEFAULT_TAX_SETTINGS.businessName,
    province: row.province || "MB",
    businessStructure: row.business_structure ?? "sole_proprietor",
    gstRegistered: row.gst_registered ?? true,
    gstNumber: row.gst_number,
    gstFilingFrequency: row.gst_filing_frequency ?? "annual",
    otherIncomeAnnualMinor: Number(row.other_income_annual_minor ?? 0),
    accountantName: row.accountant_name,
    stripeFeesSyncedAt: row.stripe_fees_synced_at,
  };
}

export function toExpenseEntry(row: ExpenseRow): ExpenseEntry {
  return {
    id: row.id,
    date: row.expense_date,
    vendor: row.vendor,
    description: row.description,
    category: row.category,
    amountMinor: Number(row.amount_minor),
    taxMinor: Number(row.tax_minor),
    businessUsePct: Number(row.business_use_pct),
    currency: row.currency,
    hasReceipt: !!row.receipt_path,
    status: row.status,
    source: row.source,
  };
}

export function toTaxPaymentEntry(row: TaxPaymentRow): TaxPaymentEntry {
  return {
    id: row.id,
    paidOn: row.paid_on,
    kind: row.kind,
    taxYear: row.tax_year,
    amountMinor: Number(row.amount_minor),
    periodLabel: row.period_label,
  };
}

/** Dollars typed into a form ("1,234.5") to cents; null when not a number. */
export function parseMoneyToMinor(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function minorToInput(minor: number | null | undefined): string {
  if (minor == null) return "";
  return (minor / 100).toFixed(2);
}

export const PAYMENT_METHODS = ["Credit card", "Debit", "Cash", "E-transfer", "Bank transfer", "Stripe", "Other"] as const;

// ---------------------------------------------------------------------------
// Revenue: payment_ledger (client purchases) + member_payment_ledger (app
// memberships), reduced to money actually received or refunded.

const PAYMENT_TYPES = new Set(["payment", "deposit"]);
const REFUND_TYPES = new Set(["refund", "partial_refund"]);
// Voids are excluded via `voided` (their offsetting "reversal" row is skipped
// too); credits, write-offs and transfers are not cash in or out.
const MEMBERSHIP_PAID = new Set(["paid", "manual", "succeeded"]);

export type LedgerRowIn = {
  id: string;
  txn_type: string;
  method: string | null;
  amount_minor: number | string;
  tax_minor: number | string | null;
  currency: string | null;
  transaction_date: string;
  voided: boolean | null;
  reversal_of: string | null;
  stripe_mode: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_invoice_id?: string | null;
  external_reference?: string | null;
  receipt_number?: string | null;
  client_id?: string | null;
  /** The sale the payment went to. */
  purchase_id?: string | null;
  clients?: { full_name: string | null } | null;
  purchase_records?: { offer_name: string | null } | null;
};

export type MemberLedgerRowIn = {
  id: string;
  amount_cents: number | string | null;
  currency: string | null;
  payment_date: string;
  status: string;
  payment_method: string | null;
  stripe_mode: string | null;
  service_product: string | null;
  stripe_payment_intent_id?: string | null;
  app_members?: { full_name: string | null } | null;
};

/** An AI credit pack sold through Stripe (`ai_credit_purchases`): its own sale, with its GST. */
export type CreditSaleRowIn = {
  id: string;
  credits: number;
  amount_minor: number | string;
  tax_minor: number | string;
  total_minor: number | string;
  refunded_minor: number | string | null;
  refunded_at: string | null;
  currency: string | null;
  paid_at: string;
  stripe_mode: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  client_name?: string | null;
};

export function normalizeRevenue(ledger: LedgerRowIn[], members: MemberLedgerRowIn[], creditSales: CreditSaleRowIn[] = [], otherIncome: OtherIncomeRow[] = []): RevenueRow[] {
  const byId = new Map(ledger.map((r) => [r.id, r]));
  const out: RevenueRow[] = [];

  for (const r of ledger) {
    if (r.voided) continue;
    if (r.stripe_mode === "test") continue;
    const isPayment = PAYMENT_TYPES.has(r.txn_type);
    const isRefund = REFUND_TYPES.has(r.txn_type);
    if (!isPayment && !isRefund) continue;
    if (isPayment && r.method === "credit_balance") continue;
    const gross = Math.abs(Number(r.amount_minor) || 0);
    if (!gross) continue;
    let tax = Math.abs(Number(r.tax_minor) || 0);
    let taxEstimated = false;
    if (isRefund && tax === 0 && r.reversal_of) {
      const orig = byId.get(r.reversal_of);
      const origGross = Math.abs(Number(orig?.amount_minor) || 0);
      const origTax = Math.abs(Number(orig?.tax_minor) || 0);
      if (origGross > 0 && origTax > 0) {
        tax = Math.round((gross * origTax) / origGross);
        taxEstimated = true;
      }
    }
    out.push({
      id: r.id,
      date: r.transaction_date,
      kind: isRefund ? "refund" : "payment",
      grossMinor: gross,
      taxMinor: Math.min(tax, gross),
      taxEstimated,
      method: r.method,
      source: "client",
      clientName: r.clients?.full_name ?? null,
      clientId: r.client_id ?? null,
      saleId: r.purchase_id ?? null,
      product: r.purchase_records?.offer_name ?? null,
      currency: (r.currency ?? "CAD").toUpperCase(),
      stripe: r.method === "stripe" || !!(r.stripe_payment_intent_id || r.stripe_checkout_session_id || r.stripe_invoice_id),
      reference: r.stripe_payment_intent_id ?? r.stripe_checkout_session_id ?? r.stripe_invoice_id ?? r.external_reference ?? r.receipt_number ?? null,
    });
  }

  for (const m of members) {
    if (!MEMBERSHIP_PAID.has((m.status ?? "").toLowerCase())) continue;
    if (m.stripe_mode === "test") continue;
    const gross = Math.abs(Number(m.amount_cents) || 0);
    if (!gross) continue;
    out.push({
      id: m.id,
      date: String(m.payment_date).slice(0, 10),
      kind: "payment",
      grossMinor: gross,
      taxMinor: 0,
      method: m.payment_method,
      source: "membership",
      clientName: m.app_members?.full_name ?? null,
      product: m.service_product ?? "Membership",
      currency: (m.currency ?? "CAD").toUpperCase(),
      stripe: m.payment_method === "stripe" || !!m.stripe_payment_intent_id,
      reference: m.stripe_payment_intent_id ?? null,
    });
  }

  for (const c of creditSales) {
    if (c.stripe_mode === "test") continue;
    const gross = Math.abs(Number(c.total_minor) || 0);
    if (!gross) continue;
    const tax = Math.min(Math.abs(Number(c.tax_minor) || 0), gross);
    const common = {
      method: "stripe",
      source: "client" as const,
      clientName: c.client_name ?? null,
      product: `AI credits · ${Number(c.credits).toLocaleString("en-CA")}`,
      currency: (c.currency ?? "CAD").toUpperCase(),
      stripe: true,
      reference: c.stripe_payment_intent_id ?? c.stripe_checkout_session_id ?? null,
    };
    out.push({ ...common, id: `ai-credits:${c.id}`, date: String(c.paid_at).slice(0, 10), kind: "payment", grossMinor: gross, taxMinor: tax, taxEstimated: false });
    const refunded = Math.min(Math.abs(Number(c.refunded_minor) || 0), gross);
    if (refunded > 0) {
      out.push({
        ...common,
        id: `ai-credits-refund:${c.id}`,
        date: String(c.refunded_at ?? c.paid_at).slice(0, 10),
        kind: "refund",
        grossMinor: refunded,
        taxMinor: Math.round((refunded * tax) / gross),
        taxEstimated: true,
      });
    }
  }

  for (const o of otherIncome) {
    const gross = Math.abs(Number(o.amount_minor) || 0);
    if (!gross) continue;
    const tax = Math.min(Math.abs(Number(o.tax_minor) || 0), gross);
    const what = otherIncomeKindLabel(o.kind);
    out.push({
      id: `other:${o.id}`,
      date: String(o.received_on).slice(0, 10),
      kind: "payment",
      grossMinor: gross,
      taxMinor: tax,
      taxEstimated: false,
      method: o.method,
      source: "other",
      clientName: o.payer?.trim() || null,
      product: o.description?.trim() ? `${what} · ${o.description.trim()}` : what,
      currency: (o.currency ?? "CAD").toUpperCase(),
      stripe: false,
      reference: o.reference ?? null,
      noTaxReason: tax > 0 ? null : o.no_tax_reason,
      other: o,
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function booksYears(data: Pick<BooksData, "revenue" | "expenses" | "taxPayments" | "asOf">): number[] {
  const years = new Set<number>([Number(data.asOf.slice(0, 4))]);
  for (const r of data.revenue) years.add(Number(r.date.slice(0, 4)));
  for (const e of data.expenses) years.add(Number(e.expense_date.slice(0, 4)));
  for (const p of data.taxPayments) years.add(p.tax_year);
  return [...years].filter((y) => y >= 2000 && y <= Number(data.asOf.slice(0, 4))).sort((a, b) => b - a);
}
