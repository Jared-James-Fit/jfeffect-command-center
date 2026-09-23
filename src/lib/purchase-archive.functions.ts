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

async function expireUnpaidCheckout(
  sessionId: string | null | undefined,
  opts: { requireVerification?: boolean } = {},
) {
  if (!sessionId) return { ok: true, status: "none" as const };
  if (!process.env.STRIPE_SECRET_KEY) {
    if (opts.requireVerification) {
      throw new Error("Stripe could not be verified. Retry before deleting this sale.");
    }
    return { ok: false, status: "unverified" as const };
  }

  try {
    const lookup = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    if (!lookup.ok) {
      if (opts.requireVerification) {
        throw new Error("Stripe checkout could not be verified. Sync the sale and try again.");
      }
      return { ok: false, status: "unverified" as const };
    }

    const session: any = await lookup.json().catch(() => null);
    if (!session) {
      if (opts.requireVerification) throw new Error("Stripe checkout could not be verified.");
      return { ok: false, status: "unverified" as const };
    }

    // Never permanently remove a sale if Stripe says the checkout completed or
    // collected money, even when our webhook/ledger is still catching up.
    if (session.status === "complete" || session.payment_status === "paid") {
      throw new Error("Stripe shows this checkout as completed. Sync the sale instead of deleting it.");
    }

    if (session.status === "open") {
      const expired = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
        },
      );
      if (!expired.ok && opts.requireVerification) {
        throw new Error("The Stripe checkout could not be disabled. Retry before deleting this sale.");
      }
    }

    return { ok: true, status: session.status as string };
  } catch (error) {
    if (opts.requireVerification) throw error;
    // Archive must still succeed if Stripe is temporarily unavailable. The
    // JF short-link token is revoked below, so the app never serves the stale URL.
    return { ok: false, status: "unverified" as const };
  }
}

export const archivePurchaseRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { purchase, actorRole } = await assertCanManagePurchase(supabase, userId, data.id);
    if (purchase.archived_at) return { ok: true, alreadyArchived: true };

    const status = String(purchase.payment_status ?? "").trim().toLowerCase();
    if (!SETTLED.has(status)) {
      // An archived wrong/unpaid assignment must not leave a shareable JF link
      // behind. Expire its client-specific Checkout Session when possible.
      await supabase.from("payment_share_links").update({ revoked: true }).eq("purchase_record_id", data.id);
      await expireUnpaidCheckout(purchase.stripe_checkout_session_id);
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("purchase_records")
      .update({ archived_at: now, archived_by: userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabase.from("client_activity_log").insert({
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

    const { error } = await supabase
      .from("purchase_records")
      .update({ archived_at: null, archived_by: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabase.from("client_activity_log").insert({
      client_id: purchase.client_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: "purchase_restored",
      details: { purchase_id: data.id, offer_name: purchase.offer_name },
    });
    return { ok: true };
  });

/**
 * Permanent removal is only for accidental, never-paid assignments.
 *
 * A generated client Checkout Session/payment link is NOT payment history by
 * itself, so an admin can delete that mistaken sale after we verify/expire the
 * checkout. Actual payments, subscriptions and ledger rows still block delete.
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
      throw new Error("This sale has Stripe payment/subscription history and cannot be deleted. Archive it instead.");
    }

    const { count: ledgerCount, error: ledgerErr } = await supabase
      .from("payment_ledger")
      .select("id", { count: "exact", head: true })
      .eq("purchase_id", data.id)
      .eq("voided", false);
    if (ledgerErr) throw new Error(ledgerErr.message);
    if ((ledgerCount ?? 0) > 0) {
      throw new Error("This sale has transaction history and cannot be deleted. Archive it instead.");
    }

    // A client-specific unpaid Checkout Session is safe to remove only after
    // Stripe confirms it has not completed and we disable it if still open.
    await expireUnpaidCheckout(purchase.stripe_checkout_session_id, { requireVerification: true });

    await supabase.from("payment_share_links").delete().eq("purchase_record_id", data.id);
    const { error } = await supabase.from("purchase_records").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabase.from("client_activity_log").insert({
      client_id: purchase.client_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: "unpaid_purchase_deleted",
      details: {
        purchase_id: data.id,
        offer_name: purchase.offer_name,
        disabled_checkout_session: Boolean(purchase.stripe_checkout_session_id),
      },
    });
    return { ok: true };
  });