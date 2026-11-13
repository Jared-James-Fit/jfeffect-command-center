import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { mintShareLinkForPurchase } from "@/lib/payment-share.server";
import { sanitizeShareUrl } from "@/lib/payment-share-link";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPermission } from "@/lib/permissions.server";
import { coachById, isAssignedCoachOf, resolveCoachName, smsSender } from "@/lib/sms-identity";
import { SETUP_INVITE_DAYS, setupInviteUrl } from "@/lib/setup-invite";

import { normalizePhone } from "@/lib/sms-policy";

/* Every text goes through the one sender (sms-gateway.server.ts), loaded inside
 * handlers so no server code reaches the client bundle. */
async function sendThroughGateway(req: import("@/lib/sms-gateway.server").SmsRequest) {
  const [{ sendSms, requireSent }, { supabaseAdmin }] = await Promise.all([
    import("@/lib/sms-gateway.server"),
    import("@/integrations/supabase/client.server"),
  ]);
  const r = requireSent(await sendSms(supabaseAdmin, req));
  return r;
}

/**
 * Who the text is from, plus a clear error before anything is built. Read as
 * the server: sms_settings is admin-only, and a coach texting their own client
 * a setup link still needs the brand. Account-security texts follow their own
 * switch, not the master switch.
 */
async function loadSmsSettings(_supabase: any, purpose: "security" | "manual" = "manual") {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("sms_settings").select("*").eq("singleton", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("SMS settings not configured");
  if (purpose === "security" ? data.security_texts_enabled === false : !data.enabled) {
    throw new Error(purpose === "security" ? "Account texts are switched off in SMS settings" : "SMS sending is disabled in settings");
  }
  if (!data.from_phone) throw new Error("Set a Twilio From phone number in SMS settings first");
  return data;
}

async function loadClientForSms(supabase: any, clientId: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("id, email, phone, sms_opt_out, first_name, preferred_name, full_name, user_id, assigned_coach_id, archived, status")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Client not found");
  if (data.sms_opt_out) throw new Error("This client is opted out of SMS");
  const toPhone = normalizePhone(data.phone);
  if (!toPhone) throw new Error("Client has no valid phone number on file");
  const coach = await coachById(supabase, data.assigned_coach_id);
  return { client: { ...data, coach }, toPhone };
}

/**
 * A payments.request login (finance) sends payment links for existing
 * purchases with the service client. Admins and coaches return null and keep
 * their own client and checks.
 */
async function paymentRequestClient(context: any): Promise<any | null> {
  const { data: roles } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
  if ((roles ?? []).some((r: any) => r.role === "admin" || r.role === "coach")) return null;
  try {
    await assertPermission(context, "payments.request");
  } catch {
    return null;
  }
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function assertAdminOrAssignedCoach(supabase: any, userId: string, clientId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  if (isAdmin) return { isAdmin: true };
  if (!(await isAssignedCoachOf(supabase, userId, clientId))) throw new Error("Forbidden: not assigned to this client");
  return { isAdmin: false };
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
    const settings = await loadSmsSettings(supabase, "security");
    const { client, toPhone } = await loadClientForSms(supabase, data.clientId);
    let url: string;
    if (data.kind === "setup") {
      // The client's setup link (setup-invite.ts): works for SETUP_INVITE_DAYS until they've
      // signed in, with or without an email on file.
      const { signSetupInvite } = await import("@/lib/setup-invite.server");
      url = setupInviteUrl(data.redirectTo, signSetupInvite(client.id));
    } else if (client.email) {
      url = await generateAuthLink({
        clientEmail: client.email,
        clientUserId: client.user_id ?? null,
        kind: data.kind,
        redirectTo: data.redirectTo,
      });
    } else {
      throw new Error("Client has no email on file. Add one first, or text them a setup link.");
    }

    const first = client.preferred_name || client.first_name || client.full_name?.split(" ")[0] || "there";
    const brand = smsSender(resolveCoachName((client as any).coach, settings.default_coach_name), settings.brand_name);
    const label =
      data.kind === "reset" ? "reset your password"
      : data.kind === "magic" ? "sign in to your coaching app"
      : "set up your coaching app";
    const expiry = data.kind === "setup" ? `The link works for ${SETUP_INVITE_DAYS} days.` : "The link is single-use and expires soon.";
    const body = `Hi ${first}, this is ${brand}. Tap to ${label}: ${url}\n\n${expiry} Reply STOP to opt out.`;

    // Account security: never stopped by the budget, and the link (a sign-in
    // token) is redacted from the log.
    const r = await sendThroughGateway({
      category: "security",
      to: toPhone,
      body,
      clientId: data.clientId,
      senderUserId: userId,
    });
    // Stamp client status
    const patch: any = {};
    if (data.kind === "setup") {
      patch.invite_sent_at = new Date().toISOString();
      patch.invite_last_resent_at = new Date().toISOString();
      patch.invite_expires_at = null;
      patch.account_status = client.user_id ? "Account Created" : "Invite Sent";
    }
    if (data.kind === "reset") {
      patch.password_reset_sent_at = new Date().toISOString();
      patch.invite_expires_at = null;
      patch.account_status = "Password Reset Sent";
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from("clients").update(patch).eq("id", data.clientId);
    }
    return { ok: true, sid: r.sid };
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
    const { userId } = context as any;
    const financeDb = await paymentRequestClient(context);
    const supabase = financeDb ?? (context as any).supabase;
    const { data: rec, error } = await supabase
      .from("purchase_records")
      .select("id, client_id, stripe_payment_link, offer_name, full_payable_amount, currency, payment_structure, payment_status")
      .eq("id", data.purchaseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rec) throw new Error("Purchase not found");
    if (!financeDb) await assertAdminOrAssignedCoach(supabase, userId, rec.client_id);
    const shareLink = await mintShareLinkForPurchase(supabase, userId, rec.id, "https://jfeffect.com");
    const shareUrl = sanitizeShareUrl(shareLink.shareUrl);
    if (!shareUrl) throw new Error(shareLink.reason ?? "No valid Stripe payment link for this purchase yet.");
    const settings = await loadSmsSettings(supabase);
    const { client, toPhone } = await loadClientForSms(supabase, rec.client_id);

    const first = client.first_name ?? client.full_name?.split(" ")[0] ?? "there";
    const brand = smsSender(resolveCoachName((client as any).coach, settings.default_coach_name), settings.brand_name);
    const amount = `${rec.currency ?? "USD"} ${Number(rec.full_payable_amount ?? 0).toLocaleString()}`;
    const body = `Hi ${first}, this is ${brand}. Your payment link for ${rec.offer_name} (${amount}) is ready: ${shareUrl}\n\nReply STOP to opt out.`;

    const r = await sendThroughGateway({
      category: "manual",
      to: toPhone,
      body,
      // One text per sale a day: a double tap never texts the link twice.
      key: `payment_link_sms:${rec.id}:${new Date().toISOString().slice(0, 10)}`,
      maxAttempts: 3,
      clientId: rec.client_id,
      senderUserId: userId,
    });
    return { ok: true, sid: r.sid };
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
  const { paymentRequestAttachment } = await import("@/lib/payment-request-message");
  return paymentRequestAttachment(rec, shareUrl);
}

export const postPaymentRequestInChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PostPaymentSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const financeDb = await paymentRequestClient(context);
    const supabase = financeDb ?? (context as any).supabase;
    const { data: rec, error } = await supabase
      .from("purchase_records")
      .select("id, client_id, stripe_payment_link, offer_name, full_payable_amount, currency, payment_structure, payment_status")
      .eq("id", data.purchaseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rec) throw new Error("Purchase not found");
    if (!financeDb) await assertAdminOrAssignedCoach(supabase, userId, rec.client_id);
    // Finance posts in the client's own chat only, never into a group (member
    // chats are private to their members; see AGENTS.md).
    if (financeDb && data.target !== "dm") throw new Error("Payment requests from the finance login go in the client's own chat.");
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
