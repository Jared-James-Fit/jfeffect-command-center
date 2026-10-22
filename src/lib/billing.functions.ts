import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminView } from "@/lib/permissions.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

async function logAudit(supabase: any, opts: {
  clientId?: string | null;
  actorUserId: string;
  action: string;
  recordType: string;
  recordId?: string | null;
  before?: any;
  after?: any;
  reason?: string | null;
}) {
  await supabase.from("financial_audit_events").insert({
    client_id: opts.clientId ?? null,
    actor_user_id: opts.actorUserId,
    actor_role: "admin",
    action: opts.action,
    record_type: opts.recordType,
    record_id: opts.recordId ?? null,
    before_state: opts.before ?? null,
    after_state: opts.after ?? null,
    reason: opts.reason ?? null,
  });
}

const PAYMENT_METHODS = [
  "stripe","etransfer","cash","debit","credit_card","bank_transfer",
  "cheque","credit_balance","other",
] as const;

// -------- Record a payment --------
const RecordPayment = z.object({
  purchase_id: z.string().uuid(),
  amount_minor: z.number().int().positive().max(100_000_000),
  tax_minor: z.number().int().min(0).max(100_000_000).default(0),
  method: z.enum(PAYMENT_METHODS),
  currency: z.string().min(3).max(3).default("USD"),
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  external_reference: z.string().max(200).optional().nullable(),
  stripe_payment_intent_id: z.string().max(200).optional().nullable(),
  internal_note: z.string().max(2000).optional().nullable(),
  client_note: z.string().max(2000).optional().nullable(),
});

export const recordPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RecordPayment.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: pr, error: prErr } = await supabase
      .from("purchase_records")
      .select("id, client_id, currency, amount_outstanding_cents, contract_value_cents, amount_paid_cents")
      .eq("id", data.purchase_id)
      .single();
    if (prErr || !pr) throw new Error("Purchase not found");

    const { data: inserted, error } = await supabase
      .from("payment_ledger")
      .insert({
        client_id: pr.client_id,
        purchase_id: pr.id,
        txn_type: "payment",
        method: data.method,
        amount_minor: data.amount_minor,
        tax_minor: data.tax_minor,
        currency: data.currency || pr.currency || "USD",
        transaction_date: data.transaction_date,
        external_reference: data.external_reference ?? null,
        stripe_payment_intent_id: data.stripe_payment_intent_id ?? null,
        internal_note: data.internal_note ?? null,
        client_note: data.client_note ?? null,
        source: "manual",
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(supabase, {
      clientId: pr.client_id,
      actorUserId: userId,
      action: "payment_recorded",
      recordType: "payment_ledger",
      recordId: inserted.id,
      before: { amount_paid_cents: pr.amount_paid_cents, outstanding: pr.amount_outstanding_cents },
      after: { added_minor: data.amount_minor, method: data.method },
      reason: data.internal_note ?? null,
    });

    return { ok: true, ledger: inserted };
  });

// -------- Void/reverse a previous ledger row --------
const VoidLedger = z.object({
  ledger_id: z.string().uuid(),
  reason: z.string().min(3).max(2000),
});

export const voidLedgerRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => VoidLedger.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: row, error } = await supabase
      .from("payment_ledger").select("*").eq("id", data.ledger_id).single();
    if (error || !row) throw new Error("Ledger row not found");
    if (row.voided) throw new Error("Already voided");
    if (row.source === "backfill") throw new Error("Legacy backfilled rows cannot be voided directly. Insert an adjustment instead.");

    // Mark original as voided AND write an offsetting reversal so totals recompute correctly
    const { error: vErr } = await supabase
      .from("payment_ledger")
      .update({ voided: true, void_reason: data.reason })
      .eq("id", data.ledger_id);
    if (vErr) throw new Error(vErr.message);

    const { data: reversal, error: rErr } = await supabase
      .from("payment_ledger")
      .insert({
        client_id: row.client_id,
        purchase_id: row.purchase_id,
        txn_type: "reversal",
        method: row.method,
        amount_minor: -Math.abs(row.amount_minor),
        currency: row.currency,
        reversal_of: row.id,
        internal_note: `Reversal of ${row.id}: ${data.reason}`,
        source: "manual",
        created_by: userId,
      })
      .select("*")
      .single();
    if (rErr) throw new Error(rErr.message);

    await logAudit(supabase, {
      clientId: row.client_id,
      actorUserId: userId,
      action: "payment_voided",
      recordType: "payment_ledger",
      recordId: row.id,
      before: row,
      after: reversal,
      reason: data.reason,
    });

    return { ok: true, reversal };
  });

// -------- Record a refund --------
const Refund = z.object({
  purchase_id: z.string().uuid(),
  amount_minor: z.number().int().positive().max(100_000_000),
  method: z.enum(PAYMENT_METHODS),
  reason: z.string().min(3).max(2000),
  partial: z.boolean().default(true),
  stripe_refund_id: z.string().max(200).optional().nullable(),
});

export const recordRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Refund.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: pr } = await supabase
      .from("purchase_records")
      .select("id, client_id, currency, amount_paid_cents, amount_refunded_cents")
      .eq("id", data.purchase_id)
      .single();
    if (!pr) throw new Error("Purchase not found");
    const refundable = (pr.amount_paid_cents ?? 0) - (pr.amount_refunded_cents ?? 0);
    if (data.amount_minor > refundable) {
      throw new Error(`Refund (${data.amount_minor}) exceeds refundable balance (${refundable})`);
    }

    const { data: row, error } = await supabase
      .from("payment_ledger").insert({
        client_id: pr.client_id,
        purchase_id: pr.id,
        txn_type: data.partial ? "partial_refund" : "refund",
        method: data.method,
        amount_minor: data.amount_minor,
        currency: pr.currency ?? "USD",
        external_reference: data.stripe_refund_id ?? null,
        internal_note: data.reason,
        source: "manual",
        created_by: userId,
      })
      .select("*").single();
    if (error) throw new Error(error.message);

    await logAudit(supabase, {
      clientId: pr.client_id,
      actorUserId: userId,
      action: "refund_recorded",
      recordType: "payment_ledger",
      recordId: row.id,
      before: { paid: pr.amount_paid_cents, already_refunded: pr.amount_refunded_cents },
      after: { refund_minor: data.amount_minor },
      reason: data.reason,
    });

    return { ok: true, ledger: row };
  });

// -------- Read: purchase ledger + summary --------
const GetSummary = z.object({ purchase_id: z.string().uuid() });

export const getPurchaseLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GetSummary.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { db: supabase } = await assertAdminView(context as any);
    const { data: purchase } = await supabase.from("purchase_records").select("*").eq("id", data.purchase_id).single();
    if (!purchase) throw new Error("Purchase not found");
    const { data: ledger } = await supabase
      .from("payment_ledger")
      .select("*")
      .eq("purchase_id", data.purchase_id)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });
    return { ok: true, purchase, ledger: ledger ?? [] };
  });

// -------- Read: client billing overview --------
const ClientId = z.object({ client_id: z.string().uuid() });

export const getClientBillingOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ClientId.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { db: supabase } = await assertAdminView(context as any);
    const [purchasesRes, ledgerRes, sessionsRes, balanceRes] = await Promise.all([
      supabase.from("purchase_records").select("*").eq("client_id", data.client_id).order("purchased_at", { ascending: false }),
      supabase.from("payment_ledger").select("*").eq("client_id", data.client_id).order("transaction_date", { ascending: false }),
      supabase.from("session_ledger_events").select("*").eq("client_id", data.client_id).order("effective_date", { ascending: false }),
      supabase.rpc("session_balance", { _client_id: data.client_id }, { get: true }),
    ]);

    return {
      ok: true,
      purchases: purchasesRes.data ?? [],
      ledger: ledgerRes.data ?? [],
      session_events: sessionsRes.data ?? [],
      session_balance: balanceRes.data ?? [],
    };
  });

// -------- Add sessions to a package by hand --------
const GrantSessions = z.object({
  purchase_id: z.string().uuid(),
  count: z.number().int().positive(),
  note: z.string().optional(),
});

export const grantSessionsManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GrantSessions.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: pr } = await supabase.from("purchase_records")
      .select("id, client_id, currency, package_expiry_date").eq("id", data.purchase_id).single();
    if (!pr) throw new Error("Purchase not found");
    const { error } = await supabase.from("session_ledger_events").insert({
      client_id: pr.client_id, purchase_id: pr.id, event_type: "granted",
      session_count: data.count, currency: pr.currency ?? "CAD",
      expires_at: pr.package_expiry_date, source: "admin_adjust",
      note: data.note ?? "Manually granted", created_by: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
