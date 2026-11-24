/**
 * Manage plan (Account → Your plan, /portal/plan) and the coach's plan card.
 *
 * A client reads and changes their own plan; in "View as client" a coach reads
 * it and changes nothing. Staff read a client's plan (the admin, or the
 * client's own coach); only the admin changes one (money is the admin's, like
 * every other billing write). The records are read with the service role after
 * those checks (plans.server.ts); what's sent back is what the screen shows.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PovInput, isPovRequest, resolvePovClientId } from "@/lib/client-pov.server";
import {
  baseFeatures,
  configIssues,
  featureDiff,
  historyLine,
  offerFromRow,
  offerTerms,
  visibleOptions,
  transitionFor,
  type CoachingAccess,
  type PlanOffer,
  type CurrentPlan,
  type PlanOption,
  type Transition,
} from "@/lib/plans/plan-engine";

export type PlanCard = {
  slug: string;
  name: string;
  family: PlanOption["family"];
  tagline: string | null;
  bestFor: string | null;
  priceCents: number;
  features: string[];
  includedCalls: number;
  recommended: boolean;
  gain: string[];
  lose: string[];
  transition: Transition;
};

export type PlanView = {
  clientId: string;
  firstName: string | null;
  current: Omit<CurrentPlan, "option"> & { slug: string | null; includedCalls: number };
  options: PlanCard[];
  open: { id: string; status: string; kind: string; toLabel: string | null; fromLabel: string | null; effectiveAt: string | null; payUrl: string | null } | null;
  history: Array<{ id: string; title: string; detail: string; at: string; source: string | null }>;
  /** Packages listed (or someone's on) that can't be sold: the admin's to fix. Staff only. */
  configIssues: Array<{ slug: string; name: string; problem: string }>;
  /** False in "View as client" and on a paused account: everything shows, nothing changes. */
  canChange: boolean;
  preview: boolean;
  /** Their plan's subscription ended in Stripe with nothing scheduled here (staff only: End coaching). */
  endedInStripe: boolean;
  tier: "coaching" | "self_serve";
  /** May they buy coaching (approved, applied, asked to come back)? */
  access: CoachingAccess;
  /** A switch their coach offered: what it means, and the words they agree to. */
  offer: (PlanOffer & { lines: string[]; consentText: string }) | null;
  /** The Coaching Agreement version they last signed (null = none). */
  agreementVersion: string | null;
  /** Staff: the open approval to buy coaching. */
  approval: { id: string; packageName: string | null; expiresAt: string; source: string } | null;
};

const fmtDay = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Winnipeg" });
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return !!data;
}

async function buildView(clientId: string, opts: { native?: boolean; staff?: boolean; preview?: boolean }): Promise<PlanView> {
  const db = await admin();
  const { loadPlanState, openChangeOf, stripeKeyFor } = await import("@/lib/plans/plans.server");
  const state = await loadPlanState(db, clientId);
  const open = openChangeOf(state.open);
  const base = baseFeatures(state.catalog);
  const cards: PlanCard[] = visibleOptions(state.catalog, state.current).map((o) => {
    const diff = featureDiff(state.current.features, o.features, base);
    return {
      slug: o.slug,
      name: o.name,
      family: o.family,
      tagline: o.tagline,
      bestFor: o.bestFor,
      priceCents: o.priceCents,
      features: o.features,
      includedCalls: o.includedCalls,
      recommended: o.recommended,
      gain: diff.gain,
      lose: state.current.managed === "custom" ? [] : diff.lose,
      transition: transitionFor(state.current, o, { native: opts.native, open, coaching: state.access }),
    };
  });
  let payUrl: string | null = null;
  if (state.open?.status === "awaiting_payment" && state.open.stripe_invoice_id && !opts.preview) {
    try {
      const { stripeFetch } = await import("@/lib/stripe.server");
      const inv = await stripeFetch(`/invoices/${encodeURIComponent(state.open.stripe_invoice_id)}`, { apiKey: stripeKeyFor(state.sale) });
      payUrl = inv?.status === "open" ? inv?.hosted_invoice_url ?? null : null;
    } catch {
      payUrl = null;
    }
  }
  const { option, ...current } = state.current;
  const paused = state.client.archived || ["Deactivated", "Deleted"].includes(String(state.client.status ?? ""));
  return {
    clientId: state.client.id,
    firstName: state.client.first_name,
    current: { ...current, slug: option?.slug ?? null, includedCalls: option?.includedCalls ?? 0 },
    options: cards,
    open: state.open
      ? { id: state.open.id, status: state.open.status, kind: state.open.kind, toLabel: state.open.to_label, fromLabel: state.open.from_label, effectiveAt: state.open.effective_at, payUrl }
      : null,
    history: state.history
      .filter((r) => r.status !== "checkout" || r.id === state.open?.id)
      .map((r) => ({ id: r.id, ...historyLine(r as any, fmtDay), at: r.created_at, source: opts.staff ? r.source : null })),
    configIssues: opts.staff ? configIssues(state.catalog) : [],
    canChange: !opts.preview && !paused,
    preview: !!opts.preview,
    endedInStripe:
      !!opts.staff && state.client.service_tier === "coaching" && state.current.managed === "custom" &&
      state.history[0]?.source === "stripe" && state.history[0]?.status === "applied" &&
      ["end", "cancel"].includes(String(state.history[0]?.kind)),
    tier: state.client.service_tier,
    access: state.access,
    offer: state.offer
      ? (() => {
          const o = offerFromRow(state.offer, state.current);
          return { ...o, ...offerTerms(o, fmtLongDay) };
        })()
      : null,
    agreementVersion: state.agreement.version,
    approval:
      opts.staff && state.approval
        ? {
            id: state.approval.id,
            packageName: state.packages.find((p) => p.id === state.approval!.package_id)?.name ?? null,
            expiresAt: state.approval.expires_at,
            source: state.approval.source,
          }
        : null,
  };
}

/** The same day words the server stores consent in (offerTerms is built the same on both sides). */
const fmtLongDay = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Winnipeg" });
};

/** Only our own sites get a checkout's way back (never someone else's page). */
function safeOrigin(raw: string | undefined | null): string {
  try {
    const u = new URL(String(raw ?? ""));
    const host = u.hostname.toLowerCase();
    const ok =
      (u.protocol === "https:" && (host === "jfeffect.com" || host.endsWith(".jfeffect.com") || host.endsWith(".lovable.app"))) ||
      (u.protocol === "http:" && (host === "localhost" || host === "127.0.0.1"));
    return ok ? u.origin : "https://jfeffect.com";
  } catch {
    return "https://jfeffect.com";
  }
}

function friendly(e: unknown): Error {
  const msg = String((e as any)?.message ?? e ?? "");
  if ((e as any)?.constructor?.name === "PlanError" || (e as any)?.config !== undefined) return new Error(msg);
  console.error("[plans]", e);
  return new Error("Something went wrong changing your plan. Nothing was charged; please try again.");
}

/* ───────────────────────── the client ───────────────────────── */

export const getMyPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.extend({ native: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PlanView | null> => {
    const { supabase, userId } = context as any;
    const clientId = await resolvePovClientId(supabase, userId, data);
    if (!clientId) return null;
    return buildView(clientId, { native: data.native, preview: isPovRequest(userId, data) });
  });

const ChangeInput = PovInput.extend({
  toSlug: z.string().trim().min(1).max(48),
  native: z.boolean().optional(),
});

export const previewMyPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ChangeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await resolvePovClientId(supabase, userId, data);
    if (!clientId) throw new Error("Couldn't find your account.");
    const { loadPlanState, previewChange } = await import("@/lib/plans/plans.server");
    try {
      const db = await admin();
      return await previewChange(db, await loadPlanState(db, clientId), data.toSlug, { native: data.native });
    } catch (e) {
      throw friendly(e);
    }
  });

/** Their own login, never a coach previewing them: a plan change is the client's decision. */
async function ownClientId(supabase: any, userId: string, pov: z.infer<typeof PovInput>): Promise<string> {
  if (isPovRequest(userId, pov)) throw new Error("Preview only. Only the client can change their plan.");
  const { data } = await supabase.from("clients").select("id").eq("user_id", userId).maybeSingle();
  if (!data?.id) throw new Error("Couldn't find your account.");
  return data.id as string;
}

export const confirmMyPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ChangeInput.extend({
      origin: z.string().max(200).optional(),
      prorationDate: z.number().int().positive().nullable().optional(),
      note: z.string().trim().max(500).nullable().optional(),
      acknowledgeForfeit: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await ownClientId(supabase, userId, data);
    const { loadPlanState, confirmChange } = await import("@/lib/plans/plans.server");
    const db = await admin();
    const state = await loadPlanState(db, clientId);
    // the phone app never charges (App Store / Play rules); a downgrade, a cancel or a request is fine
    if (data.native) {
      const target = state.catalog.find((o) => o.slug === data.toSlug);
      const tr = target ? transitionFor(state.current, target, { native: true, coaching: state.access }) : null;
      if (tr && !tr.available) throw new Error(tr.blocked ?? "That change isn't available here.");
    }
    try {
      return await confirmChange(db, state, data.toSlug, {
        actorUserId: userId,
        source: "client",
        origin: safeOrigin(data.origin),
        prorationDate: data.prorationDate ?? null,
        note: data.note ?? null,
        acknowledgeForfeit: !!data.acknowledgeForfeit,
      });
    } catch (e) {
      throw friendly(e);
    }
  });

/** A member who's never been coached applies for coaching from Manage plan. */
export const applyForCoaching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    PovInput.extend({
      goal: z.string().trim().min(2).max(500),
      outcome: z.string().trim().min(2).max(1000),
      timeline: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40).nullable().optional(),
      packageSlug: z.string().trim().max(48).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await ownClientId(supabase, userId, data);
    const { loadPlanState, applyInApp } = await import("@/lib/plans/plans.server");
    try {
      const db = await admin();
      return await applyInApp(db, await loadPlanState(db, clientId), data, userId);
    } catch (e) {
      throw friendly(e);
    }
  });

/** Accept the coach's offer: the exact words shown are passed back and kept as their consent. */
export const acceptMyOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.extend({ changeId: z.string().uuid(), consentText: z.string().trim().min(10).max(2000), origin: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await ownClientId(supabase, userId, data);
    const { loadPlanState, acceptOffer } = await import("@/lib/plans/plans.server");
    try {
      const db = await admin();
      return await acceptOffer(db, await loadPlanState(db, clientId), data.changeId, { actorUserId: userId, origin: safeOrigin(data.origin), consentText: data.consentText });
    } catch (e) {
      throw friendly(e);
    }
  });

export const declineMyOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.extend({ changeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await ownClientId(supabase, userId, data);
    const { loadPlanState, declineOffer } = await import("@/lib/plans/plans.server");
    try {
      const db = await admin();
      return await declineOffer(db, await loadPlanState(db, clientId), data.changeId, userId);
    } catch (e) {
      throw friendly(e);
    }
  });

export const undoMyPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.extend({ changeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await ownClientId(supabase, userId, data);
    const { loadPlanState, undoChange } = await import("@/lib/plans/plans.server");
    try {
      const db = await admin();
      return await undoChange(db, await loadPlanState(db, clientId), data.changeId, userId);
    } catch (e) {
      throw friendly(e);
    }
  });

export const keepMyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await ownClientId(supabase, userId, data);
    const { loadPlanState, keepPlan } = await import("@/lib/plans/plans.server");
    try {
      const db = await admin();
      return await keepPlan(db, await loadPlanState(db, clientId), userId);
    } catch (e) {
      throw friendly(e);
    }
  });

/** After Stripe sends them back: has the checkout gone through yet? (The webhook applies it.) */
export const getMyPlanChange = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ changeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    // their own row, read through their login (RLS: own rows only)
    const { data: row } = await supabase.from("plan_changes").select("id, status, kind, to_label, error").eq("id", data.changeId).maybeSingle();
    return row ? { status: row.status as string, kind: row.kind as string, toLabel: row.to_label as string | null, error: row.error as string | null } : null;
  });

/* ───────────────────────── staff ───────────────────────── */

export const adminGetClientPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { staffCanReachClient } = await import("@/lib/staff-client-access.server");
    if (!(await staffCanReachClient(supabase, userId, data.clientId))) throw new Error("Coach access required");
    const view = await buildView(data.clientId, { staff: true });
    return { ...view, canChange: view.canChange && (await isAdmin(supabase, userId)) };
  });

export const adminChangeClientPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        toSlug: z.string().trim().min(1).max(48),
        /** Up a level now with nothing charged for the rest of this month (a goodwill switch). */
        noCharge: z.boolean().optional(),
        prorationDate: z.number().int().positive().nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
        origin: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!(await isAdmin(supabase, userId))) throw new Error("Only the admin changes a client's plan.");
    const { loadPlanState, confirmChange } = await import("@/lib/plans/plans.server");
    const db = await admin();
    const state = await loadPlanState(db, data.clientId);
    try {
      return await confirmChange(db, state, data.toSlug, {
        actorUserId: userId,
        source: "admin",
        origin: safeOrigin(data.origin),
        prorationDate: data.prorationDate ?? null,
        note: data.note ?? null,
        adminNow: !!data.noCharge,
      });
    } catch (e) {
      throw friendly(e);
    }
  });

export const adminPreviewClientPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid(), toSlug: z.string().trim().min(1).max(48) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!(await isAdmin(supabase, userId))) throw new Error("Only the admin changes a client's plan.");
    const { loadPlanState, previewChange } = await import("@/lib/plans/plans.server");
    const db = await admin();
    try {
      return await previewChange(db, await loadPlanState(db, data.clientId), data.toSlug);
    } catch (e) {
      throw friendly(e);
    }
  });

export const adminUndoClientPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid(), changeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!(await isAdmin(supabase, userId))) throw new Error("Only the admin changes a client's plan.");
    const { loadPlanState, undoChange } = await import("@/lib/plans/plans.server");
    const db = await admin();
    try {
      return await undoChange(db, await loadPlanState(db, data.clientId), data.changeId, userId);
    } catch (e) {
      throw friendly(e);
    }
  });

/**
 * End coaching for a client whose subscription ended outside the app (Stripe
 * cancelled it, or the coach did): they become a free member, keeping every
 * record. Never touches Stripe; the coach's call after "ended in Stripe".
 */
export const adminEndCoaching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!(await isAdmin(supabase, userId))) throw new Error("Only the admin changes a client's plan.");
    const db = await admin();
    const { loadPlanState, notifyPlanChange } = await import("@/lib/plans/plans.server");
    const state = await loadPlanState(db, data.clientId);
    if (state.current.managed === "stripe") throw new Error("They still have a live subscription. Change their plan instead.");
    if (state.client.service_tier !== "coaching") throw new Error("They aren't a coaching client.");
    if (state.open) throw new Error("A plan change is still going through.");
    const { data: res, error } = await db.rpc("plan_apply_tier", { _client_id: data.clientId, _family: "free", _coach_id: null });
    if (error) throw new Error(error.message);
    if (res?.skipped) throw new Error("This account is paused or deactivated.");
    if (state.enrollment) {
      await db.from("coaching_package_enrollments").update({ status: "ended", note: "Coaching ended by the coach" }).eq("id", state.enrollment.id).eq("status", "active");
    }
    const free = state.catalog.find((o) => o.family === "free");
    const { data: row } = await db
      .from("plan_changes")
      .insert({
        client_id: data.clientId,
        kind: "end",
        status: "applied",
        source: "admin",
        from_package_id: state.current.option?.id ?? null,
        to_package_id: free?.id ?? null,
        from_family: state.current.family,
        to_family: "free",
        from_label: state.current.name,
        to_label: free?.name ?? "Free app",
        previous_coach_id: state.client.assigned_coach_id,
        requested_by: userId,
        effective_at: new Date().toISOString(),
        note: "Coaching ended by the coach",
      })
      .select("*")
      .single();
    if (row) await notifyPlanChange(db, row, "applied");
    return { ok: true };
  });

/* ───────────────────────── approvals, offers, requests (the admin) ───────────────────────── */

async function adminOnly(supabase: any, userId: string) {
  if (!(await isAdmin(supabase, userId))) throw new Error("Only the admin changes a client's plan.");
}

export const adminApproveCoaching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        packageSlug: z.string().trim().max(48).nullable().optional(),
        note: z.string().trim().max(1000).nullable().optional(),
        applicationId: z.string().uuid().nullable().optional(),
        requestChangeId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await adminOnly(supabase, userId);
    const { approveCoaching } = await import("@/lib/plans/plans.server");
    try {
      return await approveCoaching(await admin(), data.clientId, { actorUserId: userId, packageSlug: data.packageSlug ?? null, note: data.note ?? null, applicationId: data.applicationId ?? null, requestChangeId: data.requestChangeId ?? null });
    } catch (e) {
      throw friendly(e);
    }
  });

export const adminDeclineCoaching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        note: z.string().trim().max(1000).nullable().optional(),
        applicationId: z.string().uuid().nullable().optional(),
        requestChangeId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await adminOnly(supabase, userId);
    const { declineCoaching } = await import("@/lib/plans/plans.server");
    try {
      return await declineCoaching(await admin(), data.clientId, { actorUserId: userId, note: data.note ?? null, applicationId: data.applicationId ?? null, requestChangeId: data.requestChangeId ?? null });
    } catch (e) {
      throw friendly(e);
    }
  });

export const adminRevokeApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid(), approvalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await adminOnly(supabase, userId);
    const { revokeApproval } = await import("@/lib/plans/plans.server");
    try {
      return await revokeApproval(await admin(), data.clientId, data.approvalId);
    } catch (e) {
      throw friendly(e);
    }
  });

export const adminCreateOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        toSlug: z.string().trim().min(1).max(48),
        timing: z.enum(["now", "period_end"]),
        note: z.string().trim().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await adminOnly(supabase, userId);
    const { loadPlanState, createOffer } = await import("@/lib/plans/plans.server");
    try {
      const db = await admin();
      return await createOffer(db, await loadPlanState(db, data.clientId), { targetSlug: data.toSlug, timing: data.timing, note: data.note ?? null, actorUserId: userId });
    } catch (e) {
      throw friendly(e);
    }
  });

export const adminWithdrawOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid(), changeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await adminOnly(supabase, userId);
    const { withdrawOffer } = await import("@/lib/plans/plans.server");
    try {
      return await withdrawOffer(await admin(), data.clientId, data.changeId, userId);
    } catch (e) {
      throw friendly(e);
    }
  });

export const adminDecideRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ changeId: z.string().uuid(), done: z.boolean(), note: z.string().trim().max(1000).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await adminOnly(supabase, userId);
    const { decideRequest } = await import("@/lib/plans/plans.server");
    try {
      return await decideRequest(await admin(), data.changeId, { actorUserId: userId, done: data.done, note: data.note ?? null });
    } catch (e) {
      throw friendly(e);
    }
  });
