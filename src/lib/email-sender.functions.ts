import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TestInput = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200).default("JF Effect — Test email"),
  body: z.string().min(1).max(5000).default("This is a test email from the JF Effect command center."),
});

function b64url(s: string) {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TestInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // admin gate
    const { data: role } = await supabase
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!role) throw new Error("Admin only");

    const { data: settings, error: sErr } = await supabase
      .from("email_sender_settings").select("*").eq("singleton", true).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!settings) throw new Error("Email sender settings not configured");

    const from = `${settings.sender_name} <${settings.sender_email}>`;
    const replyTo = settings.reply_to_email;
    const subject = data.subject;
    const body = data.body;

    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const updateStatus = async (status: string, result: string) => {
      await supabase
        .from("email_sender_settings")
        .update({ status, last_test_at: new Date().toISOString(), last_test_result: result })
        .eq("singleton", true);
    };

    try {
      if (settings.provider === "gmail") {
        const GMAIL_KEY = process.env.GOOGLE_MAIL_API_KEY;
        if (!LOVABLE_API_KEY || !GMAIL_KEY) {
          throw new Error("Gmail connector is not linked. Open Admin → Settings → Email Sender and click 'Connect Gmail'.");
        }
        const raw = [
          `From: ${from}`,
          `To: ${data.to}`,
          `Reply-To: ${replyTo}`,
          `Subject: ${subject}`,
          `Content-Type: text/plain; charset="UTF-8"`,
          ``,
          body,
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
        const out = await res.text();
        if (!res.ok) throw new Error(`Gmail send failed (${res.status}): ${out.slice(0, 400)}`);
        await updateStatus("Connected · Gmail", "ok");
        return { ok: true, provider: "gmail" };
      }

      if (settings.provider === "resend") {
        const RESEND_KEY = process.env.RESEND_API_KEY;
        if (!LOVABLE_API_KEY || !RESEND_KEY) {
          throw new Error("Resend connector is not linked. Connect Resend, or switch the provider to Gmail.");
        }
        const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_KEY,
          },
          body: JSON.stringify({
            from,
            to: [data.to],
            reply_to: replyTo,
            subject,
            text: body,
          }),
        });
        const out = await res.text();
        if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${out.slice(0, 400)}`);
        await updateStatus("Connected · Resend", "ok");
        return { ok: true, provider: "resend" };
      }

      throw new Error(`Provider "${settings.provider}" is not wired yet. Use Gmail for now.`);
    } catch (e: any) {
      await updateStatus("Error", e?.message ?? String(e));
      throw e;
    }
  });

const PurchaseInput = z.object({ purchaseId: z.string().uuid() });

export const sendPurchaseConfirmation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PurchaseInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: p, error } = await supabase
      .from("purchase_records")
      .select("*, clients(full_name, email)")
      .eq("id", data.purchaseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error("Purchase not found");
    const clientEmail = (p as any).clients?.email;
    if (!clientEmail) throw new Error("Client has no email on file");

    const name = (p as any).clients?.full_name ?? "there";
    const amount = p.full_payable_amount ?? p.amount_due_today ?? 0;
    const subject = `Purchase confirmation — ${p.offer_name}`;
    const body = [
      `Hi ${name},`,
      ``,
      `Thanks for your purchase of "${p.offer_name}".`,
      `Amount: ${p.currency ?? "USD"} ${Number(amount).toLocaleString()}`,
      `Payment status: ${p.payment_status}`,
      ``,
      `Reply to this email with any questions.`,
      ``,
      `— Coach Jared`,
    ].join("\n");

    return await sendTestEmail({ data: { to: clientEmail, subject, body } });
  });