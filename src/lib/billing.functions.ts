import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

// -------- Issue a client account credit --------
const IssueCredit = z.object({
  client_id: z.string().uuid(),
  amount_minor: z.number().int().positive().max(100_000_000),
  currency: z.string().min(3).max(3).default("USD"),
  reason: z.string().min(3).max(2000),
  internal_note: z.string().max(2000).optional().nullable(),
});

export const issueClientCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IssueCredit.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: ledger, error: lErr } = await supabase.from("payment_ledger").insert({
      client_id: data.client_id,
      txn_type: "credit_created",
      method: "credit_balance",
      amount_minor: data.amount_minor,
      currency: data.currency,
      internal_note: data.reason,
      source: "manual",
      created_by: userId,
    }).select("*").single();
    if (lErr) throw new Error(lErr.message);

    const { data: credit, error: cErr } = await supabase.from("client_account_credits").insert({
      client_id: data.client_id,
      amount_minor: data.amount_minor,
      currency: data.currency,
      kind: "issued",
      source_ledger_id: ledger.id,
      reason: data.reason,
      internal_note: data.internal_note ?? null,
      created_by: userId,
    }).select("*").single();
    if (cErr) throw new Error(cErr.message);

    await logAudit(supabase, {
      clientId: data.client_id,
      actorUserId: userId,
      action: "credit_issued",
      recordType: "client_account_credits",
      recordId: credit.id,
      after: credit,
      reason: data.reason,
    });
    return { ok: true, credit, ledger };
  });

// -------- Apply existing credit balance to a purchase --------
const ApplyCredit = z.object({
  purchase_id: z.string().uuid(),
  amount_minor: z.number().int().positive().max(100_000_000),
  reason: z.string().max(2000).optional().nullable(),
});

export const applyClientCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ApplyCredit.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: pr } = await supabase
      .from("purchase_records")
      .select("id, client_id, currency, amount_outstanding_cents")
      .eq("id", data.purchase_id).single();
    if (!pr) throw new Error("Purchase not found");

    // Check available balance
    const { data: bal } = await supabase
      .from("client_account_credits")
      .select("amount_minor, kind")
      .eq("client_id", pr.client_id);
    const issued = (bal ?? []).filter((r: any) => r.kind === "issued").reduce((s: number, r: any) => s + r.amount_minor, 0);
    const applied = (bal ?? []).filter((r: any) => r.kind === "applied").reduce((s: number, r: any) => s + r.amount_minor, 0);
    const available = issued - applied;
    if (data.amount_minor > available) throw new Error(`Insufficient credit balance (have ${available}, need ${data.amount_minor})`);

    const { data: ledger, error: lErr } = await supabase.from("payment_ledger").insert({
      client_id: pr.client_id,
      purchase_id: pr.id,
      txn_type: "credit_applied",
      method: "credit_balance",
      amount_minor: data.amount_minor,
      currency: pr.currency ?? "USD",
      internal_note: data.reason ?? "Account credit applied",
      source: "manual",
      created_by: userId,
    }).select("*").single();
    if (lErr) throw new Error(lErr.message);

    const { error: cErr } = await supabase.from("client_account_credits").insert({
      client_id: pr.client_id,
      amount_minor: data.amount_minor,
      currency: pr.currency ?? "USD",
      kind: "applied",
      source_ledger_id: ledger.id,
      applied_to_purchase_id: pr.id,
      reason: data.reason ?? null,
      created_by: userId,
    });
    if (cErr) throw new Error(cErr.message);

    return { ok: true, ledger };
  });

// -------- Read: purchase ledger + summary --------
const GetSummary = z.object({ purchase_id: z.string().uuid() });

export const getPurchaseLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GetSummary.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
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
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const [purchasesRes, ledgerRes, creditsRes, sessionsRes, convRes, balanceRes] = await Promise.all([
      supabase.from("purchase_records").select("*").eq("client_id", data.client_id).order("purchased_at", { ascending: false }),
      supabase.from("payment_ledger").select("*").eq("client_id", data.client_id).order("transaction_date", { ascending: false }),
      supabase.from("client_account_credits").select("*").eq("client_id", data.client_id).order("created_at", { ascending: false }),
      supabase.from("session_ledger_events").select("*").eq("client_id", data.client_id).order("effective_date", { ascending: false }),
      supabase.from("service_conversions").select("*").eq("client_id", data.client_id).order("effective_date", { ascending: false }),
      supabase.rpc("session_balance", { _client_id: data.client_id }),
    ]);

    const credits = creditsRes.data ?? [];
    const issued = credits.filter((c: any) => c.kind === "issued").reduce((s: number, c: any) => s + c.amount_minor, 0);
    const applied = credits.filter((c: any) => c.kind === "applied").reduce((s: number, c: any) => s + c.amount_minor, 0);

    return {
      ok: true,
      purchases: purchasesRes.data ?? [],
      ledger: ledgerRes.data ?? [],
      credits,
      credit_balance_minor: issued - applied,
      session_events: sessionsRes.data ?? [],
      session_balance: balanceRes.data ?? [],
      conversions: convRes.data ?? [],
    };
  });

// -------- Convert service (PT -> online coaching, etc.) --------
const ConvertService = z.object({
  original_purchase_id: z.string().uuid(),
  new_offer_id: z.string().uuid().nullable().optional(),
  new_offer_name: z.string().min(1),
  effective_date: z.string(),
  value_delivered_cents: z.number().int().nonnegative(),
  new_price_cents: z.number().int().nonnegative(),
  credit_applied_cents: z.number().int().nonnegative(),
  original_disposition: z.enum(["ended","partially_replaced","continues"]).default("ended"),
  reason: z.string().optional(),
});

export const convertClientService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ConvertService.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: conv, error } = await supabase.rpc("convert_client_service", {
      _original_purchase_id: data.original_purchase_id,
      _new_offer_id: data.new_offer_id ?? null,
      _new_offer_name: data.new_offer_name,
      _effective_date: data.effective_date,
      _value_delivered_cents: data.value_delivered_cents,
      _new_price_cents: data.new_price_cents,
      _credit_applied_cents: data.credit_applied_cents,
      _original_disposition: data.original_disposition,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    await logAudit(supabase, {
      clientId: null,
      actorUserId: userId,
      action: "convert_service",
      recordType: "service_conversion",
      recordId: conv?.id ?? null,
      after: data,
      reason: data.reason,
    });
    return { ok: true, conversion: conv };
  });

// -------- Manual grant / expire helpers --------
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

export const runExpireSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase.rpc("expire_overdue_sessions");
    if (error) throw new Error(error.message);
    return { ok: true, expired: data ?? 0 };
  });