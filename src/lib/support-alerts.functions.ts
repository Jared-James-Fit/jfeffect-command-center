import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
 * their workout. Creates a support_alerts row (idempotent within a 5-minute
 * window per client and route) and tells the coach: a push first (free), and a
 * text only to a coach the push didn't reach, at most once per client a day
 * (it used to text on every report, repeats included).
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

    // Resolve SMS sender.
    const { data: settings } = await supabaseAdmin
      .from("sms_settings").select("*").eq("singleton", true).maybeSingle();
    // Staff-only text (goes to the coach, never the client).
    const brandTag = (settings?.brand_name ?? "").trim() ? `${settings!.brand_name.trim()} app alert` : "App alert";
    const smsBody = `${brandTag}: ${clientName} couldn't load their workout plan. Open Communication > Support in the app.`;

    const notified: string[] = ["in_app"];
    const errors: string[] = [];

    {
      // Find the coach (or fall back to admins).
      let recipients: { name: string; phone: string | null; user_id: string | null }[] = [];
      if (coachId) {
        const { data: coach } = await supabaseAdmin
          .from("coaches").select("full_name, phone, user_id").eq("id", coachId).maybeSingle();
        if (coach) recipients.push({ name: coach.full_name, phone: coach.phone, user_id: coach.user_id });
      }
      if (recipients.length === 0) {
        const { data: admins } = await supabaseAdmin
          .from("user_roles").select("user_id").eq("role", "admin");
        const adminUserIds = (admins ?? []).map((a: any) => a.user_id);
        if (adminUserIds.length) {
          const { data: adminCoaches } = await supabaseAdmin
            .from("coaches").select("full_name, phone, user_id").in("user_id", adminUserIds);
          recipients = (adminCoaches ?? []).map((c: any) => ({ name: c.full_name, phone: c.phone, user_id: c.user_id }));
        }
      }

      const day = new Date().toISOString().slice(0, 10);
      const { sendWebPushToUser } = await import("@/lib/push/push.server");
      const { sendSms } = await import("@/lib/sms-gateway.server");
      for (const r of recipients) {
        let pushed = false;
        if (r.user_id) {
          const push = await sendWebPushToUser(supabaseAdmin as any, r.user_id, {
            title: "App alert",
            body: `${clientName} couldn't load their workout plan. Tap to see it and message them.`,
            url: "/admin/communication?tab=support",
            tag: `support-${clientRow?.id ?? "unknown"}`,
          }, { category: "messages", eventKey: `support_alert:${clientRow?.id ?? "unknown"}:${day}`, priority: "urgent" });
          // "dedupe" = already told today, by push.
          pushed = push.sent > 0 || push.skipped === "dedupe";
          if (push.sent > 0 && !notified.includes("push")) notified.push("push");
        }
        if (pushed || !settings?.enabled || !settings.from_phone) continue;
        const res = await sendSms(supabaseAdmin, {
          category: "staff_alert",
          to: r.phone,
          body: smsBody,
          key: `support_alert:${clientRow?.id ?? "unknown"}:${day}:${r.user_id ?? r.phone}`,
          maxAttempts: 1,
        });
        if (res.status === "sent" && !notified.includes("sms")) notified.push("sms");
        else if (res.status === "failed") errors.push(`${r.name}: ${res.error}`);
      }

      if (notified.length > 1) {
        await supabaseAdmin.from("support_alerts").update({ notified_via: notified }).eq("id", alertId);
      }
    }

    return { ok: true, alertId, notified, errors };
  });