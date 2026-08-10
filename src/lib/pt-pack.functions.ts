import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Personal Training session packs — selling + booking status transitions.
 *
 * Packs are purchase_records rows with `sessions_purchased` > 0; session
 * credits live in the append-only `session_ledger_events` ledger and are
 * granted automatically by the `purchase_records_grant_sessions` trigger
 * once the purchase is paid in full. Bookings are `pt_sessions` rows; the
 * `pt_session_status_change` trigger drives the wallet state machine:
 * booking reserves a credit, cancelling/deleting releases it, completing
 * converts the reservation into a used credit, and undo restores it.
 */

const SellInput = z.object({
  clientId: z.string().uuid(),
  packageName: z.string().min(1).max(160),
  sessionCount: z.number().int().min(1).max(500),
  totalPriceMinor: z.number().int().min(0).max(100_000_00),
  currency: z.string().length(3).default("CAD"),
  paymentMode: z.enum(["paid", "partial", "pending"]),
  amountPaidMinor: z.number().int().min(0).max(100_000_00).optional(),
  paymentMethod: z.string().max(80).nullish(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  note: z.string().max(2000).nullish(),
  showValueToClient: z.boolean().default(true),
});

export const sellSessionPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SellInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) throw new Error("Only admins can sell session packs.");

    const total = data.totalPriceMinor;
    const paidMinor =
      data.paymentMode === "paid" ? total : data.paymentMode === "partial" ? Math.min(data.amountPaidMinor ?? 0, total) : 0;
    const paidInFull = paidMinor >= total;
    const paymentStatus = paidInFull ? "Paid" : paidMinor > 0 ? "Partial" : "Pending";
    const now = new Date().toISOString();
    const notesParts = [data.note?.trim(), data.paymentMethod?.trim() ? `Payment method: ${data.paymentMethod.trim()}` : null].filter(Boolean);
    const { data: purchase, error } = await supabase
      .from("purchase_records")
      .insert({
        client_id: data.clientId,
        offer_name: data.packageName,
        offer_type: "Personal Training Sessions",
        currency: data.currency,
        full_payable_amount: total / 100,
        contract_value_cents: total,
        amount_paid_cents: paidMinor,
        amount_outstanding_cents: total - paidMinor,
        payment_status: paymentStatus,
        paid_at: paidInFull ? now : null,
        sessions_purchased: data.sessionCount,
        package_tracking_enabled: true,
        package_expiry_date: data.expiryDate ?? null,
        admin_notes: notesParts.length ? notesParts.join(" · ") : null,
        show_value_to_client: data.showValueToClient,
        purchased_at: now,
        assigned_at: now,
        assigned_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Audit trail (best-effort — never blocks the sale).
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("financial_audit_events").insert({
        client_id: data.clientId,
        actor_user_id: userId,
        actor_role: "admin",
        action: "session_pack_created",
        record_type: "purchase_records",
        record_id: purchase.id,
        after_state: {
          package_name: data.packageName,
          session_count: data.sessionCount,
          total_price_minor: total,
          amount_paid_minor: paidMinor,
          currency: data.currency,
          payment_status: paymentStatus,
          payment_method: data.paymentMethod ?? null,
          source: "sell_sessions_dialog",
        },
        reason: data.note ?? null,
      } as any);
    } catch { /* audit is best-effort */ }

    return { ok: true, purchaseId: purchase.id as string, paymentStatus, paidMinor };
  });

const StatusInput = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(["Scheduled", "Completed", "Cancelled", "Rescheduled", "Missed"]),
  deductOnMissed: z.boolean().optional(),
});

/**
 * Change a PT session's status. RLS on pt_sessions enforces admin / assigned
 * coach writes, so an unauthorized update simply affects zero rows.
 * Completed → triggers a one-credit deduction (reverted automatically if
 * later un-completed). Missed deducts only when explicitly requested.
 */
export const setPtSessionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => StatusInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: updated, error } = await supabase
      .from("pt_sessions")
      .update({ status: data.status })
      .eq("id", data.sessionId)
      .select("id, status")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Session not found or not permitted.");
    if (data.status === "Missed" && data.deductOnMissed) {
      await supabase.rpc("consume_session_for_pt", { _pt_session_id: data.sessionId });
    }
    return { ok: true };
  });