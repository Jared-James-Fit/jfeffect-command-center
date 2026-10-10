/**
 * payment-sms.server.ts
 *
 * The one "check your app messages" text sent to a client who was sent a
 * payment link and still has not set up payment (see payment_sms_due() in the
 * database for who is due and when). Server-only: needs Twilio and the
 * service-role client.
 *
 * Deliberately never includes the payment link; it points the client at the
 * app, where the chat reminders and the link already are.
 */

export function buildPaymentSmsBody(i: { firstName?: string | null; brand?: string | null; coach?: string | null }): string {
  const first = (i.firstName ?? "").trim() || "there";
  const brand = smsSender(i.coach, i.brand);
  return `Hi ${first}, it's ${brand}. I sent you a message in the app about setting up your payment. Open your messages when you get a minute. Reply STOP to opt out.`;
}

import { CLIENT_COACH_EMBED, resolveCoachName, smsSender } from "@/lib/sms-identity";

export type PaymentSmsDeps = {
  sendSms: (toPhone: string, fromPhone: string, body: string) => Promise<{ sid: string }>;
  normalizePhone: (raw: string | null | undefined) => string | null;
};

export async function runPaymentSmsSweep(
  supabaseAdmin: any,
  deps: PaymentSmsDeps,
): Promise<{ sent: number; failed: number; skipped: number; reason?: string }> {
  const { data: settings } = await supabaseAdmin
    .from("sms_settings").select("*").eq("singleton", true).maybeSingle();
  if (!settings?.enabled || !settings.from_phone) {
    return { sent: 0, failed: 0, skipped: 0, reason: "sms_disabled_or_no_from_number" };
  }

  const { data: due, error } = await supabaseAdmin.rpc("payment_sms_due");
  if (error) throw new Error(error.message);

  let sent = 0, failed = 0, skipped = 0;
  for (const row of (due ?? []) as any[]) {
    const toPhone = deps.normalizePhone(row.o_phone);
    if (!toPhone) { skipped++; continue; }

    // Respect the same per-client hourly cap as every other text.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("sms_log")
      .select("id", { count: "exact", head: true })
      .eq("client_id", row.o_client_id)
      .gte("created_at", since)
      .eq("status", "sent");
    if ((count ?? 0) >= (settings.rate_limit_per_hour ?? 3)) { skipped++; continue; }

    // Claim first so two overlapping runs can never text the same client.
    const { data: claimed } = await supabaseAdmin.rpc("claim_payment_sms", { p_purchase_id: row.o_purchase_id });
    if (!claimed) { skipped++; continue; }

    const { data: coachOf } = await supabaseAdmin
      .from("clients").select(CLIENT_COACH_EMBED).eq("id", row.o_client_id).maybeSingle();
    const body = buildPaymentSmsBody({
      firstName: row.o_first_name,
      brand: settings.brand_name,
      coach: resolveCoachName((coachOf as any)?.coach, settings.default_coach_name),
    });
    try {
      const { sid } = await deps.sendSms(toPhone, settings.from_phone, body);
      await supabaseAdmin.from("sms_log").insert({
        client_id: row.o_client_id, to_phone: toPhone, body, kind: "automation",
        automation_trigger: "payment_setup_reminder", status: "sent", twilio_sid: sid,
      });
      sent++;
    } catch (e: any) {
      // Give the sale its slot back so a later run can retry (capped at 3 attempts).
      await supabaseAdmin.rpc("release_payment_sms", { p_purchase_id: row.o_purchase_id });
      await supabaseAdmin.from("sms_log").insert({
        client_id: row.o_client_id, to_phone: toPhone, body, kind: "automation",
        automation_trigger: "payment_setup_reminder", status: "failed", error: e?.message ?? String(e),
      });
      failed++;
    }
  }
  return { sent, failed, skipped };
}
