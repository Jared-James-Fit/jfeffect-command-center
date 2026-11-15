/**
 * A client's own billing, for My Purchases: read with the caller's own login,
 * so the database's rules decide who may see it (the client themselves, their
 * coach, an admin, which is how "View as client" works), never the service
 * role. What comes back is what the client may see: the coach's private notes
 * and bookkeeping fields are left out, archived sales (voided or set aside by
 * the coach) aren't sent, and neither are voided payment rows (corrections,
 * never payments). The numbers are worked out on the phone by the same model
 * the coach's Billing tab uses (buildClientPayments), so both always agree.
 *
 * getMyReceipt asks Stripe once for a payment's receipt when the app has none
 * saved (a payment recorded before receipts were kept), saves it on the
 * payment row and hands it back; it never changes an amount or a status.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPages } from "@/lib/supabase-paginate";

/** A sale's coach-only and bookkeeping fields, never sent to the client screen. */
export const PRIVATE_SALE_FIELDS = [
  "admin_notes",
  "agreement_block_override_reason",
  "agreement_block_override_by",
  "agreement_block_override_at",
  "assigned_by",
  "archived_by",
  "payment_reminder_count",
  "last_payment_reminder_at",
  "payment_reminders_paused",
  "payment_sms_sent_at",
  "payment_sms_attempts",
  "last_payment_update_source",
  "last_payment_update_at",
  "confirmation_email_sent_at",
  "billing_schedule_source",
] as const;

/** The payment fields a client screen reads (no coach's note, no who-recorded-it). */
const LEDGER_COLUMNS =
  "id, purchase_id, txn_type, method, amount_minor, tax_minor, currency, transaction_date, received_at, voided, source, receipt_url, hosted_invoice_url, invoice_pdf_url, client_note, stripe_charge_id, stripe_invoice_id, stripe_payment_intent_id";

const SESSION_COLUMNS = "id, title, session_type, session_date, start_time, end_time, timezone, location, status, uses_credit";
const EVENT_COLUMNS = "id, purchase_id, pt_session_id, event_type, session_count, source, related_event_id, effective_date, created_at";

const ClientId = z.object({ client_id: z.string().uuid() });

// Rows as the database returns them (plain JSON), read through the typed models on the phone.
export type MyBilling = {
  sales: any[];
  ledger: any[];
  session_events: any[];
  session_balance: any[];
  sessions: any[];
};

function safeSale(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const k of PRIVATE_SALE_FIELDS) delete out[k];
  // Only where it came from is read (a session sold with its booking); the rest is the coach's.
  const snap = row.offer_snapshot as { source?: unknown } | null | undefined;
  out.offer_snapshot = snap && typeof snap === "object" ? { source: snap.source ?? null } : null;
  return out;
}

function safePayment(row: Record<string, unknown>): Record<string, unknown> {
  const { stripe_charge_id, stripe_invoice_id, stripe_payment_intent_id, ...rest } = row;
  const hasUrl = !!(row.receipt_url || row.hosted_invoice_url || row.invoice_pdf_url);
  const byStripe = row.source !== "manual" && row.source !== "backfill";
  return { ...rest, receipt_fetchable: !hasUrl && byStripe && !!(stripe_charge_id || stripe_invoice_id || stripe_payment_intent_id) };
}

export const getMyBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ClientId.parse(d))
  .handler(async ({ data, context }): Promise<MyBilling> => {
    const { supabase } = context as any;
    // The caller's own login: a client sees only their own record, a coach their clients', an admin anyone's.
    const { data: client, error: cErr } = await supabase.from("clients").select("id").eq("id", data.client_id).maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!client) throw new Error("Not found");

    const [salesRes, ledger, events, balanceRes, sessions] = await Promise.all([
      supabase
        .from("purchase_records")
        .select("*")
        .eq("client_id", data.client_id)
        .is("archived_at", null)
        .order("purchased_at", { ascending: false }),
      fetchAllPages((from, to) =>
        supabase
          .from("payment_ledger")
          .select(LEDGER_COLUMNS)
          .eq("client_id", data.client_id)
          .eq("voided", false)
          .order("transaction_date", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllPages((from, to) =>
        supabase
          .from("session_ledger_events")
          .select(EVENT_COLUMNS)
          .eq("client_id", data.client_id)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      supabase.rpc("session_balance", { _client_id: data.client_id }, { get: true }),
      // What the client's own calendar shows: sessions marked for them.
      fetchAllPages((from, to) =>
        supabase
          .from("pt_sessions")
          .select(SESSION_COLUMNS)
          .eq("client_id", data.client_id)
          .eq("visible_to_client", true)
          .order("session_date", { ascending: false })
          .order("start_time", { ascending: false })
          .range(from, to),
      ),
    ]);
    if (salesRes.error) throw new Error(salesRes.error.message);

    return {
      sales: ((salesRes.data ?? []) as Record<string, unknown>[]).map(safeSale),
      ledger: (ledger as Record<string, unknown>[]).map(safePayment),
      session_events: events as Record<string, unknown>[],
      session_balance: (balanceRes.data ?? []) as Record<string, unknown>[],
      sessions: sessions as Record<string, unknown>[],
    };
  });

const LedgerId = z.object({ ledger_id: z.string().uuid() });

export const getMyReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LedgerId.parse(d))
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const { supabase } = context as any;
    // Read as the caller: only someone who may see this payment gets its receipt.
    const { data: row, error } = await supabase
      .from("payment_ledger")
      .select("id, voided, source, receipt_url, hosted_invoice_url, invoice_pdf_url, stripe_charge_id, stripe_invoice_id, stripe_payment_intent_id")
      .eq("id", data.ledger_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.voided) throw new Error("Not found");
    const saved = row.receipt_url ?? row.hosted_invoice_url ?? row.invoice_pdf_url ?? null;
    if (saved) return { url: saved };
    if (row.source === "manual" || row.source === "backfill") return { url: null };

    const { stripeFetch } = await import("@/lib/stripe.server");
    let receipt: string | null = null;
    let invoiceUrl: string | null = null;
    let invoicePdf: string | null = null;
    try {
      if (row.stripe_charge_id) {
        const ch = await stripeFetch(`/charges/${encodeURIComponent(row.stripe_charge_id)}`);
        receipt = ch?.receipt_url ?? null;
      }
      if (!receipt && row.stripe_payment_intent_id) {
        const pi = await stripeFetch(`/payment_intents/${encodeURIComponent(row.stripe_payment_intent_id)}?expand[]=latest_charge`);
        receipt = typeof pi?.latest_charge === "object" ? pi.latest_charge?.receipt_url ?? null : null;
      }
      if (!receipt && row.stripe_invoice_id) {
        const inv = await stripeFetch(`/invoices/${encodeURIComponent(row.stripe_invoice_id)}`);
        invoiceUrl = inv?.hosted_invoice_url ?? null;
        invoicePdf = inv?.invoice_pdf ?? null;
      }
    } catch (e: any) {
      throw new Error("Stripe couldn't find this receipt right now. Try again later.");
    }
    const url = receipt ?? invoiceUrl ?? invoicePdf;
    if (!url) return { url: null };

    // Kept on the payment so it's never asked for twice; only fills what's empty.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { receipt_url?: string; hosted_invoice_url?: string; invoice_pdf_url?: string } = {};
    if (receipt) patch.receipt_url = receipt;
    if (invoiceUrl) patch.hosted_invoice_url = invoiceUrl;
    if (invoicePdf) patch.invoice_pdf_url = invoicePdf;
    await supabaseAdmin
      .from("payment_ledger")
      .update(patch)
      .eq("id", row.id)
      .is("receipt_url", null)
      .is("hosted_invoice_url", null)
      .is("invoice_pdf_url", null);
    return { url };
  });
