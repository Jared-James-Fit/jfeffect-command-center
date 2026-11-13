import { createFileRoute } from "@tanstack/react-router";

/**
 * The schedule tick (pg_cron, every 5 minutes): appointment reminders, PT
 * session evening-before texts, and the PT session -> Google Calendar sync.
 * The name is historical; the cron job already points here.
 */
export const Route = createFileRoute("/api/public/hooks/appointment-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ---------- Shared hook auth (worker secret or Vault cron secret) ----------
        if (!(await authorizeWorker(request))) return new Response("unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date().toISOString();
        const { data: due } = await supabaseAdmin
          .from("appointment_reminders")
          .select("*, appointment:appointments(*, host_coach:coaches!appointments_host_coach_id_fkey(id, full_name, phone), client:clients(id, full_name, phone))")
          .eq("status", "pending")
          .lte("scheduled_for", now)
          .limit(100);

        const { data: smsSettings } = await supabaseAdmin.from("sms_settings").select("enabled, from_phone").eq("singleton", true).maybeSingle();
        const enabled = smsSettings?.enabled !== false && !!smsSettings?.from_phone;
        const { sendSms } = await import("@/lib/sms-gateway.server");

        let sent = 0, failed = 0, skipped = 0;
        for (const r of due ?? []) {
          const appt = (r as any).appointment;
          // Never text a reminder for an appointment that has already started
          // (e.g. reminders that came due while this job was down).
          const alreadyStarted = appt?.starts_at && new Date(appt.starts_at).getTime() <= Date.now();
          if (!appt || alreadyStarted || appt.status === "Cancelled" || !appt.sms_reminders_enabled || !enabled) {
            await supabaseAdmin.from("appointment_reminders").update({ status: "skipped" }).eq("id", r.id).eq("status", "pending");
            skipped++; continue;
          }
          const toPhoneRaw = r.audience === "attendee"
            ? (appt.client?.phone || appt.external_phone)
            : appt.host_coach?.phone;
          // The key holds across overlapping runs: one text per reminder row.
          const res = await sendSms(supabaseAdmin, {
            category: r.audience === "attendee" ? "session" : "staff_alert",
            kind: "session",
            to: toPhoneRaw,
            body: buildBody(appt, r.audience),
            key: `appointment_reminder:${r.id}`,
            maxAttempts: 1,
            clientId: r.audience === "attendee" ? appt.client?.id ?? null : null,
          });
          if (res.status === "skipped" && res.reason === "duplicate") continue; // the other run owns it
          if (res.status === "sent") {
            await supabaseAdmin.from("appointment_reminders").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id);
            sent++;
          } else if (res.status === "failed") {
            await supabaseAdmin.from("appointment_reminders").update({ status: "failed", error: res.error }).eq("id", r.id);
            failed++;
          } else {
            await supabaseAdmin.from("appointment_reminders").update({ status: "skipped", error: res.reason }).eq("id", r.id);
            skipped++;
          }
        }
        // The same 5-minute tick runs the PT session side of the schedule:
        // evening-before texts, then the Google Calendar mirror. Each part is
        // independent; one failing never stops the others.
        let sessionReminders: unknown = null;
        let googleSync: unknown = null;
        try {
          const { runPtSessionReminders } = await import("@/lib/pt-session-reminders.server");
          sessionReminders = await runPtSessionReminders(supabaseAdmin as any);
        } catch (e: any) {
          sessionReminders = { error: String(e?.message ?? e) };
        }
        try {
          const { syncPtSessionsToGoogle } = await import("@/lib/pt-session-gcal.server");
          googleSync = await syncPtSessionsToGoogle(supabaseAdmin as any);
        } catch (e: any) {
          googleSync = { error: String(e?.message ?? e) };
        }
        return Response.json({ sent, failed, skipped, total: (due ?? []).length, sessionReminders, googleSync });
      },
    },
  },
});

function buildBody(appt: any, audience: "attendee" | "host"): string {
  const when = new Date(appt.starts_at).toLocaleString("en-US", {
    timeZone: appt.timezone || "America/New_York",
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const coachName = appt.host_coach?.full_name || "your coach";
  const clientName = appt.client?.full_name || appt.external_name || "your client";
  if (audience === "attendee") {
    const lines = [`Reminder: You have a ${appt.appointment_type} with ${coachName} on ${when}.`];
    if (appt.meet_link) lines.push(`Join: ${appt.meet_link}`);
    else if (appt.location) lines.push(`Location: ${appt.location}`);
    return lines.join(" ");
  }
  return `Reminder: You have a ${appt.appointment_type} with ${clientName} on ${when}.`;
}

/** Shared hook auth: worker secret (env) or the Vault-held cron secret. */
async function authorizeWorker(request: Request): Promise<boolean> {
  const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
  return authorizeHookRequest(request);
}