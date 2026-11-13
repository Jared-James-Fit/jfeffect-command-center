/**
 * Staff invite delivery: Messenger (from the admin, into the person's client
 * chat), SMS, or a link the admin copies. Server-only.
 */
import { STAFF_ROLE_INFO, staffInviteMessage, type InvitableRole } from "@/lib/staff-roles";

export function genSetupToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function appOrigin() {
  return process.env.PUBLIC_APP_URL || process.env.SITE_URL || "https://jfeffect.com";
}

export function setupPath(token: string) {
  return `/staff-setup?token=${token}`;
}

export { normalizePhone } from "@/lib/sms-policy";
import { normalizePhone } from "@/lib/sms-policy";

export type DeliveryResult = { sent: boolean; reason?: string };

/** Text the setup link. Never throws: the invite exists either way. */
export async function sendInviteSms(opts: {
  toPhone: string | null | undefined;
  firstName: string | null | undefined;
  role: InvitableRole;
  link: string;
}): Promise<DeliveryResult> {
  const toPhone = normalizePhone(opts.toPhone);
  if (!toPhone) return { sent: false, reason: "no_phone" };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms } = await import("@/lib/sms-gateway.server");
    const name = (opts.firstName || "").trim();
    const label = STAFF_ROLE_INFO[opts.role].label;
    // URL on its own line so phones render it as one tap target.
    const body = `${name ? `Hi ${name}, ` : ""}you're invited to a JF Effect team account (${label}). Tap to set it up:\n${opts.link}\n(Link expires in 7 days.)`;
    // Account access: its own switch, never stopped by the budget; the setup
    // token is redacted from the log.
    const r = await sendSms(supabaseAdmin, { category: "security", to: toPhone, body });
    if (r.status !== "sent") {
      console.warn("[staff invite SMS] not sent", r.status === "failed" ? r.error : r.reason);
      return { sent: false, reason: r.status === "failed" ? "failed" : r.reason };
    }
    return { sent: true };
  } catch (e: any) {
    console.warn("[staff invite SMS] failed", e?.message || e);
    return { sent: false, reason: "exception" };
  }
}

/**
 * Post the setup card into the person's client chat, as the admin who sent
 * it (the admin's own client, so RLS checks it), then push it like any coach
 * message. Never throws once the message is saved.
 */
export async function sendInviteInMessenger(opts: {
  adminSupabase: any;
  adminUserId: string;
  clientId: string;
  firstName: string;
  role: InvitableRole;
  email: string;
  token: string;
  expiresAt: string;
}): Promise<DeliveryResult & { messageId?: string }> {
  const info = STAFF_ROLE_INFO[opts.role];
  const now = new Date().toISOString();
  const { data: msg, error } = await opts.adminSupabase.from("messages").insert({
    client_id: opts.clientId,
    sender_id: opts.adminUserId,
    sender_role: "admin",
    body: staffInviteMessage({ firstName: opts.firstName, role: opts.role, email: opts.email }),
    attachments: [{
      type: "link",
      kind: "staff_invite",
      url: setupPath(opts.token),
      title: "Set up your team account",
      role: opts.role,
      role_label: info.label,
      staff_email: opts.email,
      expires_at: opts.expiresAt,
    }],
    message_type: "General",
    is_internal_note: false,
    read_by_admin_at: now,
  }).select("id").single();
  if (error || !msg) return { sent: false, reason: error?.message ?? "message_failed" };

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const { buildNotificationPayload, coachLabel } = await import("@/lib/push/notification-payload");
    const [{ data: c }, { data: prof }] = await Promise.all([
      supabaseAdmin.from("clients").select("user_id").eq("id", opts.clientId).maybeSingle(),
      supabaseAdmin.from("profiles").select("full_name").eq("id", opts.adminUserId).maybeSingle(),
    ]);
    if (c?.user_id) {
      const n = buildNotificationPayload({
        kind: "message",
        role: "client",
        recipientUserId: c.user_id,
        sourceId: msg.id,
        displayName: coachLabel((prof as any)?.full_name),
        attachments: [{ type: "link", kind: "staff_invite" }],
        ids: { clientId: opts.clientId },
      });
      await sendWebPushToUser(supabaseAdmin, c.user_id,
        { title: n.title, body: n.body, url: n.url, tag: n.tag, data: n.data },
        { category: n.category, eventKey: n.eventKey });
    }
  } catch (e: any) {
    console.warn("[staff invite] push failed", e?.message || e);
  }
  return { sent: true, messageId: msg.id };
}
