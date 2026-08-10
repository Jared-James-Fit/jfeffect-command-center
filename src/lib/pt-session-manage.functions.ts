import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * PT Calendar management actions: per-session credit events, safe delete,
 * credit adjustments, and no-show deduction reversal. Status transitions
 * themselves stay in `setPtSessionStatus` (pt-pack.functions.ts) — the DB
 * trigger drives the wallet state machine for those.
 */

// ---- Per-session credit events (admin + assigned coach read access) --------
// RLS only lets admins and the owning client read session_ledger_events, so
// visibility is verified through the caller's own client first (assigned
// coaches can read their sessions' rows), then the privileged read returns
// only events for sessions the caller can actually see.
export const getPtSessionCreditEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionIds: z.array(z.string().uuid()).min(1).max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: visible, error: vErr } = await supabase
      .from("pt_sessions")
      .select("id")
      .in("id", data.sessionIds);
    if (vErr) throw new Error(vErr.message);
    const ids = (visible ?? []).map((r: any) => r.id);
    if (!ids.length) return { events: [] };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: events, error } = await supabaseAdmin
      .from("session_ledger_events")
      .select("id, pt_session_id, event_type, session_count, unit_value_minor, currency, source, note, created_at")
      .in("pt_session_id", ids)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { events: events ?? [] };
  });

// ---- Safe delete ------------------------------------------------------------
// Hard delete is allowed for Scheduled / Cancelled / un-deducted No-show
// sessions. The existing pt_session_release_on_delete trigger releases any
// held reservation automatically. Completed sessions and sessions with a net
// credit deduction are protected — reverse the deduction first.
export const deletePtSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: s, error } = await supabase
      .from("pt_sessions")
      .select("id, client_id, status, title, session_date")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!s) throw new Error("Session not found or not permitted.");
    if (s.status === "Completed") {
      throw new Error(
        "This session is completed and has credit history. Undo completion first, then delete.",
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: evs } = await supabaseAdmin
      .from("session_ledger_events")
      .select("event_type, session_count, source")
      .eq("pt_session_id", s.id);
    const used = (evs ?? [])
      .filter((e: any) => e.event_type === "used")
      .reduce((sum: number, e: any) => sum + -Number(e.session_count ?? 0), 0);
    const reverted = (evs ?? [])
      .filter((e: any) => e.event_type === "adjusted" && e.source === "revert_on_uncomplete")
      .reduce((sum: number, e: any) => sum + Number(e.session_count ?? 0), 0);
    if (used - reverted > 0) {
      throw new Error(
        "This session deducted a credit. Reverse the deduction (Undo No-show) before deleting, so financial history stays intact.",
      );
    }
    const { error: delErr } = await supabase.from("pt_sessions").delete().eq("id", s.id);
    if (delErr) throw new Error(delErr.message);
    return { ok: true, clientId: s.client_id };
  });

// ---- Credit adjustment ------------------------------------------------------
const AdjustInput = z.object({
  clientId: z.string().uuid(),
  sessionId: z.string().uuid().nullish(),
  type: z.enum(["add", "deduct", "release_reserved", "reserve", "correct"]),
  amount: z.number().int().min(1).max(50).default(1),
  delta: z.number().int().min(-50).max(50).optional(),
  unitValueMinor: z.number().int().min(0).max(100_000_00).nullish(),
  currency: z.string().length(3).default("CAD"),
  reason: z.string().min(2).max(160),
  note: z.string().min(2).max(2000),
});

export const adjustPtSessionCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AdjustInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) throw new Error("Only admins can adjust session credits.");

    const today = new Date().toISOString().slice(0, 10);
    const noteText = `${data.reason}: ${data.note.trim()}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Release / re-reserve operate on one session's held reservation.
    if (data.type === "release_reserved" || data.type === "reserve") {
      if (!data.sessionId) throw new Error("Pick a session for this adjustment.");
      const { data: s } = await supabase
        .from("pt_sessions")
        .select("id, client_id, status")
        .eq("id", data.sessionId)
        .maybeSingle();
      if (!s) throw new Error("Session not found or not permitted.");

      const { data: evs } = await supabaseAdmin
        .from("session_ledger_events")
        .select("id, event_type, session_count, unit_value_minor, currency, related_event_id")
        .eq("pt_session_id", data.sessionId)
        .in("event_type", ["reserved", "released"]);
      const releasedIds = new Set((evs ?? []).map((e: any) => e.related_event_id).filter(Boolean));
      const outstanding = (evs ?? []).find(
        (e: any) => e.event_type === "reserved" && !releasedIds.has(e.id),
      );

      if (data.type === "release_reserved") {
        if (!outstanding) throw new Error("This session has no reserved credit to release.");
        const { error } = await supabase.from("session_ledger_events").insert({
          client_id: data.clientId,
          purchase_id: null,
          pt_session_id: data.sessionId,
          event_type: "released",
          session_count: 1,
          unit_value_minor: outstanding.unit_value_minor,
          currency: outstanding.currency ?? data.currency,
          effective_date: today,
          source: "release_reservation",
          note: noteText,
          related_event_id: outstanding.id,
          created_by: userId,
        } as any);
        if (error) throw new Error(error.message);
        return { ok: true };
      }

      // reserve
      if (s.status !== "Scheduled") {
        throw new Error("Only scheduled sessions can hold a reserved credit.");
      }
      if (outstanding) throw new Error("This session already has a reserved credit.");
      const { data: balance } = await supabase.rpc("session_balance", { _client_id: data.clientId });
      const row = ((balance ?? []) as any[]).find(
        (b) => Number(b.remaining ?? 0) > 0 && (!b.expires_at || b.expires_at >= today),
      );
      let unit: number | null = data.unitValueMinor ?? null;
      if (row?.purchase_id) {
        const { data: p } = await supabaseAdmin
          .from("purchase_records")
          .select("amount_paid_cents, sessions_purchased, currency")
          .eq("id", row.purchase_id)
          .maybeSingle();
        if (p) {
          unit = Math.round(Number(p.amount_paid_cents ?? 0) / Math.max(Number(p.sessions_purchased ?? 1), 1));
        }
      }
      const { error } = await supabase.from("session_ledger_events").insert({
        client_id: data.clientId,
        purchase_id: row?.purchase_id ?? null,
        pt_session_id: data.sessionId,
        event_type: "reserved",
        session_count: -1,
        unit_value_minor: unit,
        currency: data.currency,
        effective_date: today,
        source: "reserve_on_book",
        note: noteText,
        created_by: userId,
      } as any);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    // add / deduct / correct — plain balance adjustments.
    let insert: Record<string, any>;
    if (data.type === "add") {
      insert = { event_type: "granted", session_count: data.amount };
    } else if (data.type === "deduct") {
      insert = { event_type: "adjusted", session_count: -data.amount };
    } else {
      const delta = data.delta ?? 0;
      if (!delta) throw new Error("Enter a non-zero correction.");
      insert = { event_type: "adjusted", session_count: delta };
    }
    const { error } = await supabase.from("session_ledger_events").insert({
      client_id: data.clientId,
      purchase_id: null,
      pt_session_id: data.sessionId ?? null,
      ...insert,
      unit_value_minor: data.unitValueMinor ?? null,
      currency: data.currency,
      effective_date: today,
      source: "admin_adjust",
      note: noteText,
      created_by: userId,
    } as any);
    if (error) throw new Error(error.message);

    try {
      await supabaseAdmin.from("financial_audit_events").insert({
        client_id: data.clientId,
        actor_user_id: userId,
        actor_role: "admin",
        action: "pt_session_credit_adjusted",
        record_type: "session_ledger_events",
        record_id: data.sessionId ?? null,
        after_state: { type: data.type, amount: data.amount, delta: data.delta ?? null, unit_value_minor: data.unitValueMinor ?? null, currency: data.currency },
        reason: noteText,
      } as any);
    } catch { /* audit is best-effort */ }

    return { ok: true };
  });

// ---- Undo a deducted no-show -------------------------------------------------
// Inserts a compensating credit-restoration event (same shape the DB trigger
// uses when un-completing a session), then the caller flips the status back
// to Scheduled, which re-reserves a credit via the existing trigger.
export const revertPtSessionDeduction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), note: z.string().max(2000).nullish() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: s, error } = await supabase
      .from("pt_sessions")
      .select("id, client_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!s) throw new Error("Session not found or not permitted.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: evs } = await supabaseAdmin
      .from("session_ledger_events")
      .select("id, event_type, session_count, unit_value_minor, currency, purchase_id, source, created_at")
      .eq("pt_session_id", s.id)
      .order("created_at", { ascending: false });
    const lastMove = (evs ?? []).find(
      (e: any) => e.event_type === "used" || e.source === "revert_on_uncomplete",
    );
    if (!lastMove || lastMove.event_type !== "used") {
      return { ok: true, reverted: false };
    }
    const { error: iErr } = await supabase.from("session_ledger_events").insert({
      client_id: s.client_id,
      purchase_id: lastMove.purchase_id,
      pt_session_id: s.id,
      event_type: "adjusted",
      session_count: 1,
      unit_value_minor: lastMove.unit_value_minor,
      currency: lastMove.currency,
      effective_date: new Date().toISOString().slice(0, 10),
      source: "revert_on_uncomplete",
      note: data.note?.trim() || "No-show deduction reversed — credit restored",
      related_event_id: lastMove.id,
      created_by: userId,
    } as any);
    if (iErr) throw new Error(iErr.message);
    return { ok: true, reverted: true };
  });