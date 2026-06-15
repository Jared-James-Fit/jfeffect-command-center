import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

function b64url(s: string) {
  return Buffer.from(s, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return "+1" + cleaned;
  return "+" + cleaned;
}

const Input = z.object({
  clientId: z.string().uuid(),
  templateName: z.string().trim().min(1).max(200).optional(),
});

/**
 * Sends an email + SMS to the admin notifying that a client is missing their
 * 1RM / Training Max. Also logs a support_alerts row so it surfaces in the
 * admin support inbox. All channels are best-effort: a failure on one does
 * not abort the others.
 */
export const notifyMissingMaxesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // Authorize: admin OR assigned coach
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) {
      const { data: ok } = await supabase.rpc("is_assigned_coach", { _client_id: data.clientId });
      if (!ok) throw new Error("Not authorized for this client");
    }

    const { data: client } = await supabase
      .from("clients").select("id, full_name").eq("id", data.clientId).maybeSingle();
    if (!client) throw new Error("Client not found");
    const clientName = client.full_name || "Unnamed client";

    const subject = `Action needed: ${clientName} missing 1RM / Training Max`;
    const bodyLines = [
      `Heads up — ${clientName} does not have a 1RM or Training Max on file yet.`,
      "",
      data.templateName
        ? `A program ("${data.templateName}") was just assigned without their maxes set.`
        : `A program was just assigned without their maxes set.`,
      "",
      `Please add their maxes so percentage-based prescriptions render correctly.`,
      "",
      `— JF Effect Command Center`,
    ];
    const body = bodyLines.join("\n");
    const channels: string[] = [];
    const errors: string[] = [];

    // Best-effort: support alert row
    try {
      await supabase.from("support_alerts").insert({
        client_id: data.clientId,
        coach_id: userId,
        error_type: "missing_client_maxes",
        error_message: subject,
        details: { template_name: data.templateName ?? null, client_name: clientName },
      });
      channels.push("inbox");
    } catch (e: any) {
      errors.push(`inbox: ${e?.message ?? e}`);
    }

    // Best-effort: email via configured sender
    try {
      const { data: emailSettings } = await supabase
        .from("email_sender_settings").select("*").eq("singleton", true).maybeSingle();
      const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
      const to = emailSettings?.reply_to_email;
      if (to && emailSettings) {
        const from = `${emailSettings.sender_name} <${emailSettings.sender_email}>`;
        if (emailSettings.provider === "gmail") {
          const GMAIL_KEY = process.env.GOOGLE_MAIL_API_KEY;
          if (LOVABLE_API_KEY && GMAIL_KEY) {
            const raw = [
              `From: ${from}`, `To: ${to}`, `Reply-To: ${to}`,
              `Subject: ${subject}`,
              `Content-Type: text/plain; charset="UTF-8"`,
              ``, body,
            ].join("\r\n");
            const res = await fetch("https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": GMAIL_KEY },
              body: JSON.stringify({ raw: b64url(raw) }),
            });
            if (!res.ok) throw new Error(`Gmail ${res.status}`);
            channels.push("email");
          } else {
            errors.push("email: Gmail connector not linked");
          }
        } else if (emailSettings.provider === "resend") {
          const RESEND_KEY = process.env.RESEND_API_KEY;
          if (LOVABLE_API_KEY && RESEND_KEY) {
            const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": RESEND_KEY },
              body: JSON.stringify({ from, to: [to], reply_to: to, subject, text: body }),
            });
            if (!res.ok) throw new Error(`Resend ${res.status}`);
            channels.push("email");
          } else {
            errors.push("email: Resend connector not linked");
          }
        }
      } else {
        errors.push("email: no admin email configured");
      }
    } catch (e: any) {
      errors.push(`email: ${e?.message ?? e}`);
    }

    // Best-effort: SMS via Twilio (requires admin_notify_phone)
    try {
      const { data: smsSettings } = await supabase
        .from("sms_settings").select("*").eq("singleton", true).maybeSingle();
      const target = normalizePhone(smsSettings?.admin_notify_phone);
      const from = normalizePhone(smsSettings?.from_phone);
      const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
      const TWILIO_API_KEY = process.env.TWILIO_API_KEY;
      if (!target) {
        errors.push("sms: set Admin Notify Phone in SMS settings");
      } else if (!from) {
        errors.push("sms: configure From Phone in SMS settings");
      } else if (!smsSettings?.enabled) {
        errors.push("sms: SMS sending disabled in settings");
      } else if (!LOVABLE_API_KEY || !TWILIO_API_KEY) {
        errors.push("sms: Twilio connector not linked");
      } else {
        const smsBody = `JF Effect: ${clientName} is missing their 1RM/Training Max. Please add it in their profile.`;
        const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": TWILIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: target, From: from, Body: smsBody }).toString(),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Twilio ${res.status}: ${t.slice(0, 200)}`);
        }
        channels.push("sms");
      }
    } catch (e: any) {
      errors.push(`sms: ${e?.message ?? e}`);
    }

    return { ok: true, channels, errors };
  });