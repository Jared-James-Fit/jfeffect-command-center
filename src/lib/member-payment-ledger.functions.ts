/**
 * Member Payment Ledger — server functions
 *
 * Provides admin/coach tools to record manual payments and view the
 * full payment history for a member. Stripe payments are auto-recorded
 * by the webhook handler.
 *
 * Safety rules:
 *  - Entries are NEVER deleted, only status-updated.
 *  - Only admin/coach can write; members can only read their own.
 *  - Granting access via manual payment calls adminGrantTemporaryAccess.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ─────────────────────────────────────────────────────────── helpers ── */

async function assertAdminOrCoach(context: any) {
  const { supabase, userId } = context;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || !["admin", "coach"].includes(profile.role)) {
    throw new Error("Unauthorized: admin or coach role required.");
  }
  return profile;
}

/* ─────────────────────────────────────────────────────── list ledger ── */

const GetLedgerInput = z.object({ memberId: z.string().uuid() });

export const getMemberPaymentLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GetLedgerInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminOrCoach(context);
    const { supabase } = context as any;
    const { data: rows, error } = await supabase
      .from("member_payment_ledger")
      .select("*")
      .eq("member_id", data.memberId)
      .order("payment_date", { ascending: false });
    if (error) throw new Error(error.message);
    return { ledger: rows ?? [] };
  });

/* ─────────────────────────────────────── record a manual payment ── */

const RecordManualPaymentInput = z.object({
  memberId: z.string().uuid(),
  amountCents: z.number().int().min(0).optional(),
  currency: z.string().default("usd"),
  serviceProduct: z.string().optional(),
  paymentMethod: z.string().optional(),
  note: z.string().optional(),
  accessGrantDays: z.number().int().min(0).optional(),
  status: z.enum(["paid", "comped", "manual", "pending"]).default("manual"),
});

export const recordManualPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RecordManualPaymentInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminOrCoach(context);
    const { supabase, userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date();
    const accessStart = now.toISOString();
    const accessEnd = data.accessGrantDays
      ? new Date(now.getTime() + data.accessGrantDays * 86_400_000).toISOString()
      : null;

    // 1. Insert ledger entry
    const { data: entry, error } = await supabaseAdmin
      .from("member_payment_ledger")
      .insert({
        member_id: data.memberId,
        payment_date: now.toISOString(),
        amount_cents: data.amountCents ?? null,
        currency: data.currency,
        service_product: data.serviceProduct ?? null,
        payment_method: data.paymentMethod ?? null,
        manual_note: data.note ?? null,
        admin_user_id: userId,
        access_granted: !!data.accessGrantDays,
        access_start_date: data.accessGrantDays ? accessStart : null,
        access_end_date: accessEnd,
        status: data.status,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // 2. If access days specified, grant temporary access via existing admin helper
    if (data.accessGrantDays && data.accessGrantDays > 0) {
      const { adminGrantTemporaryAccess } = await import("@/lib/jf-billing.functions");
      await adminGrantTemporaryAccess({
        data: { member_id: data.memberId, days: data.accessGrantDays, note: data.note },
      });
    }

    return { ok: true, entry };
  });

/* ──────────────────────────────────────────── add a note to a ledger entry ── */

const AddLedgerNoteInput = z.object({
  entryId: z.string().uuid(),
  note: z.string().min(1),
});

export const addLedgerNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AddLedgerNoteInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminOrCoach(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("member_payment_ledger")
      .update({ manual_note: data.note })
      .eq("id", data.entryId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ──────────────────────────────────────── record a Stripe payment (internal) ── */

/**
 * Called by the Stripe webhook when a payment_intent.succeeded or
 * invoice.payment_succeeded event fires for a JF member.
 * Not exposed as a server function — called directly from the webhook handler.
 */
export async function recordStripePayment(
  supabaseAdmin: any,
  memberId: string,
  opts: {
    stripePaymentId?: string;
    stripeInvoiceId?: string;
    amountCents?: number;
    currency?: string;
    serviceProduct?: string;
  },
) {
  // Avoid duplicate entries for the same Stripe payment
  if (opts.stripePaymentId) {
    const { data: existing } = await supabaseAdmin
      .from("member_payment_ledger")
      .select("id")
      .eq("stripe_payment_id", opts.stripePaymentId)
      .maybeSingle();
    if (existing) return; // already recorded
  }

  await supabaseAdmin.from("member_payment_ledger").insert({
    member_id: memberId,
    payment_date: new Date().toISOString(),
    amount_cents: opts.amountCents ?? null,
    currency: opts.currency ?? "usd",
    service_product: opts.serviceProduct ?? "JF Membership",
    payment_method: "stripe",
    stripe_payment_id: opts.stripePaymentId ?? null,
    stripe_invoice_id: opts.stripeInvoiceId ?? null,
    access_granted: true,
    status: "paid",
  });
}
