import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Admin required");
}

const RecipientSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  receive_application_sms: z.boolean().default(false),
  receive_booking_sms: z.boolean().default(false),
  receive_application_email: z.boolean().default(false),
  receive_booking_email: z.boolean().default(false),
  priority_only: z.boolean().default(false),
  paused: z.boolean().default(false),
});

function normalizePhoneForStore(p?: string | null): string | null {
  if (!p) return null;
  const c = String(p).replace(/[^\d+]/g, "");
  if (!c) return null;
  if (c.startsWith("+")) return c;
  if (/^\d{10}$/.test(c)) return "+1" + c;
  if (/^1\d{10}$/.test(c)) return "+" + c;
  return "+" + c;
}

export const listCoachingAppRecipients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("coaching_app_notification_recipients")
      .select("*").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { recipients: data ?? [] };
  });

export const upsertCoachingAppRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RecipientSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload: any = {
      ...data,
      email: data.email ? data.email.trim().toLowerCase() : null,
      phone: normalizePhoneForStore(data.phone ?? null),
    };
    delete payload.id;
    if (data.id) {
      const { error } = await supabaseAdmin
        .from("coaching_app_notification_recipients")
        .update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await supabaseAdmin
      .from("coaching_app_notification_recipients")
      .insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const deleteCoachingAppRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("coaching_app_notification_recipients")
      .delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendCoachingAppRecipientTestSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendOneTwilioSms } = await import("./coaching-app-notify.server");
    const { data: r } = await supabaseAdmin
      .from("coaching_app_notification_recipients")
      .select("*").eq("id", data.id).maybeSingle();
    if (!r) throw new Error("Recipient not found");
    if (!r.phone) throw new Error("Recipient has no phone");
    const { data: smsSettings } = await supabaseAdmin
      .from("sms_settings").select("enabled, from_phone").eq("singleton", true).maybeSingle();
    if (!smsSettings?.enabled || !smsSettings?.from_phone)
      throw new Error("SMS is disabled or no from-number set in SMS settings");
    const body = `JF Effect test alert for ${r.name}. Coaching application notifications are reaching this phone.`;
    const { sid } = await sendOneTwilioSms(r.phone, smsSettings.from_phone, body);
    await supabaseAdmin.from("sms_log").insert({
      to_phone: r.phone, body, kind: "admin_alert",
      automation_trigger: `recipient_test:${r.id}:${Date.now()}`,
      status: "sent", twilio_sid: sid,
    });
    await supabaseAdmin.from("coaching_app_notification_recipients")
      .update({ phone_verified_at: new Date().toISOString() }).eq("id", r.id);
    return { ok: true, sid };
  });
