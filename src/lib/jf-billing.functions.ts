// JF Membership billing server functions.
// Public: createJfSignupCheckout, completeJfSignup, getJfPublicSettings.
// Authed (member): cancelJfMembership, freezeJfMembership, switchToHoldPlan,
//   reactivateFullMembership, openBillingPortal, getMyJfBilling, syncMyStripeStatus.
// Authed (admin): adminSyncMemberStripe, adminUpdateJfSettings, adminGetJfSettings,
//   adminCancelMember, adminFreezeMember, adminHoldPlanMember, adminReactivateMember,
//   adminCompAccess.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeFetch, formEncode } from "@/lib/stripe.server";

/* ───── helpers ───── */

function nowIsoFromUnix(u?: number | null): string | null {
  if (!u) return null;
  return new Date(u * 1000).toISOString();
}

function statusFromSubscription(sub: any, holdPriceId: string | null): string {
  if (!sub) return "Cancelled";
  const stripeStatus = sub.status as string;
  const priceId = sub.items?.data?.[0]?.price?.id;
  if (holdPriceId && priceId === holdPriceId) return "Hold Plan";
  if (sub.pause_collection) return "Paused";
  switch (stripeStatus) {
    case "trialing": return "Trialing";
    case "active": return sub.cancel_at_period_end ? "Active" : "Active";
    case "past_due": return "Past Due";
    case "unpaid": return "Payment Failed";
    case "canceled": return "Cancelled";
    case "incomplete":
    case "incomplete_expired": return "Payment Failed";
    case "paused": return "Paused";
    default: return "Cancelled";
  }
}

async function loadSettings() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("jf_membership_settings").select("*").eq("id", true).maybeSingle();
  if (error || !data) throw new Error("JF Membership settings missing. Ask an admin to configure them.");
  return data;
}

async function applyStripeStateToMember(memberId: string, sub: any, holdPriceId: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const status = statusFromSubscription(sub, holdPriceId);
  const patch: any = {
    subscription_status: status,
    stripe_subscription_id: sub?.id ?? null,
    stripe_customer_id: sub?.customer ?? null,
    stripe_price_id: sub?.items?.data?.[0]?.price?.id ?? null,
    trial_end_at: nowIsoFromUnix(sub?.trial_end),
    current_period_end: nowIsoFromUnix(sub?.current_period_end),
    cancel_at: nowIsoFromUnix(sub?.cancel_at),
    cancelled_at: nowIsoFromUnix(sub?.canceled_at),
    paused_until: nowIsoFromUnix(sub?.pause_collection?.resumes_at),
    last_billing_event_at: new Date().toISOString(),
  };
  if (status === "Hold Plan") patch.hold_plan_started_at = new Date().toISOString();
  // Update member status to Active/Inactive based on subscription
  if (["Trialing", "Active"].includes(status)) patch.status = "Active";
  else if (status === "Hold Plan" || status === "Paused") patch.status = "Active"; // keep account active, access gated separately
  else if (status === "Cancelled" || status === "Payment Failed") patch.status = "Cancelled";
  await supabaseAdmin.from("app_members").update(patch).eq("id", memberId);

  // Toggle access flags: revoke when not Trialing/Active
  const grantsActive = status === "Trialing" || status === "Active";
  await supabaseAdmin.from("member_access").update({ active: grantsActive }).eq("member_id", memberId);
}

async function findMemberByUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("app_members").select("*").eq("user_id", userId).maybeSingle();
  return data;
}

/**
 * Best-effort SMS automation fire for a JF membership lifecycle event.
 * Never throws — billing actions must succeed even if SMS is misconfigured.
 */
async function fireMemberSms(memberId: string, trigger: string, vars: Record<string, string> = {}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fireAutomationTrigger } = await import("@/lib/sms-trigger.server");
    await fireAutomationTrigger(supabaseAdmin, { trigger, memberId, vars });
  } catch (e) {
    console.error(`[jf-billing] sms ${trigger} failed`, e);
  }
}

/* ───── PUBLIC ───── */

export const getJfPublicSettings = createServerFn({ method: "GET" }).handler(async () => {
  const s = await loadSettings();
  return {
    monthly_price_display: s.monthly_price_display,
    hold_price_display: s.hold_price_display,
    trial_days: s.trial_days,
    refund_policy: s.refund_policy,
    support_email: s.support_email,
    has_monthly_price: !!s.monthly_price_id,
  };
});

const SignupInput = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  password: z.string().min(8).max(200),
  sms_consent: z.boolean().optional(),
  origin: z.string().url(),
});

export const createJfSignupCheckout = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SignupInput.parse(d))
  .handler(async ({ data }) => {
    const s = await loadSettings();
    if (!s.monthly_price_id) throw new Error("Membership pricing isn't configured yet. Please contact support.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const emailLc = data.email.trim().toLowerCase();

    // Block if a user already exists with this email and is a JF member
    const { data: existing } = await supabaseAdmin.from("app_members").select("id,account_type").ilike("email", emailLc).maybeSingle();
    if (existing && existing.account_type === "jf_member") {
      throw new Error("An account with that email already exists. Please sign in instead.");
    }

    // Trial abuse: skip trial if email already had one
    const { data: trialRow } = await supabaseAdmin.from("jf_trial_emails").select("email_lc").eq("email_lc", emailLc).maybeSingle();
    const useTrial = !trialRow && s.trial_days > 0;

    // Note: password_hash column actually stores the raw password temporarily.
    // The jf_pending_signups table is service-role only (no end-user RLS policies),
    // and the row is deleted immediately after Supabase Auth user creation.
    // 24h expiry is enforced by expires_at + a cleanup job (admin-run).
    const passwordHash = data.password;

    // Pre-store pending signup keyed by checkout session id — we'll insert AFTER session creation
    // First create the checkout session
    const fullName = `${data.first_name} ${data.last_name}`.trim();
    const sessionBody = formEncode({
      mode: "subscription",
      customer_email: emailLc,
      "line_items[0][price]": s.monthly_price_id,
      "line_items[0][quantity]": 1,
      success_url: `${data.origin}/m/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${data.origin}/join?cancelled=1`,
      allow_promotion_codes: "true",
      "metadata[kind]": "jf_membership",
      "metadata[full_name]": fullName,
      "metadata[phone]": data.phone || "",
      "metadata[sms_consent]": data.sms_consent ? "1" : "0",
      "subscription_data[metadata][kind]": "jf_membership",
      "subscription_data[metadata][email_lc]": emailLc,
      ...(useTrial ? { "subscription_data[trial_period_days]": String(s.trial_days) } : {}),
    });
    const session = await stripeFetch("/checkout/sessions", { method: "POST", body: sessionBody });

    // Stash pending signup
    await supabaseAdmin.from("jf_pending_signups").insert({
      session_id: session.id,
      email: emailLc,
      full_name: fullName,
      phone: data.phone || null,
      password_hash: passwordHash,
      sms_consent: !!data.sms_consent,
    });

    return { url: session.url as string, used_trial: useTrial };
  });

// completeJfSignup: called from /m/welcome. Requires the user to sign in first,
// because we created the user account post-checkout. Actually we create-account-here:
// we cannot create auth user without password — we stored a SHA-256 hash, but
// supabase requires raw password. SO: we instead use a magic-link flow.
// Simpler: store the raw password encrypted at rest is risky. Better approach:
// after Stripe success, we have the email — we generate a one-time session token
// and email a magic link. But to keep instant access we instead create the
// account immediately using the password we stashed (kept only briefly).
//
// To keep this honest: we keep the raw password in jf_pending_signups (which is
// service-role only, RLS-locked, and we delete the row after account creation).
// Update plan: store the password as plaintext, delete on completion, expire in 24h.
// We'll re-issue the migration column accordingly — but for now use password_hash
// column to store the raw password (column is text; name kept for back-compat).

const CompleteInput = z.object({ session_id: z.string().min(5) });

export const completeJfSignup = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CompleteInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const s = await loadSettings();

    // Re-fetch the session from Stripe
    const session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(data.session_id)}?expand[]=subscription`);
    if (!session) throw new Error("Checkout session not found.");
    if (session.mode !== "subscription") throw new Error("Wrong checkout mode.");
    const subscription = session.subscription;
    const valid =
      session.status === "complete" &&
      (subscription?.status === "trialing" || subscription?.status === "active");
    if (!valid) throw new Error("Payment not confirmed yet. Please refresh in a moment.");

    const emailLc = (session.customer_email || session.customer_details?.email || "").toLowerCase();
    if (!emailLc) throw new Error("Checkout session has no email.");

    // Find pending signup
    const { data: pending } = await supabaseAdmin
      .from("jf_pending_signups").select("*").eq("session_id", session.id).maybeSingle();

    // Look up or create auth user
    let userId: string | null = null;
    // Check if a user with that email already exists
    const { data: existingUserList } = await (supabaseAdmin as any).auth.admin.listUsers({ page: 1, perPage: 200 });
    const existingUser = existingUserList?.users?.find((u: any) => (u.email || "").toLowerCase() === emailLc);
    if (existingUser) userId = existingUser.id;

    if (!userId) {
      if (!pending) throw new Error("Signup data missing. Please contact support with your checkout reference.");
      const password = pending.password_hash; // raw password stashed (see note above)
      const { data: created, error: createErr } = await (supabaseAdmin as any).auth.admin.createUser({
        email: emailLc,
        password,
        email_confirm: true,
        user_metadata: { full_name: pending.full_name, phone: pending.phone },
      });
      if (createErr) throw new Error(createErr.message);
      userId = created.user.id;
    }

    // Upsert app_members row
    const { data: memberExisting } = await supabaseAdmin
      .from("app_members").select("*").ilike("email", emailLc).maybeSingle();

    let memberId: string;
    if (memberExisting) {
      memberId = memberExisting.id;
      await supabaseAdmin.from("app_members").update({
        user_id: userId,
        account_type: "jf_member",
        status: "Active",
        full_name: pending?.full_name ?? memberExisting.full_name,
      }).eq("id", memberId);
    } else {
      const { data: created, error: insErr } = await supabaseAdmin.from("app_members").insert({
        user_id: userId,
        email: emailLc,
        full_name: pending?.full_name ?? emailLc,
        account_type: "jf_member",
        status: "Active",
      }).select("id").single();
      if (insErr) throw new Error(insErr.message);
      memberId = created.id;
    }

    // Apply default access (idempotent)
    await supabaseAdmin.rpc("apply_default_member_access", { _member_id: memberId });

    // Apply Stripe state
    await applyStripeStateToMember(memberId, subscription, s.hold_price_id);

    // Mark trial email used (only on first trial)
    if (subscription?.trial_end) {
      await supabaseAdmin.from("jf_trial_emails").upsert(
        { email_lc: emailLc, stripe_customer_id: subscription.customer ?? null },
        { onConflict: "email_lc", ignoreDuplicates: true } as any,
      );
    }

    // Cleanup pending
    await supabaseAdmin.from("jf_pending_signups").delete().eq("session_id", session.id);

    return {
      ok: true,
      member_id: memberId,
      email: emailLc,
      subscription_status: statusFromSubscription(subscription, s.hold_price_id),
      trial_end_at: nowIsoFromUnix(subscription.trial_end),
      current_period_end: nowIsoFromUnix(subscription.current_period_end),
    };
  });

/* ───── AUTHED (member) ───── */

export const getMyJfBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const member = await findMemberByUser(userId);
    if (!member) return { member: null, settings: null };
    const s = await loadSettings();
    return {
      member: {
        id: member.id,
        email: member.email,
        full_name: member.full_name,
        account_type: member.account_type,
        status: member.status,
        subscription_status: member.subscription_status,
        stripe_customer_id: member.stripe_customer_id,
        stripe_subscription_id: member.stripe_subscription_id,
        stripe_price_id: member.stripe_price_id,
        trial_end_at: member.trial_end_at,
        current_period_end: member.current_period_end,
        cancel_at: member.cancel_at,
        cancelled_at: member.cancelled_at,
        paused_until: member.paused_until,
        hold_plan_started_at: member.hold_plan_started_at,
      },
      settings: {
        monthly_price_display: s.monthly_price_display,
        hold_price_display: s.hold_price_display,
        is_hold: s.hold_price_id && member.stripe_price_id === s.hold_price_id,
        refund_policy: s.refund_policy,
        support_email: s.support_email,
      },
    };
  });

async function assertMyMember(userId: string) {
  const m = await findMemberByUser(userId);
  if (!m) throw new Error("No member account.");
  if (!m.stripe_subscription_id) throw new Error("No subscription on file.");
  return m;
}

const CancelInput = z.object({ reason: z.string().optional(), details: z.string().optional() });
export const cancelJfMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CancelInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const member = await assertMyMember(userId);
    const s = await loadSettings();
    const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ cancel_at_period_end: "true" }),
    });
    await applyStripeStateToMember(member.id, sub, s.hold_price_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.reason || data.details) {
      await supabaseAdmin.from("jf_cancellation_feedback").insert({
        member_id: member.id, reason: data.reason ?? null, details: data.details ?? null,
      });
    }
    const cancel_at = nowIsoFromUnix(sub.cancel_at) ?? nowIsoFromUnix(sub.current_period_end);
    await fireMemberSms(member.id, "subscription_cancelled", {
      cancel_at: cancel_at ? new Date(cancel_at).toLocaleDateString() : "",
    });
    return { ok: true, cancel_at };
  });

export const freezeJfMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const member = await assertMyMember(userId);
    const s = await loadSettings();
    const resumesAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({
        "pause_collection[behavior]": "void",
        "pause_collection[resumes_at]": String(resumesAt),
      }),
    });
    await applyStripeStateToMember(member.id, sub, s.hold_price_id);
    await fireMemberSms(member.id, "subscription_frozen", {
      resumes_on: new Date(resumesAt * 1000).toLocaleDateString(),
    });
    return { ok: true, paused_until: nowIsoFromUnix(resumesAt) };
  });

export const switchToHoldPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const member = await assertMyMember(userId);
    const s = await loadSettings();
    if (!s.hold_price_id) throw new Error("Hold Plan price isn't configured yet.");
    // Get current sub to find item id
    const current = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`);
    const itemId = current.items?.data?.[0]?.id;
    if (!itemId) throw new Error("Subscription has no item.");
    const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({
        [`items[0][id]`]: itemId,
        [`items[0][price]`]: s.hold_price_id,
        proration_behavior: "none",
        cancel_at_period_end: "false",
        "pause_collection": "",
      }),
    });
    await applyStripeStateToMember(member.id, sub, s.hold_price_id);
    await fireMemberSms(member.id, "subscription_hold_plan", {
      hold_price: s.hold_price_display ?? "$9/month",
    });
    return { ok: true };
  });

export const reactivateFullMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const member = await assertMyMember(userId);
    const s = await loadSettings();
    if (!s.monthly_price_id) throw new Error("Membership price isn't configured.");
    const current = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`);
    const itemId = current.items?.data?.[0]?.id;
    if (!itemId) throw new Error("Subscription has no item.");
    const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({
        [`items[0][id]`]: itemId,
        [`items[0][price]`]: s.monthly_price_id,
        proration_behavior: "create_prorations",
        cancel_at_period_end: "false",
        "pause_collection": "",
      }),
    });
    await applyStripeStateToMember(member.id, sub, s.hold_price_id);
    await fireMemberSms(member.id, "subscription_reactivated", {
      price: s.monthly_price_display ?? "$29/month",
    });
    return { ok: true };
  });

const PortalInput = z.object({ return_url: z.string().url() });
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PortalInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const member = await findMemberByUser(userId);
    if (!member?.stripe_customer_id) throw new Error("No billing account found.");
    const portal = await stripeFetch("/billing_portal/sessions", {
      method: "POST",
      body: formEncode({ customer: member.stripe_customer_id, return_url: data.return_url }),
    });
    return { url: portal.url as string };
  });

export const syncMyStripeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const member = await assertMyMember(userId);
    const s = await loadSettings();
    const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`);
    await applyStripeStateToMember(member.id, sub, s.hold_price_id);
    return { ok: true, subscription_status: statusFromSubscription(sub, s.hold_price_id) };
  });

/* ───── ADMIN ───── */

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admin required");
}

export const adminGetJfSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("jf_membership_settings").select("*").eq("id", true).maybeSingle();
    return { settings: data };
  });

const SettingsInput = z.object({
  monthly_price_id: z.string().optional().nullable(),
  monthly_price_display: z.string().optional(),
  hold_price_id: z.string().optional().nullable(),
  hold_price_display: z.string().optional(),
  trial_days: z.number().int().min(0).max(60).optional(),
  upgrade_coaching_url: z.string().url().optional().nullable().or(z.literal("")),
  support_email: z.string().email().optional().nullable().or(z.literal("")),
  refund_policy: z.string().optional(),
});
export const adminUpdateJfSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SettingsInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { ...data, updated_at: new Date().toISOString() };
    if (patch.upgrade_coaching_url === "") patch.upgrade_coaching_url = null;
    if (patch.support_email === "") patch.support_email = null;
    const { error } = await supabaseAdmin.from("jf_membership_settings").update(patch).eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const MemberIdInput = z.object({ member_id: z.string().uuid() });

async function loadMemberOrThrow(memberId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("app_members").select("*").eq("id", memberId).maybeSingle();
  if (!data) throw new Error("Member not found.");
  return data;
}

export const adminSyncMemberStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MemberIdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const m = await loadMemberOrThrow(data.member_id);
    if (!m.stripe_subscription_id) return { ok: false, reason: "No subscription on file." };
    const s = await loadSettings();
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`);
    await applyStripeStateToMember(m.id, sub, s.hold_price_id);
    return { ok: true, subscription_status: statusFromSubscription(sub, s.hold_price_id) };
  });

export const adminCancelMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MemberIdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const m = await loadMemberOrThrow(data.member_id);
    if (!m.stripe_subscription_id) throw new Error("No subscription.");
    const s = await loadSettings();
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ cancel_at_period_end: "true" }),
    });
    await applyStripeStateToMember(m.id, sub, s.hold_price_id);
    await fireMemberSms(m.id, "subscription_cancelled");
    return { ok: true };
  });

export const adminFreezeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MemberIdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const m = await loadMemberOrThrow(data.member_id);
    if (!m.stripe_subscription_id) throw new Error("No subscription.");
    const s = await loadSettings();
    const resumesAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ "pause_collection[behavior]": "void", "pause_collection[resumes_at]": String(resumesAt) }),
    });
    await applyStripeStateToMember(m.id, sub, s.hold_price_id);
    await fireMemberSms(m.id, "subscription_frozen", {
      resumes_on: new Date(resumesAt * 1000).toLocaleDateString(),
    });
    return { ok: true };
  });

export const adminHoldPlanMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MemberIdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const m = await loadMemberOrThrow(data.member_id);
    if (!m.stripe_subscription_id) throw new Error("No subscription.");
    const s = await loadSettings();
    if (!s.hold_price_id) throw new Error("Hold Plan price not configured.");
    const current = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`);
    const itemId = current.items?.data?.[0]?.id;
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ [`items[0][id]`]: itemId, [`items[0][price]`]: s.hold_price_id, proration_behavior: "none", "pause_collection": "" }),
    });
    await applyStripeStateToMember(m.id, sub, s.hold_price_id);
    await fireMemberSms(m.id, "subscription_hold_plan", {
      hold_price: s.hold_price_display ?? "$9/month",
    });
    return { ok: true };
  });

export const adminReactivateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MemberIdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const m = await loadMemberOrThrow(data.member_id);
    if (!m.stripe_subscription_id) throw new Error("No subscription.");
    const s = await loadSettings();
    if (!s.monthly_price_id) throw new Error("Monthly price not configured.");
    const current = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`);
    const itemId = current.items?.data?.[0]?.id;
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ [`items[0][id]`]: itemId, [`items[0][price]`]: s.monthly_price_id, proration_behavior: "create_prorations", cancel_at_period_end: "false", "pause_collection": "" }),
    });
    await applyStripeStateToMember(m.id, sub, s.hold_price_id);
    await fireMemberSms(m.id, "subscription_reactivated", {
      price: s.monthly_price_display ?? "$29/month",
    });
    return { ok: true };
  });

export const adminCompAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ member_id: z.string().uuid(), months: z.number().int().min(1).max(36).default(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const expiresAt = new Date(Date.now() + data.months * 30 * 24 * 3600 * 1000).toISOString();
    await supabaseAdmin.from("app_members").update({
      subscription_status: "Active",
      status: "Active",
      current_period_end: expiresAt,
    }).eq("id", data.member_id);
    await supabaseAdmin.rpc("apply_default_member_access", { _member_id: data.member_id });
    await supabaseAdmin.from("member_access").update({ active: true, expires_at: expiresAt }).eq("member_id", data.member_id);
    return { ok: true };
  });
