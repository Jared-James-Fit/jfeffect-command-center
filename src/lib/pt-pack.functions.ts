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
 * `pt_session_status_change` trigger deducts one credit on completion and
 * restores it if the completion is undone.
 */

const SellInput = z.object({
  clientId: z.string().uuid(),
  packageName: z.string().min(1).max(160),
  sessionCount: z.number().int().min(1).max(500),
  totalPriceMinor: z.number().int().min(0).max(100_000_00),
  currency: z.string().length(3).default("CAD"),
  paymentMode: z.enum(["paid", "pending"]),
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

    const paid = data.paymentMode === "paid";
    const now = new Date().toISOString();
    const { data: purchase, error } = await supabase
      .from("purchase_records")
      .insert({
        client_id: data.clientId,
        offer_name: data.packageName,
        offer_type: "Personal Training Sessions",
        currency: data.currency,
        full_payable_amount: data.totalPriceMinor / 100,
        contract_value_cents: data.totalPriceMinor,
        amount_paid_cents: paid ? data.totalPriceMinor : 0,
        amount_outstanding_cents: paid ? 0 : data.totalPriceMinor,
        payment_status: paid ? "Paid" : "Pending",
        paid_at: paid ? now : null,
        sessions_purchased: data.sessionCount,
        package_tracking_enabled: true,
        package_expiry_date: data.expiryDate ?? null,
        admin_notes: data.note ?? null,
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
        actor_user_id: userId,
        event_type: "session_pack_created",
        entity_type: "purchase_record",
        entity_id: purchase.id,
        metadata: {
          client_id: data.clientId,
          package_name: data.packageName,
          session_count: data.sessionCount,
          total_price_minor: data.totalPriceMinor,
          currency: data.currency,
          payment_status: paid ? "Paid" : "Pending",
          source: "sell_sessions_dialog",
        },
      } as any);
    } catch { /* audit is best-effort */ }

    return { ok: true, purchaseId: purchase.id as string };
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