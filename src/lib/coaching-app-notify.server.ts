/**
 * Server-only helper: notify configured admin recipients when a new
 * coaching application is submitted or a coaching call is booked.
 *
 * Texts go through the one sender (sms-gateway.server.ts) as staff alerts:
 * idempotent per event and recipient (the sender's key), counted against the
 * SMS budget. Honors recipient `paused` and `priority_only` flags.
 *
 * Email recipients are recorded in communication_log as `queued` —
 * a follow-up wires Lovable Emails templates for actual dispatch.
 */


function b64url(s: string) {
  return Buffer.from(s, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendEmailViaProvider(supabaseAdmin: any, to: string, subject: string, body: string) {
  const { data: settings } = await supabaseAdmin
    .from("email_sender_settings").select("*").eq("singleton", true).maybeSingle();
  if (!settings) throw new Error("Email sender not configured");
  const from = `${settings.sender_name} <${settings.sender_email}>`;
  const replyTo = settings.reply_to_email;
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  if (settings.provider === "gmail") {
    const GMAIL_KEY = process.env.GOOGLE_MAIL_API_KEY;
    if (!LOVABLE_API_KEY || !GMAIL_KEY) throw new Error("Gmail connector not linked");
    const raw = [
      `From: ${from}`, `To: ${to}`, `Reply-To: ${replyTo}`,
      `Subject: ${subject}`, `Content-Type: text/plain; charset="UTF-8"`, ``, body,
    ].join("\r\n");
    const res = await fetch("https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": GMAIL_KEY },
      body: JSON.stringify({ raw: b64url(raw) }),
    });
    if (!res.ok) throw new Error(`Gmail send failed (${res.status})`);
    return;
  }
  if (settings.provider === "resend") {
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!LOVABLE_API_KEY || !RESEND_KEY) throw new Error("Resend connector not linked");
    const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": RESEND_KEY },
      body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, text: body }),
    });
    if (!res.ok) throw new Error(`Resend send failed (${res.status})`);
    return;
  }
  throw new Error(`Provider ${settings.provider} not supported`);
}

/** A staff alert text through the one sender; never throws. */
async function sendStaffAlertSms(supabaseAdmin: any, to: string | null | undefined, body: string, key: string) {
  const { sendSms } = await import("@/lib/sms-gateway.server");
  return sendSms(supabaseAdmin, { category: "staff_alert", to, body, key, maxAttempts: 2 });
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
      const res = await sendStaffAlertSms(supabaseAdmin, r.phone, ctx.smsBody, `${ctx.kind}:${ctx.event_key}:${r.id}`);
      if (res.status === "sent") smsSent++;
      else smsSkipped++;
    }
    if (r[wantEmail] && r.email) {
      const dedupeKey = `${ctx.kind}:${ctx.event_key}:email:${r.id}`;
      const { data: existing } = await supabaseAdmin
        .from("communication_log").select("id")
        .eq("source", dedupeKey).limit(1).maybeSingle();
      if (existing) continue;
      try {
        await sendEmailViaProvider(supabaseAdmin, r.email, ctx.emailSubject, ctx.emailBody);
        emailQueued++;
        try {
          await supabaseAdmin.from("communication_log").insert({
            channel: "email", recipient: r.email,
            subject: ctx.emailSubject, body: ctx.emailBody,
            status: "sent", source: dedupeKey,
          });
        } catch { /* schema variance */ }
      } catch (e: any) {
        try {
          await supabaseAdmin.from("communication_log").insert({
            channel: "email", recipient: r.email,
            subject: ctx.emailSubject, body: ctx.emailBody,
            status: "failed", source: dedupeKey,
          });
        } catch { /* schema variance */ }
      }
    }
  }
  return { recipients_matched: matched.length, sms_sent: smsSent, sms_skipped: smsSkipped, email_queued: emailQueued };
}

/** Internal: one test text to a recipient (Settings → coaching-app recipients → Send test). */
export async function sendOneTestSms(supabaseAdmin: any, to: string, body: string) {
  const { sendSms, requireSent } = await import("@/lib/sms-gateway.server");
  const r = requireSent(await sendSms(supabaseAdmin, { category: "test", to, body }));
  return { sid: r.sid };
}

/** Send a confirmation email to the applicant. Idempotent via communication_log.source. */
export async function sendApplicantConfirmationEmail(
  supabaseAdmin: any,
  args: {
    to: string;
    firstName: string;
    applicationId: string;
    submittedAtStr: string;
    sourcePage: string;
    mainGoal: string;
  },
) {
  const dedupeKey = `applicant_confirmation:${args.applicationId}`;
  const { data: existing } = await supabaseAdmin
    .from("communication_log").select("id")
    .eq("source", dedupeKey).limit(1).maybeSingle();
  if (existing) return { skipped: true };

  const subject = "We received your JF Effect application";
  const body = [
    `Hi ${args.firstName},`,
    ``,
    `Thanks for applying to JF Effect coaching — your application is in.`,
    ``,
    `Submitted: ${args.submittedAtStr}`,
    `Main goal: ${args.mainGoal}`,
    `Reference #: ${args.applicationId}`,
    ``,
    `Coach Jared (or a member of the team) will personally review your answers and reach out within 24–48 hours to follow up on next steps.`,
    ``,
    `If you need to reach us in the meantime, just reply to this email.`,
    ``,
    `— Coach Jared`,
    `JF Effect`,
    `https://jfeffect.com`,
  ].join("\n");

  try {
    await sendEmailViaProvider(supabaseAdmin, args.to, subject, body);
    try {
      await supabaseAdmin.from("communication_log").insert({
        channel: "email", recipient: args.to,
        subject, body, status: "sent", source: dedupeKey,
      });
    } catch { /* schema variance */ }
    return { sent: true };
  } catch (e: any) {
    try {
      await supabaseAdmin.from("communication_log").insert({
        channel: "email", recipient: args.to,
        subject, body, status: "failed", source: dedupeKey,
      });
    } catch { /* schema variance */ }
    throw e;
  }
}

/* ─────────────────────────────────────────────────────────────
 * NEW COACHING APPLICATIONS ONLY — fixed recipient allowlist.
 *
 * Recipients come from src/lib/application-recipients.ts and are never
 * derived from users, admins, coaches, client phone numbers, or the
 * configurable recipient table. Booking alerts are untouched and keep
 * using notifyCoachingAppRecipients above.
 *
 * Every send is idempotent (sms_log.automation_trigger /
 * communication_log.source dedupe keys) and every failure is logged
 * instead of thrown, so a notification problem can never roll back a
 * saved application or CRM record.
 * ───────────────────────────────────────────────────────────── */
export async function notifyNewApplicationFixedRecipients(
  supabaseAdmin: any,
  ctx: { event_key: string; smsBody: string; emailSubject: string; emailBody: string },
) {
  const { applicationAlertRecipients } = await import("./application-recipients");
  const { emails, sms } = applicationAlertRecipients();
  const result = { sms_sent: 0, sms_skipped: 0, sms_failed: 0, email_sent: 0, email_skipped: 0, email_failed: 0 };

  for (const to of sms) {
    try {
      const res = await sendStaffAlertSms(supabaseAdmin, to, ctx.smsBody, `application_alert:${ctx.event_key}:sms:${to}`);
      if (res.status === "sent") result.sms_sent++;
      else if (res.status === "failed") { result.sms_failed++; console.warn("[application-alert] sms failed", res.error); }
      else result.sms_skipped++;
    } catch (e: any) {
      result.sms_failed++;
      console.warn("[application-alert] sms failed", e?.message ?? e);
    }
  }

  for (const to of emails) {
    const dedupeKey = `application_alert:${ctx.event_key}:email:${to}`;
    try {
      const { data: existing } = await supabaseAdmin
        .from("communication_log").select("id").eq("source", dedupeKey).limit(1).maybeSingle();
      if (existing) { result.email_skipped++; continue; }
      await sendEmailViaProvider(supabaseAdmin, to, ctx.emailSubject, ctx.emailBody);
      result.email_sent++;
      try {
        await supabaseAdmin.from("communication_log").insert({
          channel: "email", recipient: to, subject: ctx.emailSubject,
          body: ctx.emailBody, status: "sent", source: dedupeKey,
        });
      } catch { /* schema variance */ }
    } catch (e: any) {
      result.email_failed++;
      console.warn("[application-alert] email failed", to, e?.message ?? e);
      try {
        await supabaseAdmin.from("communication_log").insert({
          channel: "email", recipient: to, subject: ctx.emailSubject,
          body: ctx.emailBody, status: "failed", source: dedupeKey,
        });
      } catch { /* schema variance */ }
    }
  }

  return result;
}
