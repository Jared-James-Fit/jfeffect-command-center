/**
 * Canonical JF Membership lifecycle resolver + applier.
 *
 * One source of truth for mapping a Stripe subscription (or its absence)
 * onto our `app_members` row, `member_access` entitlements, and the
 * `member_access_transitions` audit log. Both the webhook and the
 * authenticated billing server functions delegate here so that a single
 * status decision drives every code path.
 *
 * Phase 3 additions:
 *   - 5-day failed-payment grace period (Past Due in grace vs. restricted)
 *   - Payment recovery (restore Active, clear failure timestamps)
 *   - Subscription ended (preserve account/data, revoke paid entitlements)
 *   - Cross-account / missing-Stripe-ref safety guard
 *   - Append-only access-transition audit
 *
 * Server-only. Do NOT import from client modules.
 */

export type LifecycleStatus =
  | "Trialing"
  | "Active"
  | "Active (Cancels at period end)"
  | "Past Due"
  | "Past Due (Access Restricted)"
  | "Cancelled"
  | "Expired"
  | "Paused"
  | "Hold Plan"
  | "Complimentary"
  | "Payment Failed";

export type LifecycleAction =
  | "none"
  | "update_payment_method"
  | "keep_membership"      // sub still exists w/ cancel_at_period_end
  | "restart_membership";  // sub deleted / unrecoverable

export type ResolvedLifecycle = {
  status: LifecycleStatus;
  grants_access: boolean;
  in_grace: boolean;
  grace_ends_at: string | null;
  payment_failed_at: string | null;
  needs_payment_update: boolean;
  action: LifecycleAction;
  subscription_ended: boolean;
};

const MS_PER_DAY = 24 * 3600 * 1000;

function fromUnix(u?: number | null): string | null {
  return u ? new Date(u * 1000).toISOString() : null;
}

async function loadGraceDays(supabaseAdmin: any): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from("jf_membership_settings")
      .select("grace_period_days")
      .eq("id", true)
      .maybeSingle();
    const n = Number(data?.grace_period_days ?? 5);
    return Number.isFinite(n) && n > 0 ? n : 5;
  } catch {
    return 5;
  }
}

/**
 * Pure resolver — given the current member row and the latest known Stripe
 * subscription (or null when none exists / was deleted), compute the
 * canonical lifecycle for UI and entitlement decisions.
 *
 * Does NOT mutate state. `applyJfLifecycle` is the only writer.
 */
export function resolveLifecycle(args: {
  member: any;
  sub: any | null;
  holdPriceId: string | null;
  graceDays: number;
  now?: Date;
}): ResolvedLifecycle {
  const { member, sub, holdPriceId, graceDays } = args;
  const now = args.now ?? new Date();

  // No live Stripe subscription on record at all.
  if (!sub) {
    if (member?.subscription_ended_at || member?.subscription_status === "Cancelled" || member?.subscription_status === "Expired") {
      return {
        status: "Expired",
        grants_access: false,
        in_grace: false,
        grace_ends_at: null,
        payment_failed_at: null,
        needs_payment_update: false,
        action: "restart_membership",
        subscription_ended: true,
      };
    }
    return {
      status: (member?.subscription_status as LifecycleStatus) ?? "Expired",
      grants_access: false,
      in_grace: false,
      grace_ends_at: null,
      payment_failed_at: null,
      needs_payment_update: false,
      action: "restart_membership",
      subscription_ended: true,
    };
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const isHold = !!(holdPriceId && priceId === holdPriceId);
  const cancelAtPeriodEnd = !!sub.cancel_at_period_end;

  // Compute / inherit grace window. The webhook stamps grace_period_ends_at
  // on first past_due; the resolver respects whatever the row already has.
  const existingGraceEnd = member?.grace_period_ends_at ? new Date(member.grace_period_ends_at) : null;
  const existingFailedAt = member?.payment_failed_at ? new Date(member.payment_failed_at) : null;

  switch (sub.status) {
    case "trialing":
      return {
        status: "Trialing",
        grants_access: true,
        in_grace: false,
        grace_ends_at: null,
        payment_failed_at: null,
        needs_payment_update: false,
        action: "none",
        subscription_ended: false,
      };
    case "active": {
      const baseStatus: LifecycleStatus = isHold
        ? "Hold Plan"
        : sub.pause_collection
          ? "Paused"
          : cancelAtPeriodEnd
            ? "Active (Cancels at period end)"
            : "Active";
      return {
        status: baseStatus,
        grants_access: true,
        in_grace: false,
        grace_ends_at: null,
        payment_failed_at: null,
        needs_payment_update: false,
        action: cancelAtPeriodEnd ? "keep_membership" : "none",
        subscription_ended: false,
      };
    }
    case "past_due":
    case "unpaid": {
      const failedAt = existingFailedAt ?? now;
      const graceEnd = existingGraceEnd ?? new Date(failedAt.getTime() + graceDays * MS_PER_DAY);
      const inGrace = now < graceEnd;
      return {
        status: inGrace ? "Past Due" : "Past Due (Access Restricted)",
        grants_access: inGrace,
        in_grace: inGrace,
        grace_ends_at: graceEnd.toISOString(),
        payment_failed_at: failedAt.toISOString(),
        needs_payment_update: true,
        action: "update_payment_method",
        subscription_ended: false,
      };
    }
    case "paused":
      return {
        status: "Paused",
        grants_access: false,
        in_grace: false,
        grace_ends_at: null,
        payment_failed_at: null,
        needs_payment_update: false,
        action: "none",
        subscription_ended: false,
      };
    case "incomplete":
    case "incomplete_expired":
      return {
        status: "Payment Failed",
        grants_access: false,
        in_grace: false,
        grace_ends_at: null,
        payment_failed_at: now.toISOString(),
        needs_payment_update: true,
        action: "update_payment_method",
        subscription_ended: false,
      };
    case "canceled":
    default:
      return {
        status: cancelAtPeriodEnd && sub.current_period_end && sub.current_period_end * 1000 > now.getTime()
          ? "Active (Cancels at period end)"
          : "Cancelled",
        grants_access: false,
        in_grace: false,
        grace_ends_at: null,
        payment_failed_at: null,
        needs_payment_update: false,
        action: "restart_membership",
        subscription_ended: true,
      };
  }
}

async function recordTransition(
  supabaseAdmin: any,
  memberId: string,
  event_kind: string,
  patch: { from_status?: string | null; to_status?: string | null; stripe_event_id?: string | null; stripe_subscription_id?: string | null; reason?: string | null; metadata?: any } = {},
) {
  try {
    await supabaseAdmin.from("member_access_transitions").insert({
      member_id: memberId,
      event_kind,
      from_status: patch.from_status ?? null,
      to_status: patch.to_status ?? null,
      stripe_event_id: patch.stripe_event_id ?? null,
      stripe_subscription_id: patch.stripe_subscription_id ?? null,
      reason: patch.reason ?? null,
      metadata: patch.metadata ?? {},
    });
  } catch (e) {
    console.warn("[jf-lifecycle] failed to record transition", e);
  }
}

async function fireGatedTrigger(memberId: string, trigger: string, vars: Record<string, string> = {}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fireAutomationTrigger } = await import("@/lib/sms-trigger.server");
    await fireAutomationTrigger(supabaseAdmin, { trigger, memberId, vars });
  } catch (e) {
    console.error(`[jf-lifecycle] trigger ${trigger} failed`, e);
  }
}

/**
 * Apply a resolved lifecycle to the member row + member_access in one place.
 * Also fires the gated lifecycle trigger when state changes (the dry-run
 * safety gate inside sms-trigger.server decides whether to actually send).
 *
 * Idempotent on repeated webhook delivery: re-applying the same state
 * produces no spurious triggers because we compare against the row's
 * existing fields before firing.
 */
export async function applyJfLifecycle(args: {
  supabaseAdmin: any;
  member: any;
  sub: any | null;
  holdPriceId: string | null;
  stripeEventId?: string | null;
}): Promise<{ resolved: ResolvedLifecycle; changed: boolean }> {
  const { supabaseAdmin, member, sub, holdPriceId, stripeEventId } = args;
  if (!member) throw new Error("applyJfLifecycle requires a member row");

  // Cross-account locked rows are never auto-mutated.
  if (member.cross_account_locked) {
    await recordTransition(supabaseAdmin, member.id, "idempotent_replay", {
      from_status: member.subscription_status,
      to_status: member.subscription_status,
      stripe_event_id: stripeEventId,
      stripe_subscription_id: sub?.id ?? member.stripe_subscription_id,
      reason: "cross_account_locked",
    });
    return {
      resolved: {
        status: (member.subscription_status as LifecycleStatus) ?? "Cancelled",
        grants_access: false,
        in_grace: false,
        grace_ends_at: member.grace_period_ends_at,
        payment_failed_at: member.payment_failed_at,
        needs_payment_update: false,
        action: "none",
        subscription_ended: false,
      },
      changed: false,
    };
  }

  const graceDays = await loadGraceDays(supabaseAdmin);
  const resolved = resolveLifecycle({ member, sub, holdPriceId, graceDays });

  const fromStatus = member.subscription_status ?? null;
  const now = new Date().toISOString();

  const patch: Record<string, any> = {
    subscription_status: resolved.status,
    last_billing_event_at: now,
  };

  if (sub) {
    patch.stripe_subscription_id = sub.id;
    patch.stripe_customer_id = sub.customer ?? member.stripe_customer_id;
    patch.stripe_price_id = sub.items?.data?.[0]?.price?.id ?? null;
    patch.trial_end_at = fromUnix(sub.trial_end);
    patch.current_period_end = fromUnix(sub.current_period_end);
    patch.cancel_at = fromUnix(sub.cancel_at);
    patch.cancelled_at = fromUnix(sub.canceled_at);
    patch.paused_until = fromUnix(sub.pause_collection?.resumes_at);
  }

  // Map app-level status
  if (resolved.status === "Trialing" || resolved.status === "Active" || resolved.status === "Active (Cancels at period end)" || resolved.status === "Hold Plan" || resolved.status === "Paused" || resolved.status === "Complimentary") {
    patch.status = "Active";
  } else if (resolved.status === "Past Due") {
    patch.status = "Past Due";
  } else if (resolved.status === "Past Due (Access Restricted)") {
    patch.status = "Past Due";
  } else if (resolved.status === "Cancelled" || resolved.status === "Expired" || resolved.status === "Payment Failed") {
    patch.status = "Cancelled";
  }

  // Grace + failure timestamps
  if (resolved.in_grace || resolved.status === "Past Due (Access Restricted)") {
    if (!member.payment_failed_at) patch.payment_failed_at = resolved.payment_failed_at;
    if (!member.grace_period_ends_at) patch.grace_period_ends_at = resolved.grace_ends_at;
  }

  // Recovery: cleared failure
  let recovered = false;
  if (resolved.grants_access && resolved.status !== "Past Due" && (member.payment_failed_at || member.grace_period_ends_at) && (resolved.status === "Active" || resolved.status === "Trialing" || resolved.status === "Active (Cancels at period end)")) {
    patch.payment_failed_at = null;
    patch.grace_period_ends_at = null;
    patch.access_restricted_at = null;
    patch.payment_recovered_at = now;
    recovered = true;
  }

  // Access restriction (grace expired)
  if (resolved.status === "Past Due (Access Restricted)" && !member.access_restricted_at) {
    patch.access_restricted_at = now;
  }

  // Subscription ended
  if (resolved.subscription_ended && !member.subscription_ended_at) {
    patch.subscription_ended_at = now;
  }

  if (resolved.status === "Hold Plan" && !member.hold_plan_started_at) {
    patch.hold_plan_started_at = now;
  }

  await supabaseAdmin.from("app_members").update(patch).eq("id", member.id);

  // Entitlements
  await supabaseAdmin.from("member_access").update({ active: resolved.grants_access }).eq("member_id", member.id);

  const changed = fromStatus !== resolved.status;

  // Audit + gated lifecycle triggers
  if (changed) {
    if (resolved.status === "Past Due" && fromStatus !== "Past Due") {
      await recordTransition(supabaseAdmin, member.id, "past_due_grace_started", {
        from_status: fromStatus, to_status: resolved.status,
        stripe_event_id: stripeEventId, stripe_subscription_id: sub?.id ?? null,
        metadata: { grace_period_ends_at: resolved.grace_ends_at },
      });
      await fireGatedTrigger(member.id, "subscription_grace_warning", {
        grace_ends: resolved.grace_ends_at ? new Date(resolved.grace_ends_at).toLocaleDateString() : "",
      });
    } else if (resolved.status === "Past Due (Access Restricted)") {
      await recordTransition(supabaseAdmin, member.id, "grace_expired_access_restricted", {
        from_status: fromStatus, to_status: resolved.status,
        stripe_event_id: stripeEventId, stripe_subscription_id: sub?.id ?? null,
      });
    } else if (recovered) {
      await recordTransition(supabaseAdmin, member.id, "payment_recovered", {
        from_status: fromStatus, to_status: resolved.status,
        stripe_event_id: stripeEventId, stripe_subscription_id: sub?.id ?? null,
      });
      await fireGatedTrigger(member.id, "subscription_payment_recovered", {});
    } else if (resolved.subscription_ended) {
      await recordTransition(supabaseAdmin, member.id, "subscription_ended", {
        from_status: fromStatus, to_status: resolved.status,
        stripe_event_id: stripeEventId, stripe_subscription_id: sub?.id ?? member.stripe_subscription_id,
      });
      await fireGatedTrigger(member.id, "subscription_ended", {});
    }
  } else if (stripeEventId) {
    await recordTransition(supabaseAdmin, member.id, "idempotent_replay", {
      from_status: fromStatus, to_status: resolved.status,
      stripe_event_id: stripeEventId, stripe_subscription_id: sub?.id ?? null,
    });
  }

  return { resolved, changed };
}

/**
 * Record a controlled "No such customer / subscription" or cross-account
 * sync warning without mutating Stripe references, status, or entitlements.
 * Returns a tagged result the caller can surface to the admin/member.
 */
export async function recordSyncWarning(args: {
  supabaseAdmin: any;
  memberId: string;
  reason: string;
  metadata?: Record<string, any>;
}): Promise<{ ok: false; sync_warning: true; reason: string }> {
  await args.supabaseAdmin.from("app_members").update({
    sync_warning_at: new Date().toISOString(),
    sync_warning_reason: args.reason,
  }).eq("id", args.memberId);
  await recordTransition(args.supabaseAdmin, args.memberId, "sync_warning", {
    reason: args.reason,
    metadata: args.metadata ?? {},
  });
  return { ok: false as const, sync_warning: true as const, reason: args.reason };
}

export async function recordCrossAccountWarning(args: {
  supabaseAdmin: any;
  memberId: string;
  reason: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  await args.supabaseAdmin.from("app_members").update({
    sync_warning_at: new Date().toISOString(),
    sync_warning_reason: args.reason,
  }).eq("id", args.memberId);
  await recordTransition(args.supabaseAdmin, args.memberId, "cross_account_warning", {
    reason: args.reason,
    metadata: args.metadata ?? {},
  });
}

export async function recordRestartTransition(args: {
  supabaseAdmin: any;
  memberId: string;
  reason?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  await recordTransition(args.supabaseAdmin, args.memberId, "membership_restarted", {
    reason: args.reason ?? null,
    metadata: args.metadata ?? {},
  });
}

export async function recordKeepMembershipTransition(args: {
  supabaseAdmin: any;
  memberId: string;
  subscriptionId: string;
}): Promise<void> {
  await recordTransition(args.supabaseAdmin, args.memberId, "membership_kept", {
    stripe_subscription_id: args.subscriptionId,
  });
}

export async function recordDuplicateBlocked(args: {
  supabaseAdmin: any;
  memberId: string;
  reason: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  await recordTransition(args.supabaseAdmin, args.memberId, "duplicate_subscription_blocked", {
    reason: args.reason,
    metadata: args.metadata ?? {},
  });
}

/**
 * Lazy grace-expiry enforcement. Call this when reading a member's billing
 * state (e.g. getMyJfBilling) so an expired grace window flips entitlements
 * even if no webhook arrives. Uses server time, never the browser clock.
 */
export async function enforceGraceIfExpired(supabaseAdmin: any, member: any): Promise<any> {
  if (!member?.grace_period_ends_at) return member;
  if (member.access_restricted_at) return member; // already enforced
  if (new Date(member.grace_period_ends_at) > new Date()) return member;

  const now = new Date().toISOString();
  await supabaseAdmin.from("app_members").update({
    subscription_status: "Past Due (Access Restricted)",
    access_restricted_at: now,
    last_billing_event_at: now,
  }).eq("id", member.id);
  await supabaseAdmin.from("member_access").update({ active: false }).eq("member_id", member.id);
  await recordTransition(supabaseAdmin, member.id, "grace_expired_access_restricted", {
    from_status: member.subscription_status, to_status: "Past Due (Access Restricted)",
    reason: "lazy_enforcement",
  });
  return { ...member, subscription_status: "Past Due (Access Restricted)", access_restricted_at: now };
}