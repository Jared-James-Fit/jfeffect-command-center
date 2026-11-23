/**
 * Membership (/admin/membership): the home's read, and changing someone's plan between a free
 * membership and coaching on the same record (Nov 23 2026). Admins only.
 *
 * A plan change never deletes or copies anything: the one athlete record (clients) changes tier,
 * so workouts, PRs, history, Crew and the coach chat's history all stay. It never charges,
 * refunds or touches Stripe: moving a coaching client to the free membership is refused while a
 * coaching subscription would keep charging (stop it from their Billing first, which is the
 * Stripe-safe path), and what they owe stays owed. Every change is in the account's history
 * (account_lifecycle_events).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { planChangeProblems, type PlanChangeReview } from "./membership-model";

async function assertAdmin(context: any): Promise<void> {
  const { data } = await (context.supabase as any).rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Admins only.");
}

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export const getMembershipOverviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) => z.object({ days: z.number().int().min(7).max(365).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const db = await admin();
    const [ov, pkgs, funnel] = await Promise.all([
      db.rpc("membership_overview", { _days: data.days ?? 30 }),
      db
        .from("coaching_packages")
        .select("slug, kind, name, price_cents, billing_interval, recommended, is_public, status, sort_order")
        .eq("status", "active")
        .order("sort_order", { ascending: true }),
      db.rpc("membership_funnel", { _since: new Date(Date.now() - (data.days ?? 30) * 86_400_000).toISOString() }),
    ]);
    if (ov.error) throw new Error(ov.error.message);
    return {
      overview: ov.data ?? {},
      packages: ((pkgs.data ?? []) as any[]).map((p) => ({
        slug: String(p.slug),
        name: String(p.name),
        kind: String(p.kind ?? ""),
        priceCents: Number(p.price_cents ?? 0),
        interval: p.billing_interval as string | null,
        recommended: !!p.recommended,
        listed: !!p.is_public,
      })),
      funnel: funnel.data ?? null,
    };
  });

/** What moving this person to the other plan would do, read before anything changes. */
export const getPlanChangeReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PlanChangeReview> => {
    await assertAdmin(context);
    return readReview(await admin(), data.clientId);
  });

async function readReview(db: any, clientId: string): Promise<PlanChangeReview> {
  const { data: c, error } = await db
    .from("clients")
    .select("id, user_id, full_name, email, service_tier, status, archived, deactivated_at, assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) throw new Error("No such client.");
  const nowIso = new Date().toISOString();
  const [subs, owed, sessions, member, coaches, deletion] = await Promise.all([
    db
      .from("purchase_records")
      .select("id, offer_name, stripe_subscription_id, stripe_subscription_status, cancel_at_period_end, next_billing_date")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .not("stripe_subscription_id", "is", null),
    db
      .from("purchase_records")
      .select("amount_outstanding_cents, status, archived_at")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .gt("amount_outstanding_cents", 0),
    db.from("pt_sessions").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "Scheduled").gt("starts_at", nowIso),
    c.user_id
      ? db.from("app_members").select("id, subscription_status, manual_access_disabled").eq("user_id", c.user_id).eq("account_type", "jf_member").maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("coaches").select("id, full_name, archived, status").eq("archived", false),
    db.from("account_deletions").select("id").eq("client_id", clientId).eq("status", "pending").limit(1),
  ]);
  const live = ((subs.data ?? []) as any[]).filter(
    (s) => ["active", "trialing", "past_due", "unpaid"].includes(String(s.stripe_subscription_status ?? "")) && !s.cancel_at_period_end,
  );
  const ending = ((subs.data ?? []) as any[]).filter(
    (s) => ["active", "trialing"].includes(String(s.stripe_subscription_status ?? "")) && !!s.cancel_at_period_end,
  );
  const owedCents = ((owed.data ?? []) as any[]).reduce((n, r) => n + Number(r.amount_outstanding_cents ?? 0), 0);
  const review: PlanChangeReview = {
    clientId: c.id,
    name: c.full_name || c.email || "This person",
    tier: c.service_tier === "self_serve" ? "membership" : "coaching",
    hasLogin: !!c.user_id,
    inactive: !!c.archived || !!c.deactivated_at || ["Deactivated", "Deleted"].includes(String(c.status ?? "")) || ((deletion.data ?? []) as any[]).length > 0,
    liveCharges: live.map((s) => ({ name: s.offer_name ?? "Subscription", nextCharge: s.next_billing_date ?? null })),
    endingCharges: ending.map((s) => ({ name: s.offer_name ?? "Subscription", nextCharge: s.next_billing_date ?? null })),
    owedCents,
    upcomingSessions: sessions.count ?? 0,
    memberRecord: !!member.data,
    memberAccessOff: !!member.data?.manual_access_disabled,
    assignedCoachId: c.assigned_coach_id ?? null,
    coaches: ((coaches.data ?? []) as any[])
      .filter((x) => String(x.status ?? "Active") === "Active")
      .map((x) => ({ id: x.id as string, name: (x.full_name as string) || "Coach" })),
    problems: [],
  };
  review.problems = planChangeProblems(review);
  return review;
}

/**
 * Move someone between the free membership and coaching, on the same record. Re-reads the review
 * on the server and refuses anything it flags; writes only the tier, the status word and the
 * coach (and a free member record when someone who never had one becomes a member).
 */
export const changePlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; to: "membership" | "coaching"; coachId?: string | null }) =>
    z
      .object({
        clientId: z.string().uuid(),
        to: z.enum(["membership", "coaching"]),
        coachId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const db = await admin();
    const review = await readReview(db, data.clientId);
    if (review.tier === data.to) return { ok: true as const, already: true };
    const problems = planChangeProblems(review, data.to);
    if (problems.length) throw new Error(problems[0]);
    const { data: c } = await db.from("clients").select("id, user_id, full_name, email, phone, sms_opt_out, assigned_coach_id").eq("id", data.clientId).maybeSingle();

    if (data.to === "coaching") {
      const coachId = data.coachId ?? review.assignedCoachId;
      if (!coachId) throw new Error("Pick the coach they'll work with.");
      const { data: coach } = await db.from("coaches").select("id, status").eq("id", coachId).eq("archived", false).maybeSingle();
      if (!coach || String(coach.status ?? "Active") !== "Active") throw new Error("Pick an active coach.");
      const { error } = await db
        .from("clients")
        .update({ service_tier: "coaching", status: "New Client", assigned_coach_id: coachId })
        .eq("id", data.clientId);
      if (error) throw new Error(error.message);
    } else {
      // a free member's own record: kept if they had one (their access as it was), made if not
      const { data: existing } = await db.from("app_members").select("id").eq("user_id", c.user_id).eq("account_type", "jf_member").maybeSingle();
      if (!existing) {
        const { error: insErr } = await db.from("app_members").insert({
          user_id: c.user_id,
          email: c.email,
          full_name: c.full_name,
          phone: c.phone ?? null,
          account_type: "jf_member",
          status: "Active",
          subscription_status: "Free",
          sms_opt_out: !!c.sms_opt_out,
        });
        if (insErr) throw new Error(insErr.message);
      }
      const { error } = await db
        .from("clients")
        .update({ service_tier: "self_serve", status: "Member", assigned_coach_id: null })
        .eq("id", data.clientId);
      if (error) throw new Error(error.message);
    }
    await db.from("account_lifecycle_events").insert({
      client_id: data.clientId,
      user_id: c?.user_id ?? null,
      event: data.to === "coaching" ? "moved_to_coaching" : "moved_to_membership",
      actor_user_id: context.userId,
      actor_role: "admin",
      details: {
        previous_coach_id: data.to === "membership" ? (c?.assigned_coach_id ?? null) : null,
        owed_cents: review.owedCents,
        upcoming_sessions: review.upcomingSessions,
      },
    });
    return { ok: true as const, already: false };
  });
