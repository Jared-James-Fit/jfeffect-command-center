import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/appointment-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ---------- Worker secret guard ----------
        const expected = process.env.SCHEDULED_WORKER_SECRET ?? "";
        const url = new URL(request.url);
        const provided =
          request.headers.get("x-worker-secret") ??
          url.searchParams.get("secret") ??
          "";
        if (
          !expected ||
          !provided ||
          provided.length !== expected.length ||
          !timingSafeEqualStr(provided, expected)
        ) {
          return new Response("unauthorized", { status: 401 });
        }

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
          if (!appt || appt.status === "Cancelled" || !appt.sms_reminders_enabled || !enabled || !fromPhone) {
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
        return Response.json({ sent, failed, skipped, total: (due ?? []).length });
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

/** Constant-time string compare. Strings must already be the same length. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}