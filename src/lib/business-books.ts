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
  source: "manual" | "receipt" | "stripe_fees";
  external_key: string | null;
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
export type RevenueRow = RevenueEntry & { reference: string | null };

export type OpenSaleRow = {
  id: string;
  client: string | null;
  offer: string | null;
  status: string | null;
  outstandingMinor: number;
  createdOn: string | null;
};

export type BooksData = {
  asOf: string;
  settings: TaxSettingsRow | null;
  revenue: RevenueRow[];
  expenses: ExpenseRow[];
  taxPayments: TaxPaymentRow[];
  openSales: OpenSaleRow[];
  years: number[];
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

export function normalizeRevenue(ledger: LedgerRowIn[], members: MemberLedgerRowIn[]): RevenueRow[] {
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

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function booksYears(data: Pick<BooksData, "revenue" | "expenses" | "taxPayments" | "asOf">): number[] {
  const years = new Set<number>([Number(data.asOf.slice(0, 4))]);
  for (const r of data.revenue) years.add(Number(r.date.slice(0, 4)));
  for (const e of data.expenses) years.add(Number(e.expense_date.slice(0, 4)));
  for (const p of data.taxPayments) years.add(p.tax_year);
  return [...years].filter((y) => y >= 2000 && y <= Number(data.asOf.slice(0, 4))).sort((a, b) => b - a);
}
