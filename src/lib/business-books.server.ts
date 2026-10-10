/**
 * Server-side loading for Taxes & Books and Cleo. Every query runs on
 * the caller's (RLS-scoped) client, so only the owner and finance logins get
 * rows back. Payer and offer names come from books_labels() and open sales
 * from books_open_sales(): finance can't read client, member or purchase rows.
 */
import type { BooksData, ExpenseRow, LedgerRowIn, MemberLedgerRowIn, OpenSaleRow, TaxPaymentRow, TaxSettingsRow } from "@/lib/business-books";
import { booksYears, normalizeRevenue } from "@/lib/business-books";
import { isExpenseCategoryKey } from "@/lib/business-expense-categories";
import { businessToday } from "@/lib/billing-schedule";

const OPEN_SALE_STATUSES = ["Unpaid", "Pending", "Pending Payment", "Payment Link Sent", "Partially Paid", "Not Sent"];

export async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

/**
 * The books (Taxes & Books, expenses, receipts, tax settings) belong to the
 * business owner, not every admin. Enforced by RLS too; this gives a clear
 * error instead of empty results.
 */
export async function isBusinessOwner(supabase: any, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_business_owner", { _uid: userId });
  return !error && data === true;
}

export async function assertBusinessOwner(supabase: any, userId: string) {
  await assertAdmin(supabase, userId);
  if (!(await isBusinessOwner(supabase, userId))) throw new Error("Taxes & Books is private to the business owner.");
}

/**
 * Read or record in the books: the business owner, or a finance login with
 * the permission (see has_permission). Deleting stays with the
 * owner (assertBusinessOwner). Returns who is acting.
 */
export async function assertBooksAccess(
  ctx: { supabase: any; userId: string; claims?: Record<string, any> | null },
  perm: "finance.read" | "finance.record",
): Promise<"owner" | "finance"> {
  if (await isBusinessOwner(ctx.supabase, ctx.userId)) return "owner";
  const { data: roles } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (!(roles ?? []).some((r: any) => r.role === "finance")) {
    throw new Error("Taxes & Books is private to the business owner.");
  }
  const { assertPermission } = await import("@/lib/permissions.server");
  await assertPermission(ctx, perm);
  return "finance";
}

function must<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message ?? res.error}`);
  return res.data;
}

/** Assigned sales that aren't fully paid (operational, not tax data). */
export async function loadOpenSales(supabase: any): Promise<OpenSaleRow[]> {
  const res = await supabase
    .from("purchase_records")
    .select("id, offer_name, payment_status, amount_outstanding_cents, full_payable_amount, amount_paid, created_at, clients(full_name)")
    .in("payment_status", OPEN_SALE_STATUSES)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  return toOpenSales(res.error ? [] : res.data ?? []);
}

function toOpenSales(rows: any[]): OpenSaleRow[] {
  return rows
    .map((p) => {
      const outstanding =
        p.amount_outstanding_cents != null
          ? Number(p.amount_outstanding_cents)
          : Math.max(0, Math.round((Number(p.full_payable_amount) || 0) * 100) - Math.round((Number(p.amount_paid) || 0) * 100));
      return {
        id: p.id,
        client: p.clients?.full_name ?? null,
        offer: p.offer_name ?? null,
        status: p.payment_status ?? null,
        outstandingMinor: outstanding,
        createdOn: p.created_at ? String(p.created_at).slice(0, 10) : null,
      };
    })
    .filter((o) => o.outstandingMinor > 0);
}

type BooksLabels = { clients: Record<string, string | null>; purchases: Record<string, string | null>; members: Record<string, string | null> };

/** Payer and offer names for the ledger rows (books_labels, gated on finance.read). */
async function loadBooksLabels(
  supabase: any,
  ledger: Array<{ client_id?: string | null; purchase_id?: string | null }>,
  members: Array<{ member_id?: string | null }>,
): Promise<BooksLabels> {
  const uniq = (xs: Array<string | null | undefined>) => Array.from(new Set(xs.filter((x): x is string => !!x)));
  const { data, error } = await supabase.rpc("books_labels", {
    _client_ids: uniq(ledger.map((r) => r.client_id)),
    _purchase_ids: uniq(ledger.map((r) => r.purchase_id)),
    _member_ids: uniq(members.map((r) => r.member_id)),
  });
  // Names are a nicety: the numbers are still right without them.
  if (error || !data) return { clients: {}, purchases: {}, members: {} };
  return { clients: data.clients ?? {}, purchases: data.purchases ?? {}, members: data.members ?? {} };
}

export async function loadBooksData(supabase: any): Promise<BooksData> {
  const asOf = businessToday();
  const [settingsRes, ledgerRes, memberRes, expRes, payRes, openRes] = await Promise.all([
    supabase.from("business_tax_settings").select("*").maybeSingle(),
    supabase
      .from("payment_ledger")
      .select(
        "id, txn_type, method, amount_minor, tax_minor, currency, transaction_date, voided, reversal_of, stripe_mode, stripe_payment_intent_id, stripe_checkout_session_id, stripe_invoice_id, external_reference, receipt_number, client_id, purchase_id",
      )
      .order("transaction_date", { ascending: true })
      .limit(10000),
    supabase
      .from("member_payment_ledger")
      .select("id, amount_cents, currency, payment_date, status, payment_method, stripe_mode, service_product, stripe_payment_intent_id, member_id")
      .limit(5000),
    supabase.from("business_expenses").select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(10000),
    supabase.from("business_tax_payments").select("*").order("paid_on", { ascending: false }).limit(1000),
    supabase.rpc("books_open_sales", { _statuses: OPEN_SALE_STATUSES }),
  ]);

  const settings = must(settingsRes, "tax settings") as TaxSettingsRow | null;
  const ledgerRaw = (must(ledgerRes, "payments") ?? []) as Array<LedgerRowIn & { client_id?: string | null; purchase_id?: string | null }>;
  const membersRaw = (memberRes.error ? [] : memberRes.data ?? []) as Array<MemberLedgerRowIn & { member_id?: string | null }>;
  const labels = await loadBooksLabels(supabase, ledgerRaw, membersRaw);
  const ledger: LedgerRowIn[] = ledgerRaw.map(({ client_id, purchase_id, ...r }) => ({
    ...r,
    clients: client_id ? { full_name: labels.clients[client_id] ?? null } : null,
    purchase_records: purchase_id ? { offer_name: labels.purchases[purchase_id] ?? null } : null,
  }));
  const members: MemberLedgerRowIn[] = membersRaw.map(({ member_id, ...r }) => ({
    ...r,
    app_members: member_id ? { full_name: labels.members[member_id] ?? null } : null,
  }));
  const expenses = ((must(expRes, "expenses") ?? []) as ExpenseRow[]).map((e) => ({
    ...e,
    amount_minor: Number(e.amount_minor),
    tax_minor: Number(e.tax_minor),
    business_use_pct: Number(e.business_use_pct),
  }));
  const taxPayments = ((must(payRes, "tax payments") ?? []) as TaxPaymentRow[]).map((p) => ({ ...p, amount_minor: Number(p.amount_minor) }));
  const openSales: OpenSaleRow[] = ((openRes.error ? [] : openRes.data ?? []) as any[])
    .map((p) => {
      const outstanding =
        p.amount_outstanding_cents != null
          ? Number(p.amount_outstanding_cents)
          : Math.max(0, Math.round((Number(p.full_payable_amount) || 0) * 100) - Math.round((Number(p.amount_paid) || 0) * 100));
      return {
        id: p.id,
        client: p.client_full_name ?? null,
        offer: p.offer_name ?? null,
        status: p.payment_status ?? null,
        outstandingMinor: outstanding,
        createdOn: p.created_at ? String(p.created_at).slice(0, 10) : null,
      };
    })
    .filter((o) => o.outstandingMinor > 0);

  const revenue = normalizeRevenue(ledger ?? [], members);
  const partial = { asOf, revenue, expenses, taxPayments };
  return { ...partial, settings, openSales, years: booksYears(partial) };
}

// ---------------------------------------------------------------------------
// Lovable AI Gateway (OpenAI-compatible chat completions)

export const BOOKS_AI_MODEL = "google/gemini-3-flash-preview";

export async function gatewayChat(messages: any[], opts: { model?: string } = {}): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI is not configured (LOVABLE_API_KEY missing).");
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({ model: opts.model ?? BOOKS_AI_MODEL, messages }),
  });
  if (resp.status === 429) throw new Error("Cleo is getting too many requests. Try again in a minute.");
  if (resp.status === 402) throw new Error("AI credits are used up. Add credits in Lovable to keep using Cleo.");
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`AI request failed (${resp.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const json: any = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: any) => c?.text ?? "").join("");
  return "";
}

export function parseJsonLoose(text: string): any {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI did not return JSON");
    return JSON.parse(m[0]);
  }
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Receipt reading

export type ReceiptRead = {
  isReceipt: boolean;
  vendor: string | null;
  date: string | null;
  totalMinor: number | null;
  gstMinor: number;
  pstMinor: number | null;
  currency: string;
  category: string;
  description: string | null;
  paymentMethod: string | null;
  businessUsePct: number;
  confidence: number;
  notes: string | null;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Validate whatever the model returned; never trust its shape. */
export function sanitizeReceiptRead(raw: any, today: string): ReceiptRead {
  const total = num(raw?.total);
  const gst = num(raw?.gst_hst);
  const pst = num(raw?.pst);
  const totalMinor = total != null && total >= 0 && total < 1_000_000 ? Math.round(total * 100) : null;
  let gstMinor = gst != null && gst >= 0 ? Math.round(gst * 100) : 0;
  if (totalMinor != null && gstMinor > totalMinor) gstMinor = 0;
  const dateStr = typeof raw?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  const dateOk = dateStr && dateStr >= "2000-01-01" && dateStr <= today ? dateStr : null;
  const category = typeof raw?.category === "string" && isExpenseCategoryKey(raw.category) ? raw.category : "uncategorized";
  const use = num(raw?.business_use_pct);
  const conf = num(raw?.confidence);
  const currency = typeof raw?.currency === "string" && /^[A-Za-z]{3}$/.test(raw.currency) ? raw.currency.toUpperCase() : "CAD";
  const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  return {
    isReceipt: raw?.is_receipt !== false,
    vendor: clip(raw?.vendor, 120),
    date: dateOk,
    totalMinor,
    gstMinor,
    pstMinor: pst != null && pst >= 0 ? Math.round(pst * 100) : null,
    currency,
    category,
    description: clip(raw?.description, 200),
    paymentMethod: clip(raw?.payment_method, 40),
    businessUsePct: use != null && use >= 0 && use <= 100 ? Math.round(use) : 100,
    confidence: conf != null ? Math.max(0, Math.min(1, conf)) : 0,
    notes: clip(raw?.notes, 300),
  };
}

export function receiptNeedsReview(r: ReceiptRead): boolean {
  return !r.isReceipt || r.totalMinor == null || r.date == null || r.category === "uncategorized" || r.confidence < 0.8;
}
