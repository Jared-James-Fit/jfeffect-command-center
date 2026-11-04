// ============================================================================
// Membership diagnostics: verified Stripe billing events and notification
// attempts (Membership → Billing Events / Notifications Log). The one-time
// go-live readiness report and its page were removed after launch.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminView } from "@/lib/permissions.server";

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

// The go-live readiness report went with its page once membership launched.

export const adminListBillingEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number; type?: string }) => d ?? {})
  .handler(async ({ data, context }) => {
    await assertAdminView(context as any);
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
    await assertAdminView(context as any);
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