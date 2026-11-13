/**
 * Server-only helper that fires an SMS automation trigger.
 *
 * Picks every active sms_automations row whose trigger_type matches, renders
 * the body with the provided template vars, and sends via Twilio. Each send
 * is recorded in sms_log with the automation id + trigger.
 *
 * Safe to import from server routes and server functions only.
 */

import { assignedCoachOf, coachById, renderSmsTemplate, resolveCoachName } from "@/lib/sms-identity";
import { normalizePhone } from "@/lib/sms-policy";
import type { SmsCategory } from "@/lib/sms-policy";

/** Texts that carry a setup link or warn of an account change are account security. */
const SECURITY_TRIGGERS = new Set(["account_created", "subscription_purchased", "email_change_requested"]);

function categoryForTrigger(trigger: string): SmsCategory {
  return SECURITY_TRIGGERS.has(trigger) ? "security" : "automation";
}

/**
 * Triggers governed by the membership notification safety mode.
 * Anything starting with `subscription_` plus the explicit set below.
 * `account_created` is intentionally NOT gated — it's used for non-membership
 * account creation flows too.
 */
const MEMBERSHIP_TRIGGERS = new Set<string>([
  "subscription_purchased",
  "subscription_trial_ending",
  "subscription_payment_failed",
  "subscription_payment_recovered",
  "subscription_grace_warning",
  "subscription_cancelled",
  "subscription_ended",
  "subscription_restarted",
]);

type SafetyMode = "dry_run" | "allowlist" | "live";
type SafetyConfig = {
  mode: SafetyMode;
  allowlist_phones: string[];
  allowlist_emails: string[];
};

function isMembershipTrigger(trigger: string): boolean {
  return MEMBERSHIP_TRIGGERS.has(trigger) || trigger.startsWith("subscription_");
}

async function readSafetyConfig(supabaseAdmin: any): Promise<SafetyConfig> {
  const fallback: SafetyConfig = { mode: "dry_run", allowlist_phones: [], allowlist_emails: [] };
  try {
    const { data } = await supabaseAdmin
      .from("app_settings").select("value")
      .eq("key", "jf_membership_notifications").maybeSingle();
    if (!data?.value) return fallback;
    const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    const mode = (["dry_run", "allowlist", "live"] as const).includes(parsed?.mode) ? parsed.mode : "dry_run";
    const phones = Array.isArray(parsed?.allowlist_phones) ? parsed.allowlist_phones.map((p: any) => String(p)) : [];
    const emails = Array.isArray(parsed?.allowlist_emails) ? parsed.allowlist_emails.map((e: any) => String(e).toLowerCase()) : [];
    return { mode, allowlist_phones: phones, allowlist_emails: emails };
  } catch (e) {
    console.warn("[sms-trigger] failed to read jf_membership_notifications, defaulting to dry_run", e);
    return fallback;
  }
}

async function recordAttempt(supabaseAdmin: any, row: Record<string, any>) {
  try {
    await supabaseAdmin.from("jf_notification_attempts").insert(row);
  } catch (e) {
    console.warn("[sms-trigger] failed to record notification attempt", e);
  }
}

const renderTemplate = renderSmsTemplate;

export type AutomationContext = {
  /** trigger event key (matches sms_automations.trigger_type) */
  trigger: string;
  /** target member (if firing for an app_members row) */
  memberId?: string | null;
  /** target client (if firing for a clients row) */
  clientId?: string | null;
  /** phone to send to; if omitted we look it up on the member/client */
  phone?: string | null;
  /** template variables — merged with auto-resolved {first_name},{full_name},{coach},{brand},{setup_link} */
  vars?: Record<string, string>;
  /**
   * The event this fires for (e.g. a Stripe event id). The same event never
   * texts twice; without one, an automation texts a person at most once a day.
   */
  eventKey?: string | null;
};

/**
 * Fire every active automation matching `ctx.trigger`. Best-effort: failures
 * are recorded in sms_log but never throw out of this function so the calling
 * webhook/server-fn can continue.
 */
export async function fireAutomationTrigger(supabaseAdmin: any, ctx: AutomationContext) {
  try {
    const { data: settings } = await supabaseAdmin
      .from("sms_settings").select("*").eq("singleton", true).maybeSingle();
    if (!settings?.enabled || !settings.from_phone) return { fired: 0, reason: "sms_disabled" };

    const { data: automations } = await supabaseAdmin
      .from("sms_automations").select("*")
      .eq("trigger_type", ctx.trigger).eq("active", true);
    if (!automations || automations.length === 0) return { fired: 0, reason: "no_automation" };

    // --- Membership notification safety gate ---------------------------
    // For any membership-lifecycle trigger, the configured mode in
    // app_settings.jf_membership_notifications decides whether we actually
    // call Twilio. Default is dry_run so nothing ships until an admin
    // explicitly switches to allowlist or live.
    const gated = isMembershipTrigger(ctx.trigger);
    const safety = gated ? await readSafetyConfig(supabaseAdmin) : null;

    // Resolve recipient
    let toPhone = normalizePhone(ctx.phone ?? null);
    let firstName = "there";
    let fullName = "";
    let optOut = false;
    let memberEmail: string | null = null;
    let coachRow: any = null;

    if (ctx.memberId) {
      const { data: m } = await supabaseAdmin
        .from("app_members").select("id, user_id, full_name, email, phone, sms_opt_out").eq("id", ctx.memberId).maybeSingle();
      if (m?.user_id) {
        coachRow = await assignedCoachOf(supabaseAdmin, { userId: m.user_id });
      }
      if (m) {
        if (!toPhone) toPhone = normalizePhone(m.phone);
        fullName = m.full_name ?? "";
        firstName = (m.full_name?.split(" ")[0]) || (m.email?.split("@")[0]) || "there";
        optOut = !!m.sms_opt_out;
        memberEmail = m.email ?? null;
      }
    } else if (ctx.clientId) {
      const { data: c } = await supabaseAdmin
        .from("clients").select("id, first_name, full_name, phone, sms_opt_out, assigned_coach_id").eq("id", ctx.clientId).maybeSingle();
      if (c) {
        coachRow = await coachById(supabaseAdmin, (c as any).assigned_coach_id);
        if (!toPhone) toPhone = normalizePhone(c.phone);
        fullName = c.full_name ?? "";
        firstName = c.first_name ?? c.full_name?.split(" ")[0] ?? "there";
        optOut = !!c.sms_opt_out;
      }
    }

    const baseVars: Record<string, string> = {
      first_name: firstName,
      full_name: fullName,
      coach: resolveCoachName(coachRow, settings.default_coach_name),
      brand: settings.brand_name ?? "",
      setup_link: "",
      ...(ctx.vars ?? {}),
    };

    let fired = 0;
    for (const auto of automations) {
      const body = renderTemplate(auto.body, baseVars);
      const logBase: any = {
        client_id: ctx.clientId ?? null,
        app_member_id: ctx.memberId ?? null,
        to_phone: toPhone ?? "",
        body,
        kind: "automation",
        automation_id: auto.id,
        automation_trigger: ctx.trigger,
      };
      const attemptBase: Record<string, any> = {
        channel: "sms",
        trigger_key: ctx.trigger,
        mode: safety?.mode ?? "live",
        member_id: ctx.memberId ?? null,
        client_id: ctx.clientId ?? null,
        recipient: toPhone,
        rendered_body: body,
        automation_id: auto.id,
        metadata: { email: memberEmail },
      };

      if (optOut) {
        await supabaseAdmin.from("sms_log").insert({ ...logBase, status: "skipped", error: "opted_out" });
        if (gated) await recordAttempt(supabaseAdmin, { ...attemptBase, decision: "skipped", reason: "opted_out" });
        continue;
      }
      if (!toPhone) {
        await supabaseAdmin.from("sms_log").insert({ ...logBase, status: "skipped", error: "no_phone" });
        if (gated) await recordAttempt(supabaseAdmin, { ...attemptBase, decision: "skipped", reason: "no_phone" });
        continue;
      }

      // --- Safety mode enforcement (membership only) -------------------
      if (gated && safety) {
        if (safety.mode === "dry_run") {
          const { data: logRow } = await supabaseAdmin
            .from("sms_log")
            .insert({ ...logBase, status: "skipped", error: "dry_run_mode" })
            .select("id").maybeSingle();
          await recordAttempt(supabaseAdmin, {
            ...attemptBase,
            decision: "dry_run",
            reason: "safety_mode_dry_run",
            sms_log_id: logRow?.id ?? null,
          });
          continue;
        }
        if (safety.mode === "allowlist") {
          const allowed = safety.allowlist_phones.map(normalizePhone).includes(toPhone);
          if (!allowed) {
            const { data: logRow } = await supabaseAdmin
              .from("sms_log")
              .insert({ ...logBase, status: "skipped", error: "not_on_allowlist" })
              .select("id").maybeSingle();
            await recordAttempt(supabaseAdmin, {
              ...attemptBase,
              decision: "suppressed",
              reason: "not_on_allowlist",
              sms_log_id: logRow?.id ?? null,
            });
            continue;
          }
        }
        // live mode: fall through to actual send
      }

      const { sendSms } = await import("@/lib/sms-gateway.server");
      const who = ctx.memberId ?? ctx.clientId ?? toPhone;
      const r = await sendSms(supabaseAdmin, {
        category: categoryForTrigger(ctx.trigger),
        kind: "automation",
        to: toPhone,
        body,
        key: `automation:${auto.id}:${who}:${ctx.eventKey ?? new Date().toISOString().slice(0, 10)}`,
        clientId: ctx.clientId ?? null,
        memberId: ctx.memberId ?? null,
        automationId: auto.id,
        automationTrigger: ctx.trigger,
      });
      if (gated) await recordAttempt(supabaseAdmin, {
        ...attemptBase,
        decision: r.status === "sent" ? "sent" : r.status === "failed" ? "failed" : "suppressed",
        reason: r.status === "sent" ? (safety?.mode === "allowlist" ? "allowlisted" : "live_mode") : r.status === "failed" ? r.error : r.reason,
        sms_log_id: r.id ?? null,
      });
      if (r.status === "sent") fired++;
    }
    return { fired };
  } catch (e: any) {
    console.error("[sms-trigger] error", e);
    return { fired: 0, error: e?.message ?? String(e) };
  }
}
