import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function b64url(s: string) {
  return Buffer.from(s, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

    // Best-effort: a staff alert text (needs Admin notify phone in SMS
    // settings), through the one sender: once per client a day, budget-capped.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: smsSettings } = await supabaseAdmin
        .from("sms_settings").select("admin_notify_phone").eq("singleton", true).maybeSingle();
      if (!smsSettings?.admin_notify_phone) {
        errors.push("sms: set Admin Notify Phone in SMS settings");
      } else {
        const { sendSms, smsResultMessage } = await import("@/lib/sms-gateway.server");
        const r = await sendSms(supabaseAdmin, {
          category: "staff_alert",
          to: smsSettings.admin_notify_phone,
          body: `JF Effect: ${clientName} is missing their 1RM/Training Max. Please add it in their profile.`,
          key: `missing_maxes:${data.clientId}:${new Date().toISOString().slice(0, 10)}`,
          maxAttempts: 1,
        });
        if (r.status === "sent") channels.push("sms");
        else errors.push(`sms: ${smsResultMessage(r)}`);
      }
    } catch (e: any) {
      errors.push(`sms: ${e?.message ?? e}`);
    }

    return { ok: true, channels, errors };
  });