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

        const { data: smsSettings } = await supabaseAdmin.from("sms_settings").select("*").eq("singleton", true).maybeSingle();
        const fromPhone = smsSettings?.from_phone;
        const enabled = smsSettings?.enabled !== false;

        let sent = 0, failed = 0, skipped = 0;
        for (const r of due ?? []) {
          const appt = (r as any).appointment;
          // Never text a reminder for an appointment that has already started
          // (e.g. reminders that came due while this job was down).
          const alreadyStarted = appt?.starts_at && new Date(appt.starts_at).getTime() <= Date.now();
          if (!appt || alreadyStarted || appt.status === "Cancelled" || !appt.sms_reminders_enabled || !enabled || !fromPhone) {
            await supabaseAdmin.from("appointment_reminders").update({ status: "skipped" }).eq("id", r.id);
            skipped++; continue;
          }
          const toPhoneRaw = r.audience === "attendee"
            ? (appt.client?.phone || appt.external_phone)
            : appt.host_coach?.phone;
          const toPhone = normalizePhone(toPhoneRaw);
          if (!toPhone) {
            await supabaseAdmin.from("appointment_reminders").update({ status: "skipped" }).eq("id", r.id);
            skipped++; continue;
          }
          const body = buildBody(appt, r.audience);
          try {
            await sendSms(toPhone, fromPhone, body);
            await supabaseAdmin.from("appointment_reminders").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id);
            sent++;
          } catch (e: any) {
            await supabaseAdmin.from("appointment_reminders").update({ status: "failed", error: String(e?.message ?? e) }).eq("id", r.id);
            failed++;
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

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return "+1" + cleaned;
  if (/^1\d{10}$/.test(cleaned)) return "+" + cleaned;
  return "+" + cleaned;
}

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

async function sendSms(to: string, from: string, body: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  if (!lovableKey || !twilioKey) throw new Error("Twilio not configured");
  const res = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Twilio ${res.status}: ${t.slice(0, 200)}`);
  }
}

/** Shared hook auth: worker secret (env) or the Vault-held cron secret. */
async function authorizeWorker(request: Request): Promise<boolean> {
  const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
  return authorizeHookRequest(request);
}