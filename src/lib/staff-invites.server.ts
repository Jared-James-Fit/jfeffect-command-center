/**
 * Staff invite delivery: Messenger (from the admin, into the person's client
 * chat), SMS, or a link the admin copies. Server-only.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from "crypto";
import { STAFF_ROLE_INFO, staffInviteMessage, type InvitableRole } from "@/lib/staff-roles";

export function genSetupToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Only a token's hash is stored (staff_invites.setup_token_hash): a copy of
 * the table can't be turned into a working link. The link itself goes out
 * once, by the channel the admin picked; "Copy link" makes a new one.
 */
export function hashSetupToken(token: string): string {
  return createHash("sha256").update(`staff-invite:v1:${token}`).digest("hex");
}

/* ---- The emailed code: proves the invite's email is theirs before any login exists ---- */

export const INVITE_CODE_MINUTES = 15;
export const INVITE_CODE_MAX_ATTEMPTS = 5;
export const INVITE_CODE_RESEND_SECONDS = 45;

function inviteSecret(): string {
  const s = process.env.SETUP_INVITE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Invites can't be checked: no server secret configured.");
  return s;
}

export function newInviteCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function inviteCodeHash(inviteId: string, code: string): string {
  return createHmac("sha256", inviteSecret()).update(`staff-invite-code:v1:${inviteId}:${code}`).digest("hex");
}

/** What the page holds once the code was right: tied to this invite and this email. */
export function inviteEmailProof(inviteId: string, email: string): string {
  return createHmac("sha256", inviteSecret())
    .update(`staff-invite-proof:v1:${inviteId}:${email.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 40);
}

export function inviteProofOk(inviteId: string, email: string | null | undefined, proof: string | null | undefined): boolean {
  if (!email || !proof || !/^[0-9a-f]{40}$/i.test(proof)) return false;
  const want = Buffer.from(inviteEmailProof(inviteId, email), "hex");
  const got = Buffer.from(proof, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** "j***@gmail.com" */
export function maskInviteEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "your email";
  return `${user.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

/** The role's name as the invite says it: a specialist's own title, else the staff role's. */
export function inviteRoleLabel(role: string, title?: string | null): string {
  if (title && title.trim()) return title.trim();
  return (STAFF_ROLE_INFO as Record<string, { label: string } | undefined>)[role]?.label ?? "Team";
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
  role: string;
  /** a specialist's title ("Game Day Coach") */
  title?: string | null;
  link: string;
}): Promise<DeliveryResult> {
  const toPhone = normalizePhone(opts.toPhone);
  if (!toPhone) return { sent: false, reason: "no_phone" };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms } = await import("@/lib/sms-gateway.server");
    const name = (opts.firstName || "").trim();
    const label = inviteRoleLabel(opts.role, opts.title);
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
