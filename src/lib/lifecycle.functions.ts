/**
 * Account lifecycle, for the person (Account → Deactivate / Delete, the gate)
 * and their coach or an admin (the client's page): what it means first
 * (getAccountReview), then deactivate (now or when the paid month runs out),
 * reactivate, delete (30 days in Recently deleted) and take a deletion back.
 *
 * Who may: the person themselves (never a team login), an admin, or the
 * client's own coach (resolveLifecycle). Every action works the review out
 * again here from the database and acts on that, Stripe first; each is
 * idempotent (doing it twice changes nothing the second time), recorded in
 * account_lifecycle_events and, when something actually changed, told to
 * the coach once (a staff-only note in their chat and one push).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AccountReview } from "@/lib/account-review";

export type LifecycleState = "active" | "scheduled" | "deactivated" | "pending_deletion";

export type AccountLifecycleView = {
  clientId: string;
  name: string;
  firstName: string;
  tier: string;
  state: LifecycleState;
  /** Who deactivated it (the person, or their coach / an admin). */
  source: "self" | "staff" | null;
  since: string | null;
  /** A deactivation for later: the moment it happens. */
  at: string | null;
  reason: string | null;
  /** The coach's private note, only for staff. */
  note: string | null;
  deletion: { id: string; purgeAfter: string; source: "self" | "admin" } | null;
  who: "self" | "staff";
  role: "self" | "coach" | "admin";
  review: AccountReview;
};

const Kind = z.enum(["deactivate", "delete", "reactivate"]);

async function deletionOf(admin: any, clientId: string) {
  const { data } = await admin
    .from("account_deletions")
    .select("id, purge_after, source")
    .eq("client_id", clientId)
    .eq("status", "pending")
    .maybeSingle();
  return data ? { id: data.id as string, purgeAfter: data.purge_after as string, source: data.source as "self" | "admin" } : null;
}

function stateOf(c: { status: string | null; deactivate_at: string | null }, deletion: unknown): LifecycleState {
  if (deletion || c.status === "Deleted") return "pending_deletion";
  if (c.status === "Deactivated") return "deactivated";
  if (c.deactivate_at) return "scheduled";
  return "active";
}

export const getAccountReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid().optional(),
        kind: Kind,
        when: z.enum(["now", "paid_through"]).optional(),
        stopAutoPay: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<AccountLifecycleView> => {
    const { supabase, userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveLifecycle, reviewFor, firstNameOf } = await import("@/lib/lifecycle.server");
    const { client, actor } = await resolveLifecycle(supabaseAdmin as any, userId, data.clientId);
    if (data.kind === "delete" && actor.who === "staff" && actor.role !== "admin") {
      throw new Error("Only an admin can delete an account.");
    }
    const { review } = await reviewFor(supabase, supabaseAdmin as any, client, data.kind, actor.who, {
      when: data.when,
      stopAutoPay: data.stopAutoPay,
    });
    const deletion = await deletionOf(supabaseAdmin, client.id);
    return {
      clientId: client.id,
      name: client.full_name || firstNameOf(client),
      firstName: firstNameOf(client),
      tier: client.service_tier ?? "coaching",
      state: stateOf(client, deletion),
      source: (client.deactivation_source as "self" | "staff" | null) ?? (client.status === "Deactivated" ? "staff" : null),
      since: client.deactivated_at,
      at: client.deactivate_at,
      reason: client.deactivation_reason,
      note: actor.who === "staff" ? client.deactivation_note : null,
      deletion,
      who: actor.who,
      role: actor.role,
      review,
    };
  });

export const deactivateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid().optional(),
        when: z.enum(["now", "paid_through"]).default("now"),
        reason: z.string().trim().max(200).optional(),
        note: z.string().trim().max(2000).optional(),
        stopAutoPay: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { resolveLifecycle, reviewFor, stopSubscriptions, tellCoach } = await import("@/lib/lifecycle.server");
    const { effectiveInstant } = await import("@/lib/account-review");
    const { client, actor } = await resolveLifecycle(admin, userId, data.clientId);
    if (client.status === "Deleted" || (await deletionOf(admin, client.id))) {
      throw new Error("This account is in Recently deleted.");
    }
    if (client.status === "Deactivated") return { ok: true, already: true, state: "deactivated" as const };
    if (client.deactivate_at) return { ok: true, already: true, state: "scheduled" as const, at: client.deactivate_at };

    const { review } = await reviewFor(supabase, admin, client, "deactivate", actor.who, {
      when: data.when,
      stopAutoPay: actor.who === "staff" ? data.stopAutoPay : false,
    });
    // Stripe first: if it refuses, nothing changes.
    await stopSubscriptions(admin, client.id, userId, actor.role, review.stop, "account_deactivated");

    const reason = data.reason || null;
    const base = {
      deactivation_source: actor.who,
      deactivated_by: userId,
      deactivation_reason: reason,
      deactivation_note: actor.who === "staff" ? data.note || null : null,
    };
    if (review.effective) {
      const at = effectiveInstant(review.effective);
      const { error } = await admin.from("clients").update({ ...base, deactivate_at: at }).eq("id", client.id).is("deactivate_at", null);
      if (error) throw new Error(error.message);
      await admin.rpc("_account_lifecycle_log", {
        _client: client.id,
        _user: client.user_id,
        _event: "deactivation_scheduled",
        _actor: userId,
        _role: actor.role,
        _details: { reason, at },
      });
      await tellCoach(admin, { client, actor, event: "deactivation_scheduled", review, reason, day: review.effective, sourceId: `sched:${client.id}:${at}` });
      return { ok: true, already: false, state: "scheduled" as const, at };
    }

    const { error } = await admin.from("clients").update(base).eq("id", client.id);
    if (error) throw new Error(error.message);
    const { data: res, error: aErr } = await admin.rpc("_account_deactivation_apply", { _client: client.id });
    if (aErr) throw new Error(aErr.message);
    if (!(res as any)?.already) {
      await tellCoach(admin, { client, actor, event: "deactivated", review, reason, sourceId: `deact:${client.id}:${Date.now()}` });
    }
    return { ok: true, already: !!(res as any)?.already, state: "deactivated" as const };
  });

export const reactivateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { resolveLifecycle, reviewFor, tellCoach } = await import("@/lib/lifecycle.server");
    const { client, actor } = await resolveLifecycle(admin, userId, data.clientId);
    if (client.status === "Deleted") throw new Error("This account is in Recently deleted.");
    // A coach's deactivation is theirs to undo; the person can take back their own.
    if (actor.who === "self" && client.status === "Deactivated" && client.deactivation_source !== "self") {
      throw new Error("Your coach paused your account, so they're the one to turn it back on.");
    }
    const { data: res, error } = await admin.rpc("_account_reactivation_apply", { _client: client.id, _by: userId, _role: actor.role });
    if (error) throw new Error(error.message);
    const r = res as any;
    if (r?.already) return { ok: true, already: true };
    if (r?.withdrawn) return { ok: true, already: false, withdrawn: true };
    // What carries on (owed, sessions left), read once it's back.
    let review: AccountReview | null = null;
    try {
      review = (await reviewFor(supabase, admin, client, "reactivate", actor.who)).review;
    } catch {
      review = null;
    }
    await tellCoach(admin, { client, actor, event: "reactivated", review, sourceId: `react:${client.id}:${Date.now()}` });
    return { ok: true, already: false };
  });

/** The person asks to delete their own account: subscriptions stop, then 30 days in Recently deleted. */
export const requestAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ reason: z.string().trim().max(500).optional(), confirm: z.literal("DELETE") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { resolveLifecycle, reviewFor, stopSubscriptions, tellCoach } = await import("@/lib/lifecycle.server");
    let client: any = null;
    let actor: any = null;
    try {
      ({ client, actor } = await resolveLifecycle(admin, userId, undefined));
    } catch (e: any) {
      // A login with no client record can still delete itself (account_delete_request handles the rest).
      if (!/not found/i.test(String(e?.message))) throw e;
    }
    let review: AccountReview | null = null;
    if (client) {
      if (actor.who !== "self") throw new Error("You can only delete your own account here.");
      review = (await reviewFor(supabase, admin, client, "delete", "self")).review;
      await stopSubscriptions(admin, client.id, userId, "self", review.stop, "account_deleted");
    }
    const { data: res, error } = await supabase.rpc("account_delete_request", { _reason: data.reason || null });
    if (error) throw new Error(error.message);
    if (client && !(res as any)?.already) {
      await tellCoach(admin, {
        client,
        actor,
        event: "deletion_requested",
        review,
        reason: data.reason || null,
        day: String((res as any)?.purge_after ?? "").slice(0, 10) || null,
        sourceId: `del:${(res as any)?.id ?? client.id}`,
      });
    }
    return { ok: true, purgeAfter: ((res as any)?.purge_after ?? null) as string | null };
  });

/** The person takes back their own deletion request from the gate. Nothing restarts or is charged. */
export const withdrawAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: ok, error } = await supabase.rpc("account_delete_restore");
    if (error) throw new Error(error.message);
    if (!ok) return { ok: false };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { resolveLifecycle, tellCoach } = await import("@/lib/lifecycle.server");
      const { client, actor } = await resolveLifecycle(supabaseAdmin as any, userId, undefined);
      await tellCoach(supabaseAdmin as any, { client, actor, event: "deletion_withdrawn", review: null, sourceId: `undel:${client.id}:${Date.now()}` });
    } catch {
      // the restore stands; the note is best effort
    }
    return { ok: true };
  });

export type LifecycleEventRow = {
  id: string;
  event: string;
  actor_role: string;
  actor_name: string | null;
  details: any;
  created_at: string;
};

/** A client's account history for their page (staff; the database decides who may read it). */
export const getAccountHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const [{ data: rows, error }, { data: client }] = await Promise.all([
      supabase
        .from("account_lifecycle_events")
        .select("id, event, actor_user_id, actor_role, details, created_at")
        .eq("client_id", data.clientId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("clients").select("created_at, converted_to_client_at, account_created_at").eq("id", data.clientId).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    const actors = [...new Set((rows ?? []).map((r: any) => r.actor_user_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (actors.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", actors);
      (profs ?? []).forEach((p: any) => p.full_name && names.set(p.id, p.full_name));
    }
    const events: LifecycleEventRow[] = (rows ?? []).map((r: any) => ({
      id: r.id,
      event: r.event,
      actor_role: r.actor_role,
      actor_name: r.actor_user_id ? names.get(r.actor_user_id) ?? null : null,
      details: r.details ?? {},
      created_at: r.created_at,
    }));
    return {
      events,
      createdAt: (client as any)?.created_at ?? null,
      activatedAt: (client as any)?.converted_to_client_at ?? (client as any)?.account_created_at ?? null,
    };
  });
