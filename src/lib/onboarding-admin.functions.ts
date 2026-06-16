import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

async function assertAdmin(ctx: any) {
  const { data: isAdmin } = await ctx.supabase
    .rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!isAdmin) throw new Error("Admin required");
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return "+1" + cleaned;
  if (/^1\d{10}$/.test(cleaned)) return "+" + cleaned;
  return "+" + cleaned;
}

async function sendViaTwilio(toPhone: string, fromPhone: string, body: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");
  if (!twilioKey) throw new Error("TWILIO_API_KEY missing — connect Twilio in Integrations");
  const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: toPhone, From: fromPhone, Body: body }).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Twilio error (${res.status})`);
  return { sid: data.sid as string };
}

function originFromEnv(): string {
  return process.env.PUBLIC_APP_URL || process.env.SITE_URL || "https://jfeffect.com";
}

/**
 * Admin: send the "finish setting up your JF Effect app" reminder over
 * email and/or SMS. Returns a per-channel result and stamps
 * `app_members.last_setup_reminder_at` when anything was actually sent.
 */
export const sendSetupReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    memberId: z.string().uuid(),
    channels: z.array(z.enum(["email", "sms"])).min(1).default(["email"]),
    customNote: z.string().max(800).optional(),
    force: z.boolean().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSetupReminderEmail } = await import("@/lib/setup-reminder.server");

    const { data: member, error: mErr } = await supabaseAdmin
      .from("app_members")
      .select("id,email,full_name,phone,sms_opt_out")
      .eq("id", data.memberId)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!member) throw new Error("Member not found");

    const origin = originFromEnv();
    let emailResult: any = { skipped: true };
    let smsResult: any = { skipped: true };
    let anySent = false;

    if (data.channels.includes("email")) {
      emailResult = await sendSetupReminderEmail(
        supabaseAdmin,
        { id: member.id, email: member.email, full_name: member.full_name },
        origin,
        { force: data.force, customNote: data.customNote },
      );
      if (emailResult.sent) anySent = true;
    }

    if (data.channels.includes("sms")) {
      if (member.sms_opt_out) {
        smsResult = { sent: false, reason: "opted_out" };
      } else {
        const toPhone = normalizePhone(member.phone);
        if (!toPhone) {
          smsResult = { sent: false, reason: "no_phone" };
        } else {
          const { data: settings } = await supabaseAdmin
            .from("sms_settings").select("*").eq("singleton", true).maybeSingle();
          if (!settings?.enabled) {
            smsResult = { sent: false, reason: "sms_disabled" };
          } else if (!settings.from_phone) {
            smsResult = { sent: false, reason: "no_from_phone" };
          } else {
            const first = member.full_name?.split(" ")[0] ?? "there";
            const brand = settings.brand_name || "JF Effect";
            const body = `${first}, finish setting up your ${brand} app: ${origin}/install — Jared`;
            try {
              const { sid } = await sendViaTwilio(toPhone, settings.from_phone, body);
              await supabaseAdmin.from("sms_log").insert({
                app_member_id: member.id,
                to_phone: toPhone,
                body,
                kind: "manual",
                status: "sent",
                twilio_sid: sid,
                sender_user_id: context.userId,
              });
              smsResult = { sent: true, sid };
              anySent = true;
            } catch (e: any) {
              await supabaseAdmin.from("sms_log").insert({
                app_member_id: member.id,
                to_phone: toPhone,
                body,
                kind: "manual",
                status: "failed",
                error: e?.message ?? String(e),
                sender_user_id: context.userId,
              });
              smsResult = { sent: false, reason: "failed", error: e?.message ?? String(e) };
            }
          }
        }
      }
    }

    if (anySent) {
      await supabaseAdmin
        .from("app_members")
        .update({ last_setup_reminder_at: new Date().toISOString() })
        .eq("id", member.id);
    }

    return { ok: anySent, email: emailResult, sms: smsResult };
  });

/** Admin: get a one-tap install/setup link to copy & share with a member. */
export const getMemberInstallLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ memberId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: member } = await supabaseAdmin
      .from("app_members")
      .select("id,user_id,setup_token,setup_token_expires_at")
      .eq("id", data.memberId).maybeSingle();
    if (!member) throw new Error("Member not found");
    const origin = originFromEnv();
    const tokenValid = member.setup_token
      && (!member.setup_token_expires_at || new Date(member.setup_token_expires_at) > new Date());
    const url = member.setup_token && !member.user_id && tokenValid
      ? `${origin}/member-setup?token=${member.setup_token}`
      : `${origin}/install`;
    return { url };
  });

/** Admin: clear the persistent last_setup_error pill on a member. */
export const clearMemberSetupError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ memberId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_members")
      .update({ last_setup_error: null })
      .eq("id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin: toggle the "intentionally browser-only" flag on a member so they
 * stop appearing in install nudges + reminder lists.
 */
export const setMemberBrowserOnly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    memberId: z.string().uuid(),
    value: z.boolean(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_members")
      .update({ setup_browser_only: data.value })
      .eq("id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });