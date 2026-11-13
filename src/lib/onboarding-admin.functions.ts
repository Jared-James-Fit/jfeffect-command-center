import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assignedCoachOf, resolveCoachName } from "@/lib/sms-identity";
import { normalizePhone } from "@/lib/sms-policy";

async function assertAdmin(ctx: any) {
  const { data: isAdmin } = await ctx.supabase
    .rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!isAdmin) throw new Error("Admin required");
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
      .select("id,user_id,email,full_name,phone,sms_opt_out")
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
            let coachRow: any = null;
            if (member.user_id) {
              coachRow = await assignedCoachOf(supabaseAdmin, { userId: member.user_id });
            }
            const coach = resolveCoachName(coachRow, settings.default_coach_name);
            const body = `${first}, finish setting up your ${brand} app: ${origin}/install${coach ? ` — ${coach}` : ""}`;
            const { sendSms } = await import("@/lib/sms-gateway.server");
            const r = await sendSms(supabaseAdmin, {
              category: "manual",
              to: toPhone,
              body,
              // One setup nudge a day: a double tap never texts twice.
              key: `member_setup_sms:${member.id}:${new Date().toISOString().slice(0, 10)}`,
              memberId: member.id,
              senderUserId: context.userId,
            });
            if (r.status === "sent") {
              smsResult = { sent: true, sid: r.sid };
              anySent = true;
            } else {
              smsResult = { sent: false, reason: r.status === "failed" ? "failed" : r.reason, error: r.status === "failed" ? r.error : undefined };
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