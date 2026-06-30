/**
 * Admin billing email notifications for Stripe webhook events.
 *
 * Sends billing event emails to both admin addresses:
 *   - jaredjamesfit@gmail.com
 *   - jaredmcintyre1998@gmail.com
 *
 * Uses the existing email provider (Gmail/Resend) configured in email_sender_settings.
 * Idempotency: uses Stripe Event ID as deduplication key via communication_log.
 * Best-effort: billing processing never fails because an email failed.
 */

const ADMIN_EMAILS = [
  "jaredjamesfit@gmail.com",
  "jaredmcintyre1998@gmail.com",
];

function b64url(s: string) {
  return Buffer.from(s, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendEmailViaProvider(
  supabaseAdmin: any,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GMAIL_KEY,
      },
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_KEY,
      },
      body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, text: body }),
    });
    if (!res.ok) throw new Error(`Resend send failed (${res.status})`);
    return;
  }

  throw new Error(`Provider ${settings.provider} not supported`);
}

/**
 * Send a billing notification email to both admin addresses.
 * Idempotent: uses stripeEventId + recipient as deduplication key.
 * Best-effort: never throws — logs failures to communication_log.
 */
export async function sendBillingAdminEmail(
  supabaseAdmin: any,
  opts: {
    stripeEventId: string;
    subject: string;
    body: string;
  },
): Promise<void> {
  for (const email of ADMIN_EMAILS) {
    const dedupeKey = `billing_notify:${opts.stripeEventId}:${email}`;

    // Check idempotency
    try {
      const { data: existing } = await supabaseAdmin
        .from("communication_log")
        .select("id")
        .eq("source", dedupeKey)
        .limit(1)
        .maybeSingle();
      if (existing) continue; // Already sent for this event + recipient
    } catch {
      // If we can't check, proceed anyway (best-effort)
    }

    try {
      await sendEmailViaProvider(supabaseAdmin, email, opts.subject, opts.body);
      try {
        await supabaseAdmin.from("communication_log").insert({
          channel: "email",
          recipient: email,
          subject: opts.subject,
          body: opts.body,
          status: "sent",
          source: dedupeKey,
        });
      } catch { /* schema variance — don't fail */ }
    } catch (e: any) {
      // Log failure but don't throw — billing processing must not fail
      console.error(`[billing-notify] Failed to send to ${email}:`, e?.message ?? e);
      try {
        await supabaseAdmin.from("communication_log").insert({
          channel: "email",
          recipient: email,
          subject: opts.subject,
          body: opts.body,
          status: "failed",
          source: dedupeKey,
          error: e?.message ?? String(e),
        });
      } catch { /* schema variance */ }
    }
  }
}

/** Format a Stripe amount (in cents) as a currency string */
function fmtAmount(cents: number | null | undefined, currency = "CAD"): string {
  if (!cents) return "—";
  return `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** Format a Unix timestamp as a readable date */
function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-CA", {
    timeZone: "America/Winnipeg",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Build a billing email body from Stripe event data */
export function buildBillingEmailBody(opts: {
  eventType: string;
  clientName?: string | null;
  clientEmail?: string | null;
  productName?: string | null;
  amountPaid?: number | null;
  amountDue?: number | null;
  taxAmount?: number | null;
  currency?: string | null;
  subscriptionStatus?: string | null;
  invoiceStatus?: string | null;
  failureReason?: string | null;
  nextRetryAt?: number | null;
  nextRenewalAt?: number | null;
  cancelAt?: number | null;
  stripeInvoiceUrl?: string | null;
  stripeCustomerId?: string | null;
  eventId?: string | null;
  eventTime?: number | null;
}): string {
  const lines: string[] = [];

  lines.push(`Event: ${opts.eventType}`);
  lines.push(`Time: ${fmtDate(opts.eventTime ?? Math.floor(Date.now() / 1000))}`);
  lines.push(``);
  lines.push(`CLIENT`);
  lines.push(`Name: ${opts.clientName ?? "—"}`);
  lines.push(`Email: ${opts.clientEmail ?? "—"}`);
  lines.push(``);
  lines.push(`BILLING`);
  lines.push(`Product: ${opts.productName ?? "—"}`);
  if (opts.amountPaid != null) lines.push(`Amount paid: ${fmtAmount(opts.amountPaid, opts.currency ?? "CAD")}`);
  if (opts.amountDue != null) lines.push(`Amount due: ${fmtAmount(opts.amountDue, opts.currency ?? "CAD")}`);
  if (opts.taxAmount != null && opts.taxAmount > 0) lines.push(`Tax: ${fmtAmount(opts.taxAmount, opts.currency ?? "CAD")}`);
  if (opts.subscriptionStatus) lines.push(`Subscription status: ${opts.subscriptionStatus}`);
  if (opts.invoiceStatus) lines.push(`Invoice status: ${opts.invoiceStatus}`);
  if (opts.failureReason) lines.push(``), lines.push(`FAILURE REASON: ${opts.failureReason}`);
  if (opts.nextRetryAt) lines.push(`Next retry: ${fmtDate(opts.nextRetryAt)}`);
  if (opts.nextRenewalAt) lines.push(`Next renewal: ${fmtDate(opts.nextRenewalAt)}`);
  if (opts.cancelAt) lines.push(`Cancels on: ${fmtDate(opts.cancelAt)}`);
  lines.push(``);
  if (opts.stripeInvoiceUrl) lines.push(`Invoice: ${opts.stripeInvoiceUrl}`);
  if (opts.stripeCustomerId) lines.push(`Stripe customer: https://dashboard.stripe.com/customers/${opts.stripeCustomerId}`);
  if (opts.eventId) lines.push(`Event ID: ${opts.eventId}`);

  return lines.join("\n");
}
