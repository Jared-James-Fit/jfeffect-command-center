import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return "+1" + cleaned;
  if (/^1\d{10}$/.test(cleaned)) return "+" + cleaned;
  return "+" + cleaned;
}

async function sendSms(to: string, from: string, body: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  if (!lovableKey || !twilioKey) throw new Error("Twilio not configured");
  const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Twilio error ${res.status}`);
  return data.sid as string;
}

const NotifyInput = z.object({
  client_id: z.string().uuid().nullable().optional(),
  workout_id: z.string().nullable().optional(),
  workout_date: z.string().nullable().optional(),
  page_route: z.string().nullable().optional(),
  error_type: z.string().default("workout_load_failure"),
  error_message: z.string().nullable().optional(),
  device_info: z.record(z.any()).nullable().optional(),
  details: z.record(z.any()).nullable().optional(),
});

/**
 * Notify the assigned coach (or admin fallback) that a client could not load
 * their workout. Creates a support_alerts row + sends SMS via the existing
 * Twilio connector. Idempotent within a 5-minute window per (client, route).
 */
export const notifyCoachOfWorkoutFailure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => NotifyInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve client. If not passed, look up by current user.
    let clientRow: any = null;
    if (data.client_id) {
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("id, full_name, first_name, assigned_coach_id")
        .eq("id", data.client_id)
        .maybeSingle();
      clientRow = c;
    } else {
      const { data: c } = await supabase
        .from("clients")
        .select("id, full_name, first_name, assigned_coach_id")
        .eq("user_id", userId)
        .maybeSingle();
      clientRow = c;
    }

    const coachId = clientRow?.assigned_coach_id ?? null;

    // Idempotency: don't double-create the same alert within 5 minutes.
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("support_alerts")
      .select("id, notified_via")
      .eq("client_id", clientRow?.id ?? null)
      .eq("error_type", data.error_type)
      .eq("page_route", data.page_route ?? "")
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();

    let alertId: string | null = recent?.id ?? null;

    if (!alertId) {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("support_alerts")
        .insert({
          client_id: clientRow?.id ?? null,
          coach_id: coachId,
          workout_id: data.workout_id ?? null,
          workout_date: data.workout_date ?? null,
          page_route: data.page_route ?? null,
          error_type: data.error_type,
          error_message: data.error_message ?? null,
          device_info: data.device_info ?? null,
          details: data.details ?? null,
          status: "open",
          notified_via: ["in_app"],
        })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      alertId = inserted.id;
    }

    // Build SMS body.
    const clientName = clientRow?.full_name || clientRow?.first_name || "A client";
    const smsBody = `App emergency: ${clientName} could not load their workout plan. Please contact them and check the workout logger issue.`;

    // Resolve SMS sender.
    const { data: settings } = await supabaseAdmin
      .from("sms_settings").select("*").eq("singleton", true).maybeSingle();

    const notified: string[] = ["in_app"];
    const errors: string[] = [];

    if (settings?.enabled && settings.from_phone && process.env.TWILIO_API_KEY && process.env.LOVABLE_API_KEY) {
      // Find coach phone (or fall back to admin phones).
      let recipients: { name: string; phone: string | null }[] = [];
      if (coachId) {
        const { data: coach } = await supabaseAdmin
          .from("coaches").select("full_name, phone").eq("id", coachId).maybeSingle();
        if (coach?.phone) recipients.push({ name: coach.full_name, phone: coach.phone });
      }
      if (recipients.length === 0) {
        // Admin fallback: find users with admin role that have a phone on their coach record.
        const { data: admins } = await supabaseAdmin
          .from("user_roles").select("user_id").eq("role", "admin");
        const adminUserIds = (admins ?? []).map((a: any) => a.user_id);
        if (adminUserIds.length) {
          const { data: adminCoaches } = await supabaseAdmin
            .from("coaches").select("full_name, phone").in("user_id", adminUserIds);
          recipients = (adminCoaches ?? [])
            .filter((c: any) => !!c.phone)
            .map((c: any) => ({ name: c.full_name, phone: c.phone }));
        }
      }

      for (const r of recipients) {
        const to = normalizePhone(r.phone);
        if (!to) continue;
        try {
          await sendSms(to, settings.from_phone, smsBody);
          if (!notified.includes("sms")) notified.push("sms");
        } catch (e: any) {
          errors.push(`${r.name}: ${e?.message ?? String(e)}`);
        }
      }

      if (notified.includes("sms")) {
        await supabaseAdmin.from("support_alerts").update({ notified_via: notified }).eq("id", alertId);
      }
    }

    return { ok: true, alertId, notified, errors };
  });