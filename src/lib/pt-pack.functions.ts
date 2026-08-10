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
    // No-show with deduction: consume FIRST so the held reservation is
    // converted (released + used) before the status change tries to release it.
    if (data.status === "Missed" && data.deductOnMissed) {
      // Sessions booked from a "No credit" booking card never touch the wallet.
      const { data: s } = await supabase
        .from("pt_sessions")
        .select("uses_credit")
        .eq("id", data.sessionId)
        .maybeSingle();
      if (!s || (s as any).uses_credit !== false) {
        await supabase.rpc("consume_session_for_pt", { _pt_session_id: data.sessionId });
      }
    }
    const { data: updated, error } = await supabase
      .from("pt_sessions")
      .update({ status: data.status })
      .eq("id", data.sessionId)
      .select("id, status")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Session not found or not permitted.");
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Edit an existing session pack (value / amount paid / sessions / expiry).
// Credits re-grant automatically via trigger once the pack is paid in full.
// ---------------------------------------------------------------------------
const UpdatePackInput = z.object({
  purchaseId: z.string().uuid(),
  packageName: z.string().min(1).max(160).optional(),
  totalValueMinor: z.number().int().min(0).max(100_000_00).optional(),
  amountPaidMinor: z.number().int().min(0).max(100_000_00).optional(),
  sessionCount: z.number().int().min(1).max(500).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  showValueToClient: z.boolean().optional(),
  reason: z.string().min(2).max(2000),
});

export const updateSessionPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdatePackInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) throw new Error("Only admins can edit session packs.");

    const { data: before, error: bErr } = await supabase
      .from("purchase_records")
      .select("id, client_id, offer_name, currency, sessions_purchased, contract_value_cents, amount_paid_cents, amount_outstanding_cents, payment_status, package_expiry_date, show_value_to_client")
      .eq("id", data.purchaseId)
      .single();
    if (bErr || !before) throw new Error("Session pack not found.");

    // Credits already granted can't be pulled below the new session count —
    // reductions go through the ledger (Adjust Balance) instead.
    const { data: grantRows } = await supabase
      .from("session_ledger_events")
      .select("session_count")
      .eq("purchase_id", data.purchaseId)
      .in("event_type", ["granted", "transferred_in"]);
    const grantedSoFar = (grantRows ?? []).reduce((s, e) => s + Number(e.session_count ?? 0), 0);

    const sessions = data.sessionCount ?? Number(before.sessions_purchased ?? 0);
    if (sessions < grantedSoFar) {
      throw new Error(
        `${grantedSoFar} session credits were already granted from this pack. Use Adjust Balance to remove credits instead.`,
      );
    }
    const value = data.totalValueMinor ?? Number(before.contract_value_cents ?? 0);
    const paid = data.amountPaidMinor ?? Number(before.amount_paid_cents ?? 0);
    if (paid > value) throw new Error("Amount paid cannot exceed the package value.");
    const outstanding = value - paid;
    const paymentStatus = outstanding <= 0 ? "Paid" : paid > 0 ? "Partial" : "Pending";

    const patch: Record<string, any> = {
      sessions_purchased: sessions,
      contract_value_cents: value,
      full_payable_amount: value / 100,
      amount_paid_cents: paid,
      amount_outstanding_cents: outstanding,
      payment_status: paymentStatus,
      paid_at: outstanding <= 0 ? new Date().toISOString() : null,
    };
    if (data.packageName) patch.offer_name = data.packageName;
    if (data.expiryDate !== undefined) patch.package_expiry_date = data.expiryDate ?? null;
    if (data.showValueToClient !== undefined) patch.show_value_to_client = data.showValueToClient;

    const { data: updated, error } = await supabase
      .from("purchase_records")
      .update(patch as any)
      .eq("id", data.purchaseId)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("financial_audit_events").insert({
        client_id: before.client_id,
        actor_user_id: userId,
        actor_role: "admin",
        action: "session_pack_updated",
        record_type: "purchase_records",
        record_id: data.purchaseId,
        before_state: before,
        after_state: { ...patch, granted_so_far: grantedSoFar },
        reason: data.reason,
      } as any);
    } catch { /* audit is best-effort */ }

    return { ok: true, purchaseId: updated.id as string, paymentStatus, outstandingMinor: outstanding };
  });

// ---------------------------------------------------------------------------
// Apply session credit toward a new package / upgrade.
// Converts AVAILABLE (unreserved) sessions on the selected packs into dollar
// credit at their paid value per session, moves them out via transferred_out
// ledger events, and creates the new pack with the credit applied as payment.
// ---------------------------------------------------------------------------
const UpgradeInput = z.object({
  clientId: z.string().uuid(),
  sourcePurchaseIds: z.array(z.string().uuid()).min(1).max(20),
  newPackageName: z.string().min(1).max(160),
  newSessionCount: z.number().int().min(1).max(500),
  newPriceMinor: z.number().int().min(0).max(100_000_00),
  currency: z.string().length(3).default("CAD"),
  differencePaid: z.boolean().default(false),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  note: z.string().min(2).max(2000),
});

export const applySessionCreditUpgrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpgradeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) throw new Error("Only admins can apply session credit.");

    const { data: balanceRows } = await supabase.rpc("session_balance", { _client_id: data.clientId });
    const balance = (balanceRows ?? []) as any[];

    const { data: purchases } = await supabase
      .from("purchase_records")
      .select("id, client_id, offer_name, currency, sessions_purchased, amount_paid_cents")
      .in("id", data.sourcePurchaseIds)
      .eq("client_id", data.clientId);
    if (!purchases || purchases.length !== data.sourcePurchaseIds.length) {
      throw new Error("One or more source packages were not found for this client.");
    }

    // Remaining credit = available sessions × paid value per session.
    const transfers: Array<{ purchaseId: string; name: string; avail: number; paidUnit: number }> = [];
    let creditMinor = 0;
    for (const p of purchases as any[]) {
      const row = balance.find((b) => b.purchase_id === p.id);
      const avail = Math.max(Number(row?.remaining ?? 0), 0);
      if (avail <= 0) continue;
      const sessions = Math.max(Number(p.sessions_purchased ?? 0), 1);
      const paidUnit = Math.round(Number(p.amount_paid_cents ?? 0) / sessions);
      transfers.push({ purchaseId: p.id, name: p.offer_name, avail, paidUnit });
      creditMinor += avail * paidUnit;
    }
    if (transfers.length === 0) throw new Error("No available (unscheduled) sessions to convert on the selected packages.");

    const differenceMinor = Math.max(data.newPriceMinor - creditMinor, 0);
    const paidMinor = Math.min(creditMinor + (data.differencePaid ? differenceMinor : 0), data.newPriceMinor);
    const outstandingMinor = data.newPriceMinor - paidMinor;
    const paymentStatus = outstandingMinor <= 0 ? "Paid" : paidMinor > 0 ? "Partial" : "Pending";
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // 1) Move the converted sessions out of the old packs (auditable events).
    for (const t of transfers) {
      const { error } = await supabase.from("session_ledger_events").insert({
        client_id: data.clientId,
        purchase_id: t.purchaseId,
        event_type: "transferred_out",
        session_count: -t.avail,
        unit_value_minor: t.paidUnit,
        currency: data.currency,
        effective_date: today,
        source: "upgrade_transfer",
        note: `Applied ${t.avail} session${t.avail === 1 ? "" : "s"} ($${((t.avail * t.paidUnit) / 100).toFixed(2)} credit) → ${data.newPackageName}`,
        created_by: userId,
      } as any);
      if (error) throw new Error(error.message);
    }

    // 2) Create the new pack with the credit applied as payment.
    const { data: purchase, error } = await supabase
      .from("purchase_records")
      .insert({
        client_id: data.clientId,
        offer_name: data.newPackageName,
        offer_type: "Personal Training Sessions",
        currency: data.currency,
        full_payable_amount: data.newPriceMinor / 100,
        contract_value_cents: data.newPriceMinor,
        amount_paid_cents: paidMinor,
        amount_outstanding_cents: outstandingMinor,
        payment_status: paymentStatus,
        paid_at: outstandingMinor <= 0 ? now : null,
        sessions_purchased: data.newSessionCount,
        package_tracking_enabled: true,
        package_expiry_date: data.expiryDate ?? null,
        admin_notes: `Upgrade: $${(creditMinor / 100).toFixed(2)} credit applied from ${transfers.map((t) => t.name).join(", ")}. ${data.note}`,
        show_value_to_client: true,
        purchased_at: now,
        assigned_at: now,
        assigned_by: userId,
      } as any)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("financial_audit_events").insert({
        client_id: data.clientId,
        actor_user_id: userId,
        actor_role: "admin",
        action: "session_credit_upgrade",
        record_type: "purchase_records",
        record_id: purchase.id,
        after_state: {
          new_package: data.newPackageName,
          new_session_count: data.newSessionCount,
          new_price_minor: data.newPriceMinor,
          credit_applied_minor: creditMinor,
          difference_minor: differenceMinor,
          difference_paid: data.differencePaid,
          payment_status: paymentStatus,
          sessions_converted: transfers.reduce((s, t) => s + t.avail, 0),
          sources: transfers,
        },
        reason: data.note,
      } as any);
    } catch { /* audit is best-effort */ }

    return {
      ok: true,
      purchaseId: purchase.id as string,
      creditMinor,
      differenceMinor,
      outstandingMinor,
      paymentStatus,
      sessionsConverted: transfers.reduce((s, t) => s + t.avail, 0),
    };
  });