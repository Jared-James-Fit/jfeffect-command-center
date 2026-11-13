import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAssignedCoachOf, renderSmsTemplate, resolveCoachName, smsSender, withAssignedCoach } from "@/lib/sms-identity";
import { normalizePhone } from "@/lib/sms-policy";

// Every text goes through the one sender (sms-gateway.server.ts), loaded
// inside handlers so no server code reaches the client bundle.
async function gateway() {
  return import("@/lib/sms-gateway.server");
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/** Same text to the same person in the same window = one send (double taps). */
async function textKey(prefix: string, who: string, body: string, windowMinutes: number): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  const bucket = Math.floor(Date.now() / (windowMinutes * 60_000));
  return `${prefix}:${who}:${hex}:${bucket}`;
}

const renderTemplate = renderSmsTemplate;

async function assertCanMessage(supabase: any, userId: string, clientId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  if (isAdmin) return { isAdmin: true };
  if (!(await isAssignedCoachOf(supabase, userId, clientId))) throw new Error("Forbidden: not assigned to this client");
  return { isAdmin: false };
}

const SendManual = z.object({
  client_id: z.string().uuid(),
  body: z.string().trim().min(1).max(1000),
});

export const sendManualSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendManual.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertCanMessage(supabase, userId, data.client_id);

    const db = await admin();
    const { data: settings } = await db.from("sms_settings").select("rate_limit_per_hour").eq("singleton", true).maybeSingle();
    const { data: client, error: cErr } = await supabase
      .from("clients").select("id, phone, sms_opt_out").eq("id", data.client_id).maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!client) throw new Error("Client not found");
    if (client.sms_opt_out) throw new Error("This client is opted out of SMS");
    if (!normalizePhone(client.phone)) throw new Error("Client has no valid phone number on file");

    // Coach's own hourly limit per client (on top of the gateway's daily caps).
    const { count } = await db
      .from("sms_log")
      .select("id", { count: "exact", head: true })
      .eq("client_id", data.client_id)
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .eq("status", "sent");
    if ((count ?? 0) >= (settings?.rate_limit_per_hour ?? 3)) {
      throw new Error("Hourly SMS rate limit reached for this client");
    }

    const { sendSms, requireSent } = await gateway();
    const r = requireSent(await sendSms(db, {
      category: "manual",
      to: client.phone,
      body: data.body,
      key: await textKey("manual", data.client_id, data.body, 10),
      clientId: data.client_id,
      senderUserId: userId,
    }));
    return { ok: true, sid: r.sid, segments: r.segments };
  });

const UpdateSettings = z.object({
  enabled: z.boolean().optional(),
  from_phone: z.string().trim().max(40).nullable().optional(),
  admin_notify_phone: z.string().trim().max(40).nullable().optional(),
  brand_name: z.string().trim().min(1).max(80).optional(),
  default_coach_name: z.string().trim().max(40).optional(),
  manual_default_template: z.string().trim().min(1).max(1000).optional(),
  rate_limit_per_hour: z.number().int().min(1).max(20).optional(),
  reminder_steps: z.array(z.object({
    delay_minutes: z.number().int().min(1).max(60 * 24 * 14),
    enabled: z.boolean(),
    template: z.string().trim().min(1).max(1000),
  })).min(0).max(6).optional(),
  // Cost controls (Settings → SMS → Cost).
  monthly_budget_cad: z.number().min(1).max(10000).optional(),
  security_texts_enabled: z.boolean().optional(),
  client_daily_cap: z.number().int().min(1).max(20).optional(),
  price_per_segment_usd: z.number().positive().max(0.5).optional(),
  number_fee_usd: z.number().min(0).max(100).optional(),
  usd_to_cad: z.number().min(0.5).max(3).optional(),
});

export const updateSmsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSettings.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
    const patch: any = { ...data, updated_at: new Date().toISOString(), updated_by: userId };
    if (patch.from_phone !== undefined) patch.from_phone = normalizePhone(patch.from_phone);
    if (patch.admin_notify_phone !== undefined) patch.admin_notify_phone = normalizePhone(patch.admin_notify_phone);
    const { error } = await supabase.from("sms_settings").update(patch).eq("singleton", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SendTest = z.object({ to: z.string().trim().min(5).max(40) });
export const sendTestSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendTest.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
    const { data: settings } = await supabase.from("sms_settings").select("*").eq("singleton", true).maybeSingle();
    if (!settings?.from_phone) throw new Error("Set a Twilio From phone number first");
    const to = normalizePhone(data.to);
    if (!to) throw new Error("Invalid phone number");
    const body = `Test text from ${smsSender(settings.default_coach_name, settings.brand_name)}. If you got this, your setup works.`;
    const { sendSms, requireSent } = await gateway();
    const r = requireSent(await sendSms(await admin(), { category: "test", to, body, senderUserId: userId }));
    return { ok: true, sid: r.sid };
  });

export const runReminderSweepNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
    const { runReminderSweep } = await import("@/lib/sms-unread-reminders.server");
    return await runReminderSweep(await admin());
  });

const ToggleOptOut = z.object({ client_id: z.string().uuid(), sms_opt_out: z.boolean() });
export const setClientSmsOptOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ToggleOptOut.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertCanMessage(supabase, userId, data.client_id);
    const { error } = await supabase.from("clients").update({ sms_opt_out: data.sms_opt_out }).eq("id", data.client_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Bulk personal SMS — same body (template-rendered per client) to a list of clients. */
const SendBulkSchema = z.object({
  client_ids: z.array(z.string().uuid()).min(1).max(500),
  body: z.string().trim().min(1).max(1000),
  kind: z.enum(["manual", "bulk"]).optional(),
});
export const sendBulkSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendBulkSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");

    const { data: settings } = await supabase.from("sms_settings").select("*").eq("singleton", true).maybeSingle();
    if (!settings) throw new Error("SMS settings not configured");
    if (!settings.enabled) throw new Error("SMS sending is disabled in settings");
    if (!settings.from_phone) throw new Error("Set a Twilio From phone number in SMS settings first");

    const { data: clientRows, error: cErr } = await supabase
      .from("clients")
      .select("id, first_name, full_name, phone, sms_opt_out, assigned_coach_id")
      .in("id", data.client_ids);
    if (cErr) throw new Error(cErr.message);
    const clients = await withAssignedCoach(supabase, (clientRows ?? []) as any[]);

    let sent = 0, skipped = 0, failed = 0;
    const results: Array<{ client_id: string; status: string; reason?: string }> = [];
    const kind = data.kind ?? "bulk";
    const db = await admin();
    const { sendSms, smsResultMessage } = await gateway();

    for (const c of clients ?? []) {
      if (!isAdmin) {
        try { await assertCanMessage(supabase, userId, c.id); }
        catch { skipped++; results.push({ client_id: c.id, status: "skipped", reason: "forbidden" }); continue; }
      }
      if (c.sms_opt_out) { skipped++; results.push({ client_id: c.id, status: "skipped", reason: "opted_out" }); continue; }
      const toPhone = normalizePhone(c.phone);
      if (!toPhone) { skipped++; results.push({ client_id: c.id, status: "skipped", reason: "no_phone" }); continue; }

      const body = renderTemplate(data.body, {
        first_name: c.first_name ?? c.full_name?.split(" ")[0] ?? "there",
        full_name: c.full_name ?? "",
        coach: resolveCoachName((c as any).coach, settings.default_coach_name),
        brand: settings.brand_name,
      });

      const r = await sendSms(db, {
        category: kind === "bulk" ? "bulk" : "manual",
        to: toPhone,
        body,
        key: await textKey(kind, c.id, body, 24 * 60),
        clientId: c.id,
        senderUserId: userId,
      });
      if (r.status === "sent") { sent++; results.push({ client_id: c.id, status: "sent" }); }
      else if (r.status === "skipped") { skipped++; results.push({ client_id: c.id, status: "skipped", reason: smsResultMessage(r) }); }
      else { failed++; results.push({ client_id: c.id, status: "failed", reason: r.error }); }
    }
    return { sent, skipped, failed, total: (clients ?? []).length, results };
  });

/** Save (insert or update) a custom SMS automation. */
const AutomationSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60).default("Custom"),
  trigger_type: z.string().trim().min(1).max(60),
  trigger_config: z.record(z.any()).default({}),
  delay_minutes: z.number().int().min(0).max(60 * 24 * 60).default(0),
  audience_type: z.string().trim().min(1).max(60).default("all_active"),
  audience_config: z.record(z.any()).default({}),
  body: z.string().trim().min(1).max(1000),
  active: z.boolean().default(true),
  max_per_client_per_day: z.number().int().min(1).max(20).default(1),
  quiet_hours_start: z.string().default("21:00"),
  quiet_hours_end: z.string().default("08:00"),
  respect_quiet_hours: z.boolean().default(true),
  internal_note: z.string().max(500).nullable().optional(),
});
export const upsertSmsAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AutomationSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
    if (data.id) {
      const { id, ...patch } = data;
      const { error } = await supabase.from("sms_automations").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: row, error } = await supabase.from("sms_automations")
      .insert({ ...data, created_by: userId }).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, id: row?.id };
  });

const DeleteAutomation = z.object({ id: z.string().uuid() });
export const deleteSmsAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DeleteAutomation.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
    const { error } = await supabase.from("sms_automations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Send a test SMS rendering the automation body with sample template vars. */
const TestAutomation = z.object({
  to: z.string().trim().min(5).max(40),
  body: z.string().trim().min(1).max(1000),
});
export const testSmsAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TestAutomation.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
    const { data: settings } = await supabase.from("sms_settings").select("*").eq("singleton", true).maybeSingle();
    if (!settings?.from_phone) throw new Error("Set a Twilio From phone number first");
    const to = normalizePhone(data.to);
    if (!to) throw new Error("Invalid phone number");
    const rendered = renderTemplate(data.body, {
      first_name: "Alex",
      full_name: "Alex Sample",
      coach: settings.default_coach_name ?? "",
      brand: settings.brand_name ?? "",
      setup_link: `${process.env.PUBLIC_APP_URL || process.env.SITE_URL || ""}/member-setup?token=SAMPLE`,
    });
    const { sendSms, requireSent } = await gateway();
    const r = requireSent(await sendSms(await admin(), { category: "test", to, body: rendered, senderUserId: userId }));
    return { ok: true, sid: r.sid, rendered };
  });

/* ============================================================
 * Cost dashboard (Settings → SMS → Cost)
 * ============================================================ */

async function assertAdmin(supabase: any, userId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
}

/** This month's texts and cost, read through the admin's own login. */
export const getSmsCostSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase.rpc("sms_cost_summary");
    if (error) throw new Error(error.message);
    return data as any;
  });

/** Read back delivery and billing from Twilio now (instead of waiting for the 10-minute tick). */
export const refreshSmsCosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const db = await admin();
    const { pollSmsStatuses, refreshTwilioUsage } = await import("@/lib/sms-status.server");
    const statuses = await pollSmsStatuses(db, 60);
    const usage = await refreshTwilioUsage(db, { force: true });
    return { statuses, usage };
  });
