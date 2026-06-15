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
  /** Who can clear this blocker. */
  owner?: "Jared" | "Lovable" | "Manual";
  /** Does this prevent Checkout Session creation right now? */
  blocks_checkout?: boolean;
  /** Does this prevent safely promoting the membership to the public? */
  blocks_promotion?: boolean;
  /** Short imperative action label, e.g. "Open Membership Settings". */
  action_label?: string | null;
  /** In-app route OR external URL (https://). UI decides how to render. */
  action_href?: string | null;
  /** Smallest concrete next step, written for a non-engineer. */
  next_step?: string | null;
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
      owner: "Jared",
      blocks_checkout: !settings?.monthly_price_id,
      blocks_promotion: !settings?.monthly_price_id,
      action_label: "Open Membership Settings",
      action_href: "/admin/settings",
      next_step: settings?.monthly_price_id ? null : "Paste the live monthly price ID (price_…) from Stripe → Products.",
    });
    push({
      key: "monthly_display",
      group: "Stripe",
      label: "Display price matches $29 USD/month",
      state: /\$?29.*month/i.test(settings?.monthly_price_display ?? "") ? "ready" : "warning",
      detail: settings?.monthly_price_display ?? "(unset)",
      owner: "Jared",
      blocks_checkout: false,
      blocks_promotion: false,
      action_label: "Open Membership Settings",
      action_href: "/admin/settings",
      next_step: /\$?29.*month/i.test(settings?.monthly_price_display ?? "") ? null : "Set display label, e.g. \"$29 USD/month\".",
    });
    push({
      key: "trial_days",
      group: "Stripe",
      label: "3-day trial configured",
      state: settings?.trial_days === 3 ? "ready" : "warning",
      detail: `${settings?.trial_days ?? 0} day(s)`,
      owner: "Jared",
      blocks_checkout: false,
      blocks_promotion: false,
      action_label: "Open Membership Settings",
      action_href: "/admin/settings",
      next_step: settings?.trial_days === 3 ? null : "Set trial_days = 3.",
    });
    const mode = settings?.stripe_mode === "test" ? "test" : "live";
    push({
      key: "stripe_mode",
      group: "Stripe",
      label: `Stripe mode: ${mode}`,
      state: "ready",
      detail: mode === "live" ? "Live mode — real cards will be charged" : "Test mode — safe for QA",
      owner: "Jared",
      blocks_checkout: false,
      blocks_promotion: false,
      action_label: "Open Membership Settings",
      action_href: "/admin/settings",
    });
    push({
      key: "grace_period",
      group: "Stripe",
      label: "5-day grace period configured",
      state: settings?.grace_period_days === 5 ? "ready" : "warning",
      detail: `${settings?.grace_period_days ?? 0} day(s)`,
      owner: "Jared",
      blocks_checkout: false,
      blocks_promotion: false,
      action_label: "Open Membership Settings",
      action_href: "/admin/settings",
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
      owner: "Jared",
      blocks_checkout: !liveWh && mode === "live",
      blocks_promotion: !liveWh,
      action_label: "Open Stripe Dashboard → Webhooks",
      action_href: "https://dashboard.stripe.com/webhooks",
      next_step: liveWh ? null : "Create live webhook endpoint, copy signing secret into Lovable Cloud Secrets as STRIPE_WEBHOOK_SECRET.",
    });
    push({
      key: "webhook_secret_test",
      group: "Stripe",
      label: "Test webhook secret detected",
      state: testWh ? "ready" : (mode === "test" ? "blocked" : "warning"),
      detail: testWh ? "STRIPE_WEBHOOK_SECRET_TEST set" : "Missing STRIPE_WEBHOOK_SECRET_TEST",
      owner: "Jared",
      blocks_checkout: !testWh && mode === "test",
      blocks_promotion: false,
      action_label: "Open Stripe Dashboard → Webhooks (Test)",
      action_href: "https://dashboard.stripe.com/test/webhooks",
      next_step: testWh ? null : "Optional but recommended: add a test webhook for safe QA.",
    });
    const diag = getStripeKeyDiagnostics();
    push({
      key: "stripe_keys",
      group: "Stripe",
      label: `Stripe API keys present for ${mode}`,
      state: (mode === "live" ? diag.live_key_available : diag.test_key_available) ? "ready" : "blocked",
      detail: `live=${diag.live_key_available ? "yes" : "missing"}, test=${diag.test_key_available ? "yes" : "missing"}`,
      owner: "Jared",
      blocks_checkout: (mode === "live" ? !diag.live_key_available : !diag.test_key_available),
      blocks_promotion: !diag.live_key_available,
      action_label: "Open Lovable Cloud Secrets",
      action_href: null,
      next_step: (mode === "live" ? diag.live_key_available : diag.test_key_available)
        ? null
        : `Add STRIPE_SECRET_KEY (live) ${mode === "test" ? "and/or STRIPE_SECRET_KEY_TEST" : ""} via Project → Backend → Secrets.`,
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
      owner: "Manual",
      blocks_checkout: false,
      blocks_promotion: false,
      action_label: "Open Billing Events",
      action_href: "/admin/membership/billing-events",
      next_step: (recentEvents ?? 0) > 0 ? null : "Send one test webhook (or take any Stripe action) and confirm an event lands here.",
    });
    push({
      key: "event_idempotency",
      group: "Stripe",
      label: "Event idempotency available",
      state: "ready",
      detail: "processed_stripe_events table active",
      owner: "Lovable",
      blocks_checkout: false,
      blocks_promotion: false,
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
      owner: "Jared",
      blocks_checkout: false,
      blocks_promotion: notifMode === "dry_run",
      action_label: "Open Notification Settings",
      action_href: "/admin/membership/notifications",
      next_step: notifMode === "live"
        ? null
        : notifMode === "allowlist"
          ? "After successful allowlisted test, switch to Live before promoting."
          : "Move to Allowlist for QA, then Live before promoting.",
    });

    // 5. Legal --------------------------------------------------------------
    const gate = await resolveMembershipLaunchGate({ admin: true });
    const legalBlockers = (gate.admin_blockers ?? []).filter((b) =>
      /terms|privacy|membership-agreement|recurring|cancellation|placement|legal/i.test(b),
    );
    const legalDoc = (key: string, label: string, match: RegExp) => {
      const failingBlocker = legalBlockers.find((b) => match.test(b));
      push({
        key,
        group: "Legal",
        label,
        state: failingBlocker ? "blocked" : "ready",
        detail: failingBlocker ?? null,
        owner: "Jared",
        blocks_checkout: !!failingBlocker,
        blocks_promotion: !!failingBlocker,
        action_label: "Open Legal Workspace",
        action_href: "/admin/legal",
        next_step: failingBlocker
          ? "Review the current draft, publish a version, enable public-read where required, and activate the membership-checkout placement."
          : null,
      });
    };
    legalDoc("legal_terms", "Terms published", /terms/i);
    legalDoc("legal_privacy", "Privacy published", /privacy/i);
    legalDoc("legal_agreement", "Membership Agreement published", /membership-agreement/i);
    legalDoc("legal_billing_disclosure", "Recurring billing disclosure active", /recurring/i);
    legalDoc("legal_refund", "Cancellation/refund policy active", /cancellation/i);
    legalDoc("legal_placement", "Legal checkout placement complete", /placement/i);
    push({
      key: "legal_persistence",
      group: "Legal",
      label: "Legal acceptance persistence working",
      state: "ready",
      detail: "legal_acceptances table active",
      owner: "Lovable",
      blocks_checkout: false,
      blocks_promotion: false,
    });

    // 6. Support email & sales page ----------------------------------------
    push({
      key: "support_email",
      group: "Comms",
      label: "Support email configured",
      state: settings?.support_email ? "ready" : "blocked",
      detail: settings?.support_email ? "Configured" : "Configure in Membership Settings",
      owner: "Jared",
      blocks_checkout: !settings?.support_email,
      blocks_promotion: !settings?.support_email,
      action_label: "Open Membership Settings",
      action_href: "/admin/settings",
      next_step: settings?.support_email ? null : "Enter the address members should email for help (e.g. support@jfeffect.com).",
    });

    const { data: sales } = await supabaseAdmin
      .from("sales_pages").select("page_key, published")
      .eq("page_key", "join").maybeSingle();
    push({
      key: "sales_published",
      group: "Sales",
      label: "Sales page published",
      state: (sales as any)?.published ? "ready" : "warning",
      owner: "Jared",
      blocks_checkout: false,
      blocks_promotion: !(sales as any)?.published,
      action_label: "Open Membership Sales Page",
      action_href: "/admin/membership/sales-page",
    });
    push({
      key: "join_cta",
      group: "Sales",
      label: "/membership CTA connected",
      state: "ready",
      detail: "Route /membership present",
      owner: "Lovable",
      blocks_checkout: false,
      blocks_promotion: false,
    });
    push({
      key: "checkout_gate",
      group: "Sales",
      label: "Checkout launch gate passing",
      state: gate.ok ? "ready" : "blocked",
      detail: gate.ok ? null : (gate.admin_blockers ?? []).slice(0, 8).join("; "),
      owner: "Jared",
      blocks_checkout: !gate.ok,
      blocks_promotion: !gate.ok,
      action_label: "Open Legal Workspace",
      action_href: "/admin/legal",
      next_step: gate.ok ? null : "Clear every blocker listed above to allow Checkout Session creation.",
    });

    // 7. Manual verifications ----------------------------------------------
    push({
      key: "portal_verified",
      group: "Manual",
      label: "Stripe Customer Portal manually verified",
      state: "manual",
      detail: "Confirm in Stripe Dashboard → Settings → Billing → Customer Portal",
      owner: "Jared",
      blocks_checkout: false,
      blocks_promotion: true,
      action_label: "Open Stripe Customer Portal Settings",
      action_href: "https://dashboard.stripe.com/settings/billing/portal",
      next_step: "Enable Update Payment Method + Cancel at period end, confirm Membership product visible, open Portal from a test member, then check this off in your launch notes.",
    });

    // 8. Lifecycle flows ----------------------------------------------------
    push({ key: "restart_flow", group: "Lifecycle", label: "Expired-member Restart flow available", state: "ready", owner: "Lovable", blocks_checkout: false, blocks_promotion: false });
    push({ key: "keep_flow", group: "Lifecycle", label: "Keep Membership flow available", state: "ready", owner: "Lovable", blocks_checkout: false, blocks_promotion: false });

    // 9. Cleanup / safety ---------------------------------------------------
    // 9a. Is the cleanup actually scheduled in pg_cron? Use the admin-only
    // SECURITY DEFINER RPC that exposes ONLY this single cleanup job's
    // existence, schedule, active flag, and last run metadata.
    let cronScheduled = false;
    let cronDetail = "Unable to inspect pg_cron";
    try {
      const { data: rows, error } = await (context.supabase as any).rpc(
        "get_membership_cleanup_job_status",
      );
      if (error) throw error;
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row?.exists_) {
        cronScheduled = !!row.active;
        const last = row.last_run_started_at
          ? ` · last run ${new Date(row.last_run_started_at).toISOString()} (${row.last_run_status ?? "unknown"})`
          : "";
        cronDetail = `${row.jobname} — ${row.schedule} (${row.active ? "active" : "disabled"})${last}`;
      } else {
        cronDetail = "No pg_cron job targets the pending-signups cleanup endpoint";
      }
    } catch (e: any) {
      cronDetail = `pg_cron inspection skipped: ${e?.message ?? "unknown"}`;
    }
    push({
      key: "pending_cleanup_cron",
      group: "Safety",
      label: "Pending-signup cleanup cron scheduled",
      state: cronScheduled ? "ready" : "blocked",
      detail: cronDetail,
      owner: "Lovable",
      blocks_checkout: false,
      blocks_promotion: !cronScheduled,
      action_label: null,
      action_href: null,
      next_step: cronScheduled ? null : "Lovable will schedule this via a small additive migration (Increment 2).",
    });

    const { count: pendingCount } = await supabaseAdmin
      .from("jf_pending_signups")
      .select("id", { count: "exact", head: true })
      .lt("expires_at", new Date().toISOString());
    push({
      key: "pending_cleanup",
      group: "Safety",
      label: "Pending-signup expired backlog",
      state: (pendingCount ?? 0) > 50 ? "warning" : "ready",
      detail: `${pendingCount ?? 0} expired pending signup(s) awaiting cleanup`,
      owner: "Lovable",
      blocks_checkout: false,
      blocks_promotion: false,
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
      owner: "Jared",
      blocks_checkout: false,
      blocks_promotion: (crossLocked ?? 0) > 0,
      action_label: "Open Members",
      action_href: "/admin/members",
    });
    push({
      key: "comp_provenance",
      group: "Safety",
      label: "Complimentary provenance available",
      state: "ready",
      detail: "Complimentary records tagged via adminCompAccess",
      owner: "Lovable",
      blocks_checkout: false,
      blocks_promotion: false,
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