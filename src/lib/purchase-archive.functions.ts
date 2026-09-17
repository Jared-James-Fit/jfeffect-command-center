import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IdInput = z.object({ id: z.string().uuid() });

async function assertCanManagePurchase(supabase: any, userId: string, purchaseId: string) {
  const { data: purchase, error } = await supabase
    .from("purchase_records")
    .select("id, client_id, payment_status, amount_paid, amount_paid_cents, stripe_payment_intent_id, stripe_subscription_id, stripe_checkout_session_id, offer_name, archived_at")
    .eq("id", purchaseId)
    .single();
  if (error || !purchase) throw new Error("Sale not found");

  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((r: any) => r.role);
  if (roles.includes("admin")) return purchase;
  if (roles.includes("coach")) {
    const { data: allowed } = await supabase.rpc("is_assigned_coach", { p_client_id: purchase.client_id });
    if (allowed) return purchase;
  }
  throw new Error("Forbidden");
}

export const archivePurchaseRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const purchase = await assertCanManagePurchase(supabase, userId, data.id);
    if (purchase.archived_at) return { ok: true, alreadyArchived: true };

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("purchase_records")
      .update({ archived_at: now, archived_by: userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabase.from("client_activity_log").insert({
      client_id: purchase.client_id,
      actor_user_id: userId,
      actor_role: "admin",
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
    const purchase = await assertCanManagePurchase(supabase, userId, data.id);
    if (!purchase.archived_at) return { ok: true, alreadyCurrent: true };

    const { error } = await supabase
      .from("purchase_records")
      .update({ archived_at: null, archived_by: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabase.from("client_activity_log").insert({
      client_id: purchase.client_id,
      actor_user_id: userId,
      actor_role: "admin",
      action: "purchase_restored",
      details: { purchase_id: data.id, offer_name: purchase.offer_name },
    });
    return { ok: true };
  });

/**
 * Permanent removal is intentionally much stricter than archive. It is only
 * for accidental, never-paid assignments. Any Stripe payment/subscription or
 * ledger evidence blocks deletion so financial history cannot disappear.
 */
export const removeUnpaidPurchaseRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const purchase = await assertCanManagePurchase(supabase, userId, data.id);

    const status = String(purchase.payment_status ?? "").trim().toLowerCase();
    const paidAmount = Math.max(Number(purchase.amount_paid ?? 0), Number(purchase.amount_paid_cents ?? 0) / 100);
    if (["paid", "active subscription", "refunded", "partially paid"].includes(status) || paidAmount > 0) {
      throw new Error("This sale has payment history and cannot be deleted. Archive it instead.");
    }
    if (purchase.stripe_payment_intent_id || purchase.stripe_subscription_id) {
      throw new Error("This sale is linked to a Stripe payment/subscription and cannot be deleted. Archive it instead.");
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

    // Revoke short links first. Checkout Sessions are temporary and are not a
    // payment; deleting this accidental app assignment does not charge/cancel
    // anything in Stripe.
    await supabase
      .from("payment_share_links")
      .update({ revoked: true })
      .eq("purchase_record_id", data.id);

    const { error } = await supabase.from("purchase_records").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabase.from("client_activity_log").insert({
      client_id: purchase.client_id,
      actor_user_id: userId,
      actor_role: "admin",
      action: "unpaid_purchase_removed",
      details: { purchase_id: data.id, offer_name: purchase.offer_name },
    });
    return { ok: true };
  });