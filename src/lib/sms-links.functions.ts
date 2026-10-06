import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { mintShareLinkForPurchase } from "@/lib/payment-share.server";
import { sanitizeShareUrl } from "@/lib/payment-share-link";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotPrivilegedTarget } from "@/lib/privileged-target.server";

/* ============================================================
 * Shared helpers (duplicated from sms.functions.ts to keep this
 * file self-contained and avoid leaking server-only code via
 * cross-imports between .functions.ts files).
 * ============================================================ */

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

async function sendViaTwilio(toPhone: string, fromPhone: string, body: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");
  if (!twilioKey) throw new Error("TWILIO_API_KEY missing — connect Twilio in Integrations");
  const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: toPhone, From: fromPhone, Body: body }).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Twilio error (${res.status})`);
  return { sid: data.sid as string };
}

async function loadSmsSettings(supabase: any) {
  const { data, error } = await supabase
    .from("sms_settings").select("*").eq("singleton", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("SMS settings not configured");
  if (!data.enabled) throw new Error("SMS sending is disabled in settings");
  if (!data.from_phone) throw new Error("Set a Twilio From phone number in SMS settings first");
  return data;
}

async function loadClientForSms(supabase: any, clientId: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("id, email, phone, sms_opt_out, first_name, full_name, user_id, assigned_coach_id, last_signed_in_at")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Client not found");
  if (data.sms_opt_out) throw new Error("This client is opted out of SMS");
  const toPhone = normalizePhone(data.phone);
  if (!toPhone) throw new Error("Client has no valid phone number on file");
  return { client: data, toPhone };
}

async function assertAdminOrAssignedCoach(supabase: any, userId: string, clientId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  if (isAdmin) return { isAdmin: true };
  const { data: assigned } = await supabase
    .from("clients")
    .select("id, coaches!clients_assigned_coach_id_fkey(user_id)")
    .eq("id", clientId)
    .maybeSingle();
  const coachUid = (assigned as any)?.coaches?.user_id;
  if (coachUid !== userId) throw new Error("Forbidden: not assigned to this client");
  return { isAdmin: false };
}

async function logSmsSend(supabase: any, opts: {
  clientId: string; toPhone: string; body: string; kind: "manual" | "bulk" | "automation";
  status: "sent" | "failed"; twilio_sid?: string; error?: string; userId: string;
}) {
  await supabase.from("sms_log").insert({
    client_id: opts.clientId,
    to_phone: opts.toPhone,
    body: opts.body,
    kind: opts.kind,
    status: opts.status,
    twilio_sid: opts.twilio_sid ?? null,
    error: opts.error ?? null,
    sender_user_id: opts.userId,
  });
}

/* ============================================================
 * Auth link generation (server-side, no email)
 * ============================================================ */

type LinkKind = "setup" | "magic" | "reset";

async function generateAuthLink(opts: {
  clientEmail: string;
  clientUserId: string | null;
  kind: LinkKind;
  redirectTo: string;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let supabaseType: "invite" | "magiclink" | "recovery";
  if (opts.kind === "reset") supabaseType = "recovery";
  else if (opts.kind === "magic") supabaseType = "magiclink";
  else supabaseType = opts.clientUserId ? "magiclink" : "invite";

  const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
    type: supabaseType as any,
    email: opts.clientEmail,
    options: { redirectTo: opts.redirectTo },
  });
  if (error) throw new Error(error.message);
  const hashedToken = (link as any)?.properties?.hashed_token as string | undefined;
  if (!hashedToken) throw new Error("Could not generate link token");
  const url = new URL(opts.redirectTo);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", supabaseType);
  return url.toString();
}

/* ============================================================
 * 1. Send setup / magic / reset link by SMS
 * ============================================================ */

const SendLinkSchema = z.object({
  clientId: z.string().uuid(),
  redirectTo: z.string().url(),
  kind: z.enum(["setup", "magic", "reset"]),
});

export const sendAuthLinkBySms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendLinkSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdminOrAssignedCoach(supabase, userId, data.clientId);
    const settings = await loadSmsSettings(supabase);
    const { client, toPhone } = await loadClientForSms(supabase, data.clientId);
    if (!client.email) throw new Error("Client has no email on file (required to mint link)");
    // Same guard as the email and copy paths: never text a sign-in link for a staff account.
    await assertNotPrivilegedTarget({ email: client.email, userId: client.user_id ?? null });

    const url = await generateAuthLink({
      clientEmail: client.email,
      clientUserId: client.user_id ?? null,
      kind: data.kind,
      redirectTo: data.redirectTo,
    });

    const first = client.first_name ?? client.full_name?.split(" ")[0] ?? "there";
    const brand = settings.brand_name ?? "Coaching";
    const label =
      data.kind === "reset" ? "reset your password"
      : data.kind === "magic" ? "sign in to your coaching app"
      : "finish setting up your coaching account";
    const body = `Hi ${first}, this is ${brand}. Tap to ${label}: ${url}\n\nThe link is single-use and expires soon. Reply STOP to opt out.`;

    try {
      const { sid } = await sendViaTwilio(toPhone, settings.from_phone, body);
      await logSmsSend(supabase, { clientId: data.clientId, toPhone, body, kind: "manual", status: "sent", twilio_sid: sid, userId });
      // Stamp client status
      const patch: any = {};
      if (data.kind === "setup") {
        patch.invite_sent_at = new Date().toISOString();
        patch.invite_last_resent_at = new Date().toISOString();
        patch.invite_expires_at = null;
        // Waiting on the client until they actually sign in.
        if (!client.last_signed_in_at) patch.account_status = "Invite Sent";
      }
      if (data.kind === "reset") {
        patch.password_reset_sent_at = new Date().toISOString();
        patch.invite_expires_at = null;
        patch.account_status = "Password Reset Sent";
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from("clients").update(patch).eq("id", data.clientId);
      }
      // The texted link, so the coach can copy the same one (minting another would cancel it).
      return { ok: true, sid, url };
    } catch (e: any) {
      await logSmsSend(supabase, { clientId: data.clientId, toPhone, body, kind: "manual", status: "failed", error: e?.message ?? String(e), userId });
      throw e;
    }
  });

/* ============================================================
 * 2. Send Stripe payment link by SMS
 * ============================================================ */

const SendPaymentSmsSchema = z.object({
  purchaseId: z.string().uuid(),
});

export const sendPaymentLinkBySms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendPaymentSmsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: rec, error } = await supabase
      .from("purchase_records")
      .select("id, client_id, stripe_payment_link, offer_name, full_payable_amount, currency, payment_structure, payment_status")
      .eq("id", data.purchaseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rec) throw new Error("Purchase not found");
    await assertAdminOrAssignedCoach(supabase, userId, rec.client_id);
    const shareLink = await mintShareLinkForPurchase(supabase, userId, rec.id, "https://jfeffect.com");
    const shareUrl = sanitizeShareUrl(shareLink.shareUrl);
    if (!shareUrl) throw new Error(shareLink.reason ?? "No valid Stripe payment link for this purchase yet.");
    const settings = await loadSmsSettings(supabase);
    const { client, toPhone } = await loadClientForSms(supabase, rec.client_id);

    const first = client.first_name ?? client.full_name?.split(" ")[0] ?? "there";
    const brand = settings.brand_name ?? "Coaching";
    const amount = `${rec.currency ?? "USD"} ${Number(rec.full_payable_amount ?? 0).toLocaleString()}`;
    const body = `Hi ${first}, this is ${brand}. Your payment link for ${rec.offer_name} (${amount}) is ready: ${shareUrl}\n\nReply STOP to opt out.`;

    try {
      const { sid } = await sendViaTwilio(toPhone, settings.from_phone, body);
      await logSmsSend(supabase, { clientId: rec.client_id, toPhone, body, kind: "manual", status: "sent", twilio_sid: sid, userId });
      return { ok: true, sid };
    } catch (e: any) {
      await logSmsSend(supabase, { clientId: rec.client_id, toPhone, body, kind: "manual", status: "failed", error: e?.message ?? String(e), userId });
      throw e;
    }
  });

/* ============================================================
 * 3. Post payment request as a chat card (DM or group)
 * ============================================================ */

const PostPaymentSchema = z.object({
  purchaseId: z.string().uuid(),
  target: z.enum(["dm", "group"]),
  groupId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});

async function buildPaymentAttachment(rec: any, shareUrl: string) {
  return {
    type: "link" as const,
    kind: "payment_request" as const,
    url: shareUrl,
    payment_url: shareUrl,
    name: `Payment: ${rec.offer_name ?? "Coaching"}`,
    title: rec.offer_name ?? "Coaching",
    amount_cents: Math.round(Number(rec.full_payable_amount ?? 0) * 100),
    currency: (rec.currency ?? "USD"),
    payment_structure: rec.payment_structure ?? undefined,
    purchase_id: rec.id as string,
    status: rec.payment_status ?? "Pending",
  };
}

export const postPaymentRequestInChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PostPaymentSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: rec, error } = await supabase
      .from("purchase_records")
      .select("id, client_id, stripe_payment_link, offer_name, full_payable_amount, currency, payment_structure, payment_status")
      .eq("id", data.purchaseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rec) throw new Error("Purchase not found");
    await assertAdminOrAssignedCoach(supabase, userId, rec.client_id);
    const shareLink = await mintShareLinkForPurchase(supabase, userId, rec.id, "https://jfeffect.com");
    const shareUrl = sanitizeShareUrl(shareLink.shareUrl);
    if (!shareUrl) throw new Error(shareLink.reason ?? "No valid Stripe payment link for this purchase yet.");

    const attachment = await buildPaymentAttachment(rec, shareUrl);
    const body = data.note?.trim() || `Payment request for ${rec.offer_name}. Tap to complete payment.`;

    if (data.target === "dm") {
      const { error: insErr } = await supabase.from("messages").insert({
        client_id: rec.client_id,
        sender_id: userId,
        sender_role: "admin",
        body,
        attachments: [attachment],
        message_type: "Payment",
      });
      if (insErr) throw new Error(insErr.message);
      return { ok: true, posted: "dm" };
    }

    if (!data.groupId) throw new Error("groupId is required for group posts");
    // Sender role must be the user's actual role on the group, but admin/coach
    // generally pass policy checks via is_coach_or_admin.
    const { error: gErr } = await supabase.from("group_messages").insert({
      group_id: data.groupId,
      sender_id: userId,
      sender_role: "admin",
      body,
      attachments: [attachment],
    });
    if (gErr) throw new Error(gErr.message);
    return { ok: true, posted: "group" };
  });
/* ============================================================
 * 4. Auto-message when a product is assigned
 * ============================================================
 * Posted in the client's chat FROM whoever set the product up (admin or
 * coach) with a personal note + the payment card. Idempotent per purchase:
 * if this sale's payment card is already in the chat it is not re-sent.
 */

const AutoSendSchema = z.object({ purchaseId: z.string().uuid() });

export const autoSendPaymentRequestMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AutoSendSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: rec, error } = await supabase
      .from("purchase_records")
      .select("id, client_id, offer_name, full_payable_amount, currency, payment_structure, payment_frequency, is_recurring, payment_status")
      .eq("id", data.purchaseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rec) throw new Error("Purchase not found");
    await assertAdminOrAssignedCoach(supabase, userId, rec.client_id);
    if (/^(paid|draft|cancel)/i.test(String(rec.payment_status ?? ""))) {
      return { sent: false, reason: "not_pending" as const };
    }

    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("client_id", rec.client_id)
      .contains("attachments", [{ kind: "payment_request", purchase_id: rec.id }])
      .limit(1);
    if ((existing ?? []).length) return { sent: false, reason: "already_sent" as const };

    const shareLink = await mintShareLinkForPurchase(supabase, userId, rec.id, "https://jfeffect.com");
    const shareUrl = sanitizeShareUrl(shareLink.shareUrl);
    if (!shareUrl) return { sent: false, reason: "no_link" as const };

    const { data: client } = await supabase
      .from("clients")
      .select("preferred_name, first_name, full_name")
      .eq("id", rec.client_id)
      .maybeSingle();
    const { buildPaymentRequestMessage } = await import("@/lib/payment-request-message");
    const body = buildPaymentRequestMessage({
      clientFirstName: client?.preferred_name || client?.first_name || client?.full_name || null,
      offerName: rec.offer_name,
      amount: rec.full_payable_amount,
      currency: rec.currency,
      paymentStructure: rec.payment_structure,
      paymentFrequency: rec.payment_frequency,
      isRecurring: rec.is_recurring,
      url: shareUrl,
    });
    const attachment = await buildPaymentAttachment(rec, shareUrl);
    const { data: msg, error: insErr } = await supabase
      .from("messages")
      .insert({
        client_id: rec.client_id,
        sender_id: userId,
        sender_role: "admin",
        body,
        attachments: [attachment],
        message_type: "Payment",
        read_by_admin_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    return { sent: true, messageId: msg.id as string };
  });
