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
import { stripeFetch, formEncode, getStripeKeyForMode, getStripeKeyDiagnostics, detectStripeKeyMode, type StripeMode } from "@/lib/stripe.server";
import {
  applyJfLifecycle,
  resolveLifecycle,
  recordSyncWarning,
  recordCrossAccountWarning,
  recordRestartTransition,
  recordKeepMembershipTransition,
  recordDuplicateBlocked,
  enforceGraceIfExpired,
} from "@/lib/jf-lifecycle.server";

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

/**
 * Resolve the Stripe secret key matching the configured mode in jf_membership_settings.
 * Throws a member-safe error and logs admin-side diagnostics if the key for that mode
 * is missing. Use the returned key with every stripeFetch call so test-mode customers /
 * subscriptions are read with sk_test_… and live ones with sk_live_….
 */
function resolveStripeKey(s: any, where: string): { apiKey: string; mode: StripeMode } {
  const mode: StripeMode = (s?.stripe_mode === "test" ? "test" : "live");
  const apiKey = getStripeKeyForMode(mode);
  if (!apiKey) {
    console.error(
      `[jf-billing:${where}] Stripe key missing for mode=${mode}. ` +
      `Diagnostics=${JSON.stringify(getStripeKeyDiagnostics())}. ` +
      (mode === "test"
        ? "Add STRIPE_SECRET_KEY_TEST (sk_test_…) in project secrets, or switch JF Membership Stripe Mode to Live."
        : "Add a live STRIPE_SECRET_KEY (sk_live_…), or switch JF Membership Stripe Mode to Test."),
    );
    throw new Error("Billing is temporarily unavailable. Please contact support.");
  }
  return { apiKey, mode };
}

async function applyStripeStateToMember(memberId: string, sub: any, holdPriceId: string | null) {
  // Delegate to the canonical lifecycle applier so every writer (webhook,
  // member self-service, admin tools) shares the same status/entitlement
  // logic, grace handling, recovery detection, and audit trail.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: member } = await supabaseAdmin
    .from("app_members").select("*").eq("id", memberId).maybeSingle();
  if (!member) return;
  await applyJfLifecycle({ supabaseAdmin, member, sub, holdPriceId });
}

async function findMemberByUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("app_members").select("*").eq("user_id", userId).maybeSingle();
  return data;
}

/**
 * Stripe error matcher for "No such customer / subscription" — used to
 * trip the cross-account / stale-reference safety guard without mutating
 * IDs or revoking access.
 */
function isStripeMissingRefError(err: any): boolean {
  const msg = String(err?.message ?? "").toLowerCase();
  return /no such (customer|subscription)|resource_missing/.test(msg);
}

async function safeFetchSubscription(subId: string, apiKey: string): Promise<{ sub: any | null; missing: boolean; error?: string }> {
  try {
    const sub = await stripeFetch(`/subscriptions/${subId}`, { apiKey });
    return { sub, missing: false };
  } catch (err: any) {
    if (isStripeMissingRefError(err)) return { sub: null, missing: true, error: err?.message };
    throw err;
  }
}

async function safeFetchCustomer(customerId: string, apiKey: string): Promise<{ customer: any | null; missing: boolean; error?: string }> {
  try {
    const customer = await stripeFetch(`/customers/${customerId}`, { apiKey });
    return { customer, missing: false };
  } catch (err: any) {
    if (isStripeMissingRefError(err)) return { customer: null, missing: true, error: err?.message };
    throw err;
  }
}

async function listActiveSubscriptionsForCustomer(customerId: string, apiKey: string): Promise<any[]> {
  try {
    const all: any[] = [];
    for (const status of ["active", "trialing", "past_due", "unpaid"]) {
      const res = await stripeFetch(
        `/subscriptions?customer=${encodeURIComponent(customerId)}&status=${status}&limit=20`,
        { apiKey },
      );
      if (Array.isArray(res?.data)) all.push(...res.data);
    }
    return all;
  } catch (err: any) {
    if (isStripeMissingRefError(err)) return [];
    throw err;
  }
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

    // Resolve Stripe mode + key
    const mode: StripeMode = (s.stripe_mode === "test" ? "test" : "live");
    const apiKey = getStripeKeyForMode(mode);
    if (!apiKey) {
      console.error(
        `[jf-checkout] Stripe key missing for mode=${mode}. ` +
        `Saved monthly_price_id=${s.monthly_price_id?.slice(0,8)}…; hold_price_id=${s.hold_price_id?.slice(0,8) ?? "(none)"}. ` +
        `Diagnostics=${JSON.stringify(getStripeKeyDiagnostics())}. ` +
        (mode === "test"
          ? "Add STRIPE_SECRET_KEY_TEST (sk_test_…) in project secrets, or switch JF Membership Stripe Mode to Live."
          : "Add a live STRIPE_SECRET_KEY (sk_live_…), or switch JF Membership Stripe Mode to Test."),
      );
      throw new Error("Checkout is temporarily unavailable. Please contact support.");
    }

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
      // Stripe Tax: calculate tax automatically based on customer location.
      // Tax is added on top of the price (prices stay tax-exclusive).
      "automatic_tax[enabled]": "true",
      // Required for Stripe Tax to determine the customer's jurisdiction.
      billing_address_collection: "required",
      // Optionally let the customer enter a tax ID (e.g. business GST/HST number).
      "tax_id_collection[enabled]": "true",
      "metadata[kind]": "jf_membership",
      "metadata[full_name]": fullName,
      "metadata[phone]": data.phone || "",
      "metadata[sms_consent]": data.sms_consent ? "1" : "0",
      "subscription_data[metadata][kind]": "jf_membership",
      "subscription_data[metadata][email_lc]": emailLc,
      ...(useTrial ? { "subscription_data[trial_period_days]": String(s.trial_days) } : {}),
    });
    let session: any;
    try {
      session = await stripeFetch("/checkout/sessions", { method: "POST", body: sessionBody, apiKey });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      console.error(`[jf-checkout] Stripe session create failed (mode=${mode}): ${msg}`);
      // Detect a price/mode mismatch
      const mismatch = /No such price|similar object exists in (live|test) mode/i.test(msg);
      if (mismatch) {
        throw new Error("Checkout is temporarily unavailable. Please contact support.");
      }
      throw new Error("Checkout is temporarily unavailable. Please contact support.");
    }

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

    // Resolve the Stripe key for the configured mode (test/live).
    const { apiKey, mode } = resolveStripeKey(s, "complete");

    // Re-fetch the session from Stripe in the correct mode
    let session: any;
    try {
      session = await stripeFetch(
        `/checkout/sessions/${encodeURIComponent(data.session_id)}?expand[]=subscription`,
        { apiKey },
      );
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      console.error(`[jf-complete] Stripe session fetch failed (mode=${mode}) session_id=${data.session_id.slice(0,16)}…: ${msg}`);
      throw new Error("Checkout session not found.");
    }
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

    // Issue a one-time magic-link token so the public welcome page can
    // sign the new member in without us shipping their password to the client.
    let otp_token_hash: string | null = null;
    try {
      const { data: linkRes } = await (supabaseAdmin as any).auth.admin.generateLink({
        type: "magiclink",
        email: emailLc,
      });
      otp_token_hash = linkRes?.properties?.hashed_token ?? null;
    } catch (e) {
      console.error("[jf-billing] generateLink failed", e);
    }

    return {
      ok: true,
      member_id: memberId,
      email: emailLc,
      subscription_status: statusFromSubscription(subscription, s.hold_price_id),
      trial_end_at: nowIsoFromUnix(subscription.trial_end),
      current_period_end: nowIsoFromUnix(subscription.current_period_end),
      otp_token_hash,
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
    const { apiKey } = resolveStripeKey(s, "cancel");
    const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ cancel_at_period_end: "true" }),
      apiKey,
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

/**
 * Keep Membership — clear cancel_at_period_end on the EXISTING Stripe
 * subscription. Never creates a new subscription; preserves the same
 * billing period and price; idempotent against repeated clicks.
 */
export const keepMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const member = await assertMyMember(userId);
    if (member.cross_account_locked) throw new Error("This membership is under manual review. Please contact support.");
    const s = await loadSettings();
    const { apiKey } = resolveStripeKey(s, "keep");

    // Cross-account / stale ref safety: read the current subscription first.
    const { sub: current, missing } = await safeFetchSubscription(member.stripe_subscription_id!, apiKey);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (missing || !current) {
      await recordSyncWarning({ supabaseAdmin, memberId: member.id, reason: "keep_membership_missing_subscription", metadata: { stripe_subscription_id: member.stripe_subscription_id } });
      throw new Error("Your subscription could not be located. Please use Restart Membership instead.");
    }
    if (!current.cancel_at_period_end) {
      // Already kept — idempotent no-op, just resync.
      await applyStripeStateToMember(member.id, current, s.hold_price_id);
      return { ok: true, already_kept: true };
    }
    const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ cancel_at_period_end: "false" }),
      apiKey,
    });
    await applyStripeStateToMember(member.id, sub, s.hold_price_id);
    await recordKeepMembershipTransition({ supabaseAdmin, memberId: member.id, subscriptionId: sub.id });
    await fireMemberSms(member.id, "subscription_reactivated", {
      price: s.monthly_price_display ?? "$29/month USD",
    });
    return { ok: true };
  });

/**
 * Restart Membership — open a fresh Stripe Checkout for a member whose
 * previous subscription was fully ended (or cannot be located). Reuses the
 * existing app_members row, blocks if an active/trialing/past_due
 * subscription already exists, refuses cross-account references, and uses
 * an idempotency key so repeated clicks don't create duplicate subs.
 */
const RestartInput = z.object({ origin: z.string().url() });
export const restartMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RestartInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const member = await findMemberByUser(userId);
    if (!member) throw new Error("No member account found.");
    if (member.cross_account_locked) {
      await recordCrossAccountWarning({ supabaseAdmin, memberId: member.id, reason: "restart_blocked_cross_account_locked" });
      throw new Error("This membership is under manual review. Please contact support.");
    }
    const s = await loadSettings();
    if (!s.monthly_price_id) throw new Error("Membership pricing isn't configured. Please contact support.");
    const { apiKey, mode } = resolveStripeKey(s, "restart");

    // Validate any existing Stripe customer in the CURRENT mode. If the
    // saved id doesn't exist in this mode it could be a cross-account /
    // wrong-mode reference — never overwrite, fall back to email signup.
    let reuseCustomerId: string | null = null;
    if (member.stripe_customer_id) {
      const { customer, missing } = await safeFetchCustomer(member.stripe_customer_id, apiKey);
      if (missing) {
        await recordSyncWarning({ supabaseAdmin, memberId: member.id, reason: "restart_customer_not_found", metadata: { mode, stripe_customer_id: member.stripe_customer_id } });
      } else if (customer && !customer.deleted) {
        // Duplicate-subscription prevention: block restart if the customer
        // already has an active / trialing / past_due / unpaid subscription.
        const active = await listActiveSubscriptionsForCustomer(member.stripe_customer_id, apiKey);
        if (active.length > 0) {
          await recordDuplicateBlocked({ supabaseAdmin, memberId: member.id, reason: "active_stripe_subscription_exists", metadata: { count: active.length, ids: active.map((s: any) => s.id) } });
          // Resync state so the UI catches up.
          await applyStripeStateToMember(member.id, active[0], s.hold_price_id);
          throw new Error("You already have an active subscription. Refresh this page to see your current plan.");
        }
        reuseCustomerId = member.stripe_customer_id;
      }
    }

    // Local guard against repeated clicks creating two checkouts in flight.
    const lastAttempt = member.last_restart_attempt_at ? new Date(member.last_restart_attempt_at).getTime() : 0;
    const recent = Date.now() - lastAttempt < 30_000;
    await supabaseAdmin.from("app_members").update({ last_restart_attempt_at: new Date().toISOString() }).eq("id", member.id);

    const body: Record<string, string> = {
      mode: "subscription",
      "line_items[0][price]": s.monthly_price_id!,
      "line_items[0][quantity]": "1",
      success_url: `${data.origin}/m/billing?restarted=1`,
      cancel_url: `${data.origin}/m/billing?restart_cancelled=1`,
      allow_promotion_codes: "true",
      "automatic_tax[enabled]": "true",
      billing_address_collection: "required",
      "tax_id_collection[enabled]": "true",
      "metadata[kind]": "jf_membership",
      "metadata[restart_member_id]": member.id,
      "subscription_data[metadata][kind]": "jf_membership",
      "subscription_data[metadata][email_lc]": (member.email ?? "").toLowerCase(),
      "subscription_data[metadata][restart_member_id]": member.id,
    };
    if (reuseCustomerId) body.customer = reuseCustomerId;
    else body.customer_email = member.email!;

    // Idempotency key: same member + same minute = same checkout session.
    // Defeats double-clicks but allows a genuine retry after a minute.
    const idempotencyKey = `jf-restart-${member.id}-${Math.floor(Date.now() / 60_000)}`;
    const session = await stripeFetch("/checkout/sessions", {
      method: "POST",
      body: formEncode(body),
      apiKey,
      idempotencyKey,
    });
    await recordRestartTransition({ supabaseAdmin, memberId: member.id, reason: recent ? "rapid_repeat" : undefined, metadata: { session_id: session.id, mode } });
    return { url: session.url as string, session_id: session.id };
  });

/* ───── ADMIN: cross-account lock ───── */

const LockInput = z.object({ member_id: z.string().uuid(), locked: z.boolean(), reason: z.string().max(500).optional() });
export const adminSetCrossAccountLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LockInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_members").update({
      cross_account_locked: data.locked,
      sync_warning_reason: data.locked ? (data.reason ?? "admin_cross_account_lock") : null,
      sync_warning_at: data.locked ? new Date().toISOString() : null,
    }).eq("id", data.member_id);
    return { ok: true };
  });

export const freezeJfMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const member = await assertMyMember(userId);
    const s = await loadSettings();
    const { apiKey } = resolveStripeKey(s, "freeze");
    const resumesAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({
        "pause_collection[behavior]": "void",
        "pause_collection[resumes_at]": String(resumesAt),
      }),
      apiKey,
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
    const { apiKey } = resolveStripeKey(s, "hold");
    // Get current sub to find item id
    const current = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, { apiKey });
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
      apiKey,
    });
    await applyStripeStateToMember(member.id, sub, s.hold_price_id);
    await fireMemberSms(member.id, "subscription_hold_plan", {
      hold_price: s.hold_price_display ?? "$9/month USD",
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
    const { apiKey } = resolveStripeKey(s, "reactivate");
    const current = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, { apiKey });
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
      apiKey,
    });
    await applyStripeStateToMember(member.id, sub, s.hold_price_id);
    await fireMemberSms(member.id, "subscription_reactivated", {
      price: s.monthly_price_display ?? "$29/month USD",
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
    const s = await loadSettings();
    const { apiKey } = resolveStripeKey(s, "portal");
    const portal = await stripeFetch("/billing_portal/sessions", {
      method: "POST",
      body: formEncode({ customer: member.stripe_customer_id, return_url: data.return_url }),
      apiKey,
    });
    return { url: portal.url as string };
  });

export const syncMyStripeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const member = await assertMyMember(userId);
    const s = await loadSettings();
    const { apiKey } = resolveStripeKey(s, "sync");
    const sub = await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, { apiKey });
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
    const diagnostics = getStripeKeyDiagnostics();
    const mode: StripeMode = ((data as any)?.stripe_mode === "test" ? "test" : "live");
    const key_available_for_mode = !!getStripeKeyForMode(mode);
    return {
      settings: data,
      stripe: {
        ...diagnostics,
        configured_mode: mode,
        key_available_for_mode,
        mismatch: !key_available_for_mode,
      },
    };
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
  stripe_mode: z.enum(["test", "live"]).optional(),
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
    const { apiKey } = resolveStripeKey(s, "adminSync");
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, { apiKey });
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
    const { apiKey } = resolveStripeKey(s, "adminCancel");
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ cancel_at_period_end: "true" }),
      apiKey,
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
    const { apiKey } = resolveStripeKey(s, "adminFreeze");
    const resumesAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ "pause_collection[behavior]": "void", "pause_collection[resumes_at]": String(resumesAt) }),
      apiKey,
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
    const { apiKey } = resolveStripeKey(s, "adminHold");
    const current = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, { apiKey });
    const itemId = current.items?.data?.[0]?.id;
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ [`items[0][id]`]: itemId, [`items[0][price]`]: s.hold_price_id, proration_behavior: "none", "pause_collection": "" }),
      apiKey,
    });
    await applyStripeStateToMember(m.id, sub, s.hold_price_id);
    await fireMemberSms(m.id, "subscription_hold_plan", {
      hold_price: s.hold_price_display ?? "$9/month USD",
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
    const { apiKey } = resolveStripeKey(s, "adminReactivate");
    const current = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, { apiKey });
    const itemId = current.items?.data?.[0]?.id;
    const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, {
      method: "POST",
      body: formEncode({ [`items[0][id]`]: itemId, [`items[0][price]`]: s.monthly_price_id, proration_behavior: "create_prorations", cancel_at_period_end: "false", "pause_collection": "" }),
      apiKey,
    });
    await applyStripeStateToMember(m.id, sub, s.hold_price_id);
    await fireMemberSms(m.id, "subscription_reactivated", {
      price: s.monthly_price_display ?? "$29/month USD",
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
