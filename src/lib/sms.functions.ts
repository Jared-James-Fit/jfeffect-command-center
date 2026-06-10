import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  // Assume US 10-digit if no country code
  if (/^\d{10}$/.test(cleaned)) return "+1" + cleaned;
  if (/^1\d{10}$/.test(cleaned)) return "+" + cleaned;
  return "+" + cleaned;
}

function renderTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

async function assertCanMessage(supabase: any, userId: string, clientId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  if (isAdmin) return { isAdmin: true };
  const { data: assigned } = await supabase
    .from("clients")
    .select("id, coaches!clients_assigned_coach_id_fkey(user_id)")
    .eq("id", clientId)
    .maybeSingle();
  const coachUid = (assigned as any)?.coaches?.user_id;
  if (coachUid !== userId) throw new Error("Forbidden: not assigned to this client");
  return { isAdmin: false };
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
  if (!res.ok) {
    throw new Error(data?.message || `Twilio error (${res.status})`);
  }
  return { sid: data.sid as string };
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

    const { data: settings, error: sErr } = await supabase
      .from("sms_settings").select("*").eq("singleton", true).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!settings) throw new Error("SMS settings not configured");
    if (!settings.enabled) throw new Error("SMS sending is disabled in settings");
    if (!settings.from_phone) throw new Error("Set a Twilio From phone number in SMS settings first");

    const { data: client, error: cErr } = await supabase
      .from("clients").select("id, phone, sms_opt_out, first_name, full_name").eq("id", data.client_id).maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!client) throw new Error("Client not found");
    if (client.sms_opt_out) throw new Error("This client is opted out of SMS");
    const toPhone = normalizePhone(client.phone);
    if (!toPhone) throw new Error("Client has no valid phone number on file");

    // Rate limit
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("sms_log")
      .select("id", { count: "exact", head: true })
      .eq("client_id", data.client_id)
      .gte("created_at", since)
      .eq("status", "sent");
    if ((count ?? 0) >= (settings.rate_limit_per_hour ?? 3)) {
      throw new Error("Hourly SMS rate limit reached for this client");
    }

    try {
      const { sid } = await sendViaTwilio(toPhone, settings.from_phone, data.body);
      await supabase.from("sms_log").insert({
        client_id: data.client_id,
        to_phone: toPhone,
        body: data.body,
        kind: "manual",
        status: "sent",
        twilio_sid: sid,
        sender_user_id: userId,
      });
      return { ok: true, sid };
    } catch (e: any) {
      await supabase.from("sms_log").insert({
        client_id: data.client_id,
        to_phone: toPhone,
        body: data.body,
        kind: "manual",
        status: "failed",
        error: e?.message ?? String(e),
        sender_user_id: userId,
      });
      throw e;
    }
  });

const UpdateSettings = z.object({
  enabled: z.boolean().optional(),
  from_phone: z.string().trim().max(40).nullable().optional(),
  brand_name: z.string().trim().min(1).max(80).optional(),
  manual_default_template: z.string().trim().min(1).max(1000).optional(),
  rate_limit_per_hour: z.number().int().min(1).max(20).optional(),
  reminder_steps: z.array(z.object({
    delay_minutes: z.number().int().min(1).max(60 * 24 * 14),
    enabled: z.boolean(),
    template: z.string().trim().min(1).max(1000),
  })).min(0).max(6).optional(),
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
    const body = `Test SMS from ${settings.brand_name}. If you got this, your setup works.`;
    const { sid } = await sendViaTwilio(to, settings.from_phone, body);
    return { ok: true, sid };
  });

/** Core reminder engine — usable by both manual "run now" and cron. */
export async function runReminderSweep(supabaseAdmin: any) {
  const { data: settings } = await supabaseAdmin.from("sms_settings").select("*").eq("singleton", true).maybeSingle();
  if (!settings?.enabled || !settings.from_phone) return { processed: 0, reason: "disabled_or_no_from" };
  const steps: Array<{ delay_minutes: number; enabled: boolean; template: string }> = Array.isArray(settings.reminder_steps) ? settings.reminder_steps : [];
  const enabledSteps = steps.map((s, i) => ({ ...s, index: i })).filter((s) => s.enabled);
  if (enabledSteps.length === 0) return { processed: 0, reason: "no_steps" };

  const now = Date.now();
  // Look back 30 days max
  const lookback = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await supabaseAdmin
    .from("messages")
    .select("id, client_id, created_at, sender_role, is_internal_note, read_by_client_at, body")
    .eq("sender_role", "admin")
    .eq("is_internal_note", false)
    .is("read_by_client_at", null)
    .gte("created_at", lookback)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);

  let processed = 0;
  for (const msg of candidates ?? []) {
    const ageMin = (now - new Date(msg.created_at).getTime()) / 60000;
    // Find highest eligible step (sorted ascending by delay)
    const sorted = [...enabledSteps].sort((a, b) => a.delay_minutes - b.delay_minutes);
    const due = sorted.filter((s) => ageMin >= s.delay_minutes);
    if (due.length === 0) continue;

    // Existing sent steps for this message
    const { data: priorLogs } = await supabaseAdmin
      .from("sms_log")
      .select("reminder_step, status")
      .eq("message_id", msg.id)
      .eq("kind", "reminder");
    const doneSteps = new Set((priorLogs ?? []).filter((l: any) => l.status === "sent" || l.status === "skipped").map((l: any) => l.reminder_step));
    const next = due.find((s) => !doneSteps.has(s.index));
    if (!next) continue;

    // Get client
    const { data: client } = await supabaseAdmin
      .from("clients").select("id, phone, sms_opt_out, first_name, full_name").eq("id", msg.client_id).maybeSingle();
    if (!client) continue;
    if (client.sms_opt_out) {
      await supabaseAdmin.from("sms_log").insert({
        client_id: msg.client_id, message_id: msg.id, to_phone: "", body: "", kind: "reminder",
        reminder_step: next.index, status: "skipped", error: "client_opted_out",
      });
      continue;
    }
    const toPhone = normalizePhone(client.phone);
    if (!toPhone) {
      await supabaseAdmin.from("sms_log").insert({
        client_id: msg.client_id, message_id: msg.id, to_phone: "", body: "", kind: "reminder",
        reminder_step: next.index, status: "skipped", error: "no_phone",
      });
      continue;
    }

    // Rate limit
    const since = new Date(now - 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("sms_log")
      .select("id", { count: "exact", head: true })
      .eq("client_id", msg.client_id)
      .gte("created_at", since)
      .eq("status", "sent");
    if ((count ?? 0) >= (settings.rate_limit_per_hour ?? 3)) continue;

    const body = renderTemplate(next.template, {
      first_name: client.first_name ?? client.full_name?.split(" ")[0] ?? "there",
      full_name: client.full_name ?? "",
      brand: settings.brand_name,
    });

    try {
      const { sid } = await sendViaTwilio(toPhone, settings.from_phone, body);
      await supabaseAdmin.from("sms_log").insert({
        client_id: msg.client_id, message_id: msg.id, to_phone: toPhone, body, kind: "reminder",
        reminder_step: next.index, status: "sent", twilio_sid: sid,
      });
      processed++;
    } catch (e: any) {
      await supabaseAdmin.from("sms_log").insert({
        client_id: msg.client_id, message_id: msg.id, to_phone: toPhone, body, kind: "reminder",
        reminder_step: next.index, status: "failed", error: e?.message ?? String(e),
      });
    }
  }
  return { processed };
}

export const runReminderSweepNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return await runReminderSweep(supabaseAdmin);
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

    const { data: clients, error: cErr } = await supabase
      .from("clients")
      .select("id, first_name, full_name, phone, sms_opt_out")
      .in("id", data.client_ids);
    if (cErr) throw new Error(cErr.message);

    let sent = 0, skipped = 0, failed = 0;
    const results: Array<{ client_id: string; status: string; reason?: string }> = [];
    const kind = data.kind ?? "bulk";

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
        brand: settings.brand_name,
      });

      try {
        const { sid } = await sendViaTwilio(toPhone, settings.from_phone, body);
        await supabase.from("sms_log").insert({
          client_id: c.id, to_phone: toPhone, body, kind,
          status: "sent", twilio_sid: sid, sender_user_id: userId,
        });
        sent++; results.push({ client_id: c.id, status: "sent" });
      } catch (e: any) {
        await supabase.from("sms_log").insert({
          client_id: c.id, to_phone: toPhone, body, kind,
          status: "failed", error: e?.message ?? String(e), sender_user_id: userId,
        });
        failed++; results.push({ client_id: c.id, status: "failed", reason: e?.message });
      }
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