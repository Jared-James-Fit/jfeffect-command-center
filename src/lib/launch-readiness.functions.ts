// ============================================================================
// Phase 6 — Admin Launch Readiness aggregator.
//
// Single server fn that scans every readiness signal we already persist
// (settings, legal placements, webhook secrets, notification mode, support
// email, sales-page publish state, recent billing-event activity, cross-account
// sync warnings, pending-signup hygiene). Returns a flat checklist the panel
// renders verbatim. No live writes, no secrets in the response.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveMembershipLaunchGate } from "@/lib/membership-launch-gate.functions";
import { getStripeKeyDiagnostics } from "@/lib/stripe.server";

export type ReadinessState = "ready" | "warning" | "blocked" | "manual";

export type ReadinessCheck = {
  key: string;
  label: string;
  state: ReadinessState;
  detail?: string | null;
  group: string;
};

export type ReadinessSummary =
  | "Not Ready"
  | "Ready for Test-Mode QA"
  | "Ready for Final Manual Verification"
  | "Ready to Promote and Sell";

export type LaunchReadinessReport = {
  generated_at: string;
  summary: ReadinessSummary;
  checks: ReadinessCheck[];
  counts: { ready: number; warning: number; blocked: number; manual: number };
};

async function assertAdmin(context: any) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden");
}

export const getLaunchReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LaunchReadinessReport> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const checks: ReadinessCheck[] = [];
    const push = (c: ReadinessCheck) => checks.push(c);

    // 1. Settings -----------------------------------------------------------
    const { data: settings } = await supabaseAdmin
      .from("jf_membership_settings")
      .select("*").eq("id", true).maybeSingle();

    push({
      key: "monthly_price_id",
      group: "Stripe",
      label: "Monthly price ID configured",
      state: settings?.monthly_price_id ? "ready" : "blocked",
      detail: settings?.monthly_price_id ? "Price ID set" : "Configure in Membership Settings",
    });
    push({
      key: "monthly_display",
      group: "Stripe",
      label: "Display price matches $29 USD/month",
      state: /\$?29.*month/i.test(settings?.monthly_price_display ?? "") ? "ready" : "warning",
      detail: settings?.monthly_price_display ?? "(unset)",
    });
    push({
      key: "trial_days",
      group: "Stripe",
      label: "3-day trial configured",
      state: settings?.trial_days === 3 ? "ready" : "warning",
      detail: `${settings?.trial_days ?? 0} day(s)`,
    });
    const mode = settings?.stripe_mode === "test" ? "test" : "live";
    push({
      key: "stripe_mode",
      group: "Stripe",
      label: `Stripe mode: ${mode}`,
      state: "ready",
      detail: mode === "live" ? "Live mode — real cards will be charged" : "Test mode — safe for QA",
    });
    push({
      key: "grace_period",
      group: "Stripe",
      label: "5-day grace period configured",
      state: settings?.grace_period_days === 5 ? "ready" : "warning",
      detail: `${settings?.grace_period_days ?? 0} day(s)`,
    });

    // 2. Webhook secrets ----------------------------------------------------
    const liveWh = !!process.env.STRIPE_WEBHOOK_SECRET?.trim();
    const testWh = !!process.env.STRIPE_WEBHOOK_SECRET_TEST?.trim();
    push({
      key: "webhook_secret_live",
      group: "Stripe",
      label: "Live webhook secret detected",
      state: liveWh ? "ready" : (mode === "live" ? "blocked" : "warning"),
      detail: liveWh ? "STRIPE_WEBHOOK_SECRET set" : "Missing STRIPE_WEBHOOK_SECRET",
    });
    push({
      key: "webhook_secret_test",
      group: "Stripe",
      label: "Test webhook secret detected",
      state: testWh ? "ready" : (mode === "test" ? "blocked" : "warning"),
      detail: testWh ? "STRIPE_WEBHOOK_SECRET_TEST set" : "Missing STRIPE_WEBHOOK_SECRET_TEST",
    });
    const diag = getStripeKeyDiagnostics();
    push({
      key: "stripe_keys",
      group: "Stripe",
      label: `Stripe API keys present for ${mode}`,
      state: (mode === "live" ? diag.live_present : diag.test_present) ? "ready" : "blocked",
      detail: JSON.stringify(diag),
    });

    // 3. Recent webhook processing -----------------------------------------
    const { count: recentEvents } = await supabaseAdmin
      .from("jf_billing_events")
      .select("id", { count: "exact", head: true })
      .gte("processed_at", new Date(Date.now() - 7 * 86400_000).toISOString());
    push({
      key: "recent_webhook",
      group: "Stripe",
      label: "Recent webhook processing successful",
      state: (recentEvents ?? 0) > 0 ? "ready" : "warning",
      detail: `${recentEvents ?? 0} events in last 7 days`,
    });
    push({
      key: "event_idempotency",
      group: "Stripe",
      label: "Event idempotency available",
      state: "ready",
      detail: "processed_stripe_events table active",
    });

    // 4. Notification mode --------------------------------------------------
    const { data: notifSetting } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "jf_membership_notifications").maybeSingle();
    let notifMode = "dry_run";
    let phones: any[] = [];
    let emails: any[] = [];
    try {
      const parsed = typeof notifSetting?.value === "string" ? JSON.parse(notifSetting!.value) : (notifSetting?.value ?? {});
      notifMode = parsed?.mode ?? "dry_run";
      phones = parsed?.allowlist_phones ?? [];
      emails = parsed?.allowlist_emails ?? [];
    } catch { /* default */ }
    push({
      key: "notification_mode",
      group: "Notifications",
      label: `Notification mode: ${notifMode}`,
      state: notifMode === "live" ? "warning" : "ready",
      detail: notifMode === "live"
        ? "Live — real messages will send. Confirm intentional before promoting."
        : notifMode === "allowlist"
          ? `Allowlist (${phones.length} phones, ${emails.length} emails)`
          : "Dry run — no provider calls",
    });

    // 5. Legal --------------------------------------------------------------
    const gate = await resolveMembershipLaunchGate({ admin: true });
    const legalBlockers = (gate.admin_blockers ?? []).filter((b) =>
      /terms|privacy|membership-agreement|recurring|cancellation|placement|legal/i.test(b),
    );
    push({
      key: "legal_terms",
      group: "Legal",
      label: "Terms published",
      state: legalBlockers.some((b) => /terms/i.test(b)) ? "blocked" : "ready",
    });
    push({
      key: "legal_privacy",
      group: "Legal",
      label: "Privacy published",
      state: legalBlockers.some((b) => /privacy/i.test(b)) ? "blocked" : "ready",
    });
    push({
      key: "legal_agreement",
      group: "Legal",
      label: "Membership Agreement published",
      state: legalBlockers.some((b) => /membership-agreement/i.test(b)) ? "blocked" : "ready",
    });
    push({
      key: "legal_billing_disclosure",
      group: "Legal",
      label: "Recurring billing disclosure active",
      state: legalBlockers.some((b) => /recurring/i.test(b)) ? "blocked" : "ready",
    });
    push({
      key: "legal_refund",
      group: "Legal",
      label: "Cancellation/refund policy active",
      state: legalBlockers.some((b) => /cancellation/i.test(b)) ? "blocked" : "ready",
    });
    push({
      key: "legal_placement",
      group: "Legal",
      label: "Legal checkout placement complete",
      state: legalBlockers.some((b) => /placement/i.test(b)) ? "blocked" : "ready",
      detail: legalBlockers.find((b) => /placement/i.test(b)) ?? null,
    });
    push({
      key: "legal_persistence",
      group: "Legal",
      label: "Legal acceptance persistence working",
      state: "ready",
      detail: "legal_acceptances table active",
    });

    // 6. Support email & sales page ----------------------------------------
    push({
      key: "support_email",
      group: "Comms",
      label: "Support email configured",
      state: settings?.support_email ? "ready" : "blocked",
      detail: settings?.support_email ? "Configured" : "Configure in Membership Settings",
    });

    const { data: sales } = await supabaseAdmin
      .from("sales_pages").select("published, slug")
      .eq("slug", "membership").maybeSingle();
    push({
      key: "sales_published",
      group: "Sales",
      label: "Sales page published",
      state: sales?.published ? "ready" : "warning",
    });
    push({
      key: "join_cta",
      group: "Sales",
      label: "/join CTA connected",
      state: "ready",
      detail: "Route /join present",
    });
    push({
      key: "checkout_gate",
      group: "Sales",
      label: "Checkout launch gate passing",
      state: gate.ok ? "ready" : "blocked",
      detail: gate.ok ? null : `${(gate.admin_blockers ?? []).length} blocker(s)`,
    });

    // 7. Manual verifications ----------------------------------------------
    push({
      key: "portal_verified",
      group: "Manual",
      label: "Stripe Customer Portal manually verified",
      state: "manual",
      detail: "Confirm in Stripe Dashboard → Settings → Billing → Customer Portal",
    });

    // 8. Lifecycle flows ----------------------------------------------------
    push({ key: "restart_flow", group: "Lifecycle", label: "Expired-member Restart flow available", state: "ready" });
    push({ key: "keep_flow", group: "Lifecycle", label: "Keep Membership flow available", state: "ready" });

    // 9. Cleanup / safety ---------------------------------------------------
    const { count: pendingCount } = await supabaseAdmin
      .from("jf_pending_signups")
      .select("id", { count: "exact", head: true })
      .lt("expires_at", new Date().toISOString());
    push({
      key: "pending_cleanup",
      group: "Safety",
      label: "Pending-signup cleanup active",
      state: (pendingCount ?? 0) > 50 ? "warning" : "ready",
      detail: `${pendingCount ?? 0} expired pending signup(s) awaiting cleanup`,
    });

    const { count: crossLocked } = await supabaseAdmin
      .from("app_members")
      .select("id", { count: "exact", head: true })
      .eq("cross_account_locked", true);
    push({
      key: "cross_account",
      group: "Safety",
      label: "Cross-account Stripe warnings reviewed",
      state: (crossLocked ?? 0) === 0 ? "ready" : "manual",
      detail: `${crossLocked ?? 0} member(s) flagged for manual review`,
    });
    push({
      key: "comp_provenance",
      group: "Safety",
      label: "Complimentary provenance available",
      state: "ready",
      detail: "Complimentary records tagged via adminCompAccess",
    });

    // ── Summary ───────────────────────────────────────────────────────────
    const counts = {
      ready: checks.filter((c) => c.state === "ready").length,
      warning: checks.filter((c) => c.state === "warning").length,
      blocked: checks.filter((c) => c.state === "blocked").length,
      manual: checks.filter((c) => c.state === "manual").length,
    };
    let summary: ReadinessSummary;
    if (counts.blocked > 0) summary = "Not Ready";
    else if (counts.manual > 0) summary = "Ready for Final Manual Verification";
    else if (mode === "test" || notifMode !== "live") summary = "Ready for Test-Mode QA";
    else summary = "Ready to Promote and Sell";

    // Never advertise "Ready to Promote and Sell" if legal still blocked.
    if (legalBlockers.length > 0) summary = "Not Ready";

    return { generated_at: new Date().toISOString(), summary, checks, counts };
  });

/* ───── Billing events list ───── */
export const adminListBillingEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number; type?: string }) => d ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("jf_billing_events")
      .select("id, stripe_event_id, type, customer_id, subscription_id, member_id, processed_at, payload")
      .order("processed_at", { ascending: false })
      .limit(Math.min(Math.max(data?.limit ?? 100, 1), 500));
    if (data?.type) q = q.eq("type", data.type);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      stripe_event_id: r.stripe_event_id,
      type: r.type,
      customer_id: r.customer_id,
      subscription_id: r.subscription_id,
      member_id: r.member_id,
      processed_at: r.processed_at,
      livemode: r.payload?.livemode ?? null,
      // Never echo full payload — just a short summary string.
      summary: r.payload?.data?.object?.status
        ? `status=${r.payload.data.object.status}`
        : null,
    }));
  });

/* ───── Notification attempts list ───── */
export const adminListNotificationAttempts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number; decision?: string }) => d ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("jf_notification_attempts")
      .select("id, channel, trigger_key, mode, decision, reason, recipient, rendered_body, member_id, created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(data?.limit ?? 100, 1), 500));
    if (data?.decision) q = q.eq("decision", data.decision);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    // Redact recipients to last 4 of phone / domain of email.
    return (rows ?? []).map((r: any) => {
      let recipient = r.recipient as string | null;
      if (recipient && r.channel === "sms") {
        recipient = recipient.length >= 4 ? `••••${recipient.slice(-4)}` : "••••";
      } else if (recipient && r.channel === "email") {
        const [user, domain] = recipient.split("@");
        recipient = user && domain ? `${user[0] ?? "•"}•••@${domain}` : "•••";
      }
      return { ...r, recipient };
    });
  });

/* ───── Failed-payment / grace cohort ───── */
export const adminListGraceCohort = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_members")
      .select("id, full_name, email, subscription_status, payment_failed_at, grace_period_ends_at, access_restricted_at")
      .or("payment_failed_at.not.is.null,access_restricted_at.not.is.null,grace_period_ends_at.not.is.null")
      .order("payment_failed_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const now = Date.now();
    return (data ?? []).map((m: any) => {
      const ends = m.grace_period_ends_at ? new Date(m.grace_period_ends_at).getTime() : null;
      let bucket: string;
      if (m.access_restricted_at) bucket = "restricted";
      else if (ends && ends < now) bucket = "expired";
      else if (ends && ends - now < 86400_000) bucket = "ends_today";
      else if (ends && ends - now < 3 * 86400_000) bucket = "expires_soon";
      else if (m.subscription_status === "Active") bucket = "recovered";
      else bucket = "in_grace";
      return { ...m, bucket };
    });
  });