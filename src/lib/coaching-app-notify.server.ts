/**
 * Server-only helper: notify configured admin recipients when a new
 * coaching application is submitted or a coaching call is booked.
 *
 * Reuses the existing Twilio gateway integration. Honors recipient
 * `paused` and `priority_only` flags. Idempotency is enforced by
 * dedupe-keying each send in sms_log.automation_trigger.
 *
 * Email recipients are recorded in communication_log as `queued` —
 * a follow-up wires Lovable Emails templates for actual dispatch.
 */

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

async function sendTwilioSms(to: string, from: string, body: string) {
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
  if (!res.ok) throw new Error(data?.message || `Twilio error (${res.status})`);
  return { sid: data.sid as string };
}

type NotifyContext = {
  kind: "coaching_app_submit" | "coaching_app_booked";
  event_key: string;
  priority: boolean;
  smsBody: string;
  emailSubject: string;
  emailBody: string;
};

export async function notifyCoachingAppRecipients(supabaseAdmin: any, ctx: NotifyContext) {
  const { data: smsSettings } = await supabaseAdmin
    .from("sms_settings").select("enabled, from_phone").eq("singleton", true).maybeSingle();

  const wantSms = ctx.kind === "coaching_app_submit" ? "receive_application_sms" : "receive_booking_sms";
  const wantEmail = ctx.kind === "coaching_app_submit" ? "receive_application_email" : "receive_booking_email";

  const { data: recipients } = await supabaseAdmin
    .from("coaching_app_notification_recipients")
    .select("*").eq("paused", false);

  const matched = (recipients ?? []).filter((r: any) => {
    if (r.priority_only && !ctx.priority) return false;
    return r[wantSms] || r[wantEmail];
  });

  let smsSent = 0, smsSkipped = 0, emailQueued = 0;

  for (const r of matched) {
    if (r[wantSms] && smsSettings?.enabled && smsSettings?.from_phone) {
      const toPhone = normalizePhone(r.phone);
      if (!toPhone) { smsSkipped++; continue; }
      const dedupeKey = `${ctx.kind}:${ctx.event_key}:${r.id}`;
      const { data: existing } = await supabaseAdmin
        .from("sms_log").select("id")
        .eq("automation_trigger", dedupeKey).limit(1).maybeSingle();
      if (existing) { smsSkipped++; continue; }
      try {
        const { sid } = await sendTwilioSms(toPhone, smsSettings.from_phone, ctx.smsBody);
        await supabaseAdmin.from("sms_log").insert({
          to_phone: toPhone, body: ctx.smsBody, kind: "admin_alert",
          automation_trigger: dedupeKey, status: "sent", twilio_sid: sid,
        });
        smsSent++;
      } catch (e: any) {
        await supabaseAdmin.from("sms_log").insert({
          to_phone: toPhone, body: ctx.smsBody, kind: "admin_alert",
          automation_trigger: dedupeKey, status: "failed",
          error: e?.message ?? String(e),
        });
      }
    }
    if (r[wantEmail] && r.email) {
      emailQueued++;
      try {
        await supabaseAdmin.from("communication_log").insert({
          channel: "email", recipient: r.email,
          subject: ctx.emailSubject, body: ctx.emailBody,
          status: "queued", source: ctx.kind,
        });
      } catch { /* schema variance — best-effort */ }
    }
  }
  return { recipients_matched: matched.length, sms_sent: smsSent, sms_skipped: smsSkipped, email_queued: emailQueued };
}

/** Internal: send one Twilio SMS without going through the recipient loop. Used by send-test. */
export async function sendOneTwilioSms(to: string, from: string, body: string) {
  return sendTwilioSms(to, from, body);
}
