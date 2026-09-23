import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IdInput = z.object({ id: z.string().uuid() });
const SETTLED = new Set(["paid", "active subscription", "refunded", "partially paid"]);

async function assertCanManagePurchase(supabase: any, userId: string, purchaseId: string) {
  const { data: purchase, error } = await supabase
    .from("purchase_records")
    .select("id, client_id, payment_status, amount_paid, amount_paid_cents, stripe_payment_intent_id, stripe_subscription_id, stripe_checkout_session_id, offer_name, archived_at")
    .eq("id", purchaseId)
    .single();
  if (error || !purchase) throw new Error("Sale not found");

  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((r: any) => r.role);
  if (roles.includes("admin")) return { purchase, actorRole: "admin" } as const;
  if (roles.includes("coach")) {
    const { data: allowed } = await supabase.rpc("is_assigned_coach", { _client_id: purchase.client_id });
    if (allowed) return { purchase, actorRole: "coach" } as const;
  }
  throw new Error("Forbidden");
}

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function expireUnpaidCheckout(sessionId: string | null | undefined) {
  if (!sessionId || !process.env.STRIPE_SECRET_KEY) return;
  try {
    const lookup = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    if (!lookup.ok) return;
    const session: any = await lookup.json().catch(() => null);
    if (!session || session.status !== "open") return;
    await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    }).catch(() => null);
  } catch {
    // Archive must still succeed if Stripe is temporarily unavailable. The
    // JF short-link token is revoked below, so the app never serves the stale URL.
  }
}

/**
 * Deleting an unpaid payment setup is allowed even when an OPEN/EXPIRED
 * Checkout Session was generated for it, but only after Stripe confirms that
 * the session never completed and has no payment/subscription attached.
 */
async function assertCheckoutCanBeRemoved(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Stripe verification is unavailable. Archive this setup instead of deleting it.");
  }

  let lookup: Response;
  try {
    lookup = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    throw new Error("Could not verify this checkout with Stripe. Archive it instead.");
  }
  if (!lookup.ok) {
    throw new Error("Could not verify this checkout with Stripe. Archive it instead.");
  }

  const session: any = await lookup.json().catch(() => null);
  if (!session) throw new Error("Could not verify this checkout with Stripe. Archive it instead.");

  const completed =
    session.status === "complete" ||
    session.payment_status === "paid" ||
    Boolean(session.payment_intent) ||
    Boolean(session.subscription);
  if (completed) {
    throw new Error("This payment setup has Stripe transaction history and cannot be deleted. Archive it instead.");
  }

  if (session.status === "open") {
    const expired = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
      },
    ).catch(() => null);
    if (!expired?.ok) {
      throw new Error("The Stripe checkout is still active and could not be closed. Archive it instead.");
    }
  }
}

export const archivePurchaseRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { purchase, actorRole } = await assertCanManagePurchase(supabase, userId, data.id);
    if (purchase.archived_at) return { ok: true, alreadyArchived: true };

    const admin = await getAdminClient();
    const status = String(purchase.payment_status ?? "").trim().toLowerCase();
    if (!SETTLED.has(status)) {
      // An archived wrong/unpaid assignment must not leave a shareable JF link
      // behind. Expire its client-specific Checkout Session when possible.
      await admin.from("payment_share_links").update({ revoked: true }).eq("purchase_record_id", data.id);
      await expireUnpaidCheckout(purchase.stripe_checkout_session_id);
    }

    const now = new Date().toISOString();
    const { error } = await admin
      .from("purchase_records")
      .update({ archived_at: now, archived_by: userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await admin.from("client_activity_log").insert({
      client_id: purchase.client_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: "purchase_archived",
      details: { purchase_id: data.id, offer_name: purchase.offer_name },
    });
    return { ok: true };
  });

export const restorePurchaseRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { purchase, actorRole } = await assertCanManagePurchase(supabase, userId, data.id);
    if (!purchase.archived_at) return { ok: true, alreadyCurrent: true };

    const admin = await getAdminClient();
    const { error } = await admin
      .from("purchase_records")
      .update({ archived_at: null, archived_by: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await admin.from("client_activity_log").insert({
      client_id: purchase.client_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: "purchase_restored",
      details: { purchase_id: data.id, offer_name: purchase.offer_name },
    });
    return { ok: true };
  });

/**
 * Permanent removal is intentionally strict:
 * - paid/refunded/partially-paid rows are never deleted
 * - rows with a payment intent, subscription, or non-voided ledger entry are never deleted
 * - an unpaid Checkout Session may be deleted only after Stripe verifies it is
 *   still open/expired and has no payment/subscription; an open session is
 *   expired first so no client can pay a deleted setup afterward
 */
export const removeUnpaidPurchaseRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { purchase, actorRole } = await assertCanManagePurchase(supabase, userId, data.id);

    const status = String(purchase.payment_status ?? "").trim().toLowerCase();
    const paidAmount = Math.max(Number(purchase.amount_paid ?? 0), Number(purchase.amount_paid_cents ?? 0) / 100);
    if (SETTLED.has(status) || paidAmount > 0) {
      throw new Error("This sale has payment history and cannot be deleted. Archive it instead.");
    }
    if (purchase.stripe_payment_intent_id || purchase.stripe_subscription_id) {
      throw new Error("This sale has Stripe transaction history and cannot be deleted. Archive it instead.");
    }

    const admin = await getAdminClient();
    const { count: ledgerCount, error: ledgerErr } = await admin
      .from("payment_ledger")
      .select("id", { count: "exact", head: true })
      .eq("purchase_id", data.id)
      .eq("voided", false);
    if (ledgerErr) throw new Error(ledgerErr.message);
    if ((ledgerCount ?? 0) > 0) {
      throw new Error("This sale has transaction history and cannot be deleted. Archive it instead.");
    }

    await assertCheckoutCanBeRemoved(purchase.stripe_checkout_session_id);

    await admin.from("payment_share_links").delete().eq("purchase_record_id", data.id);
    const { error } = await admin.from("purchase_records").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await admin.from("client_activity_log").insert({
      client_id: purchase.client_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: "unpaid_purchase_removed",
      details: { purchase_id: data.id, offer_name: purchase.offer_name },
    });
    return { ok: true };
  });
