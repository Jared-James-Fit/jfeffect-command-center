/**
 * Server-only pieces of free membership by application (membership-apply.ts):
 * who an email already belongs to, sending the approval / code emails, and
 * the one push the coach gets for a new application. Load inside handlers.
 */
import { firstNameFrom, goalLabelOf } from "@/lib/membership-apply";
import { maskEmail } from "@/lib/setup-invite";

export const APPLICATION_COLUMNS =
  "id, created_at, updated_at, full_name, email, instagram, phone, goal, experience, coaching_interest, contact_method, status, flagged, contact_status, contacted_at, admin_notes, decided_at, invite_sent_at, invite_count, activated_at, client_id, existing_account, source_page, referrer, utm_source, utm_campaign, is_test";

export async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export async function publicOrigin(): Promise<string> {
  const { appOrigin } = await import("@/lib/pt-session-gcal.server");
  return appOrigin();
}

/** What an email already is in JF Effect. */
export type AccountState =
  /** nothing: an approval makes them a new login */
  | { kind: "none" }
  /** a team login: never made a member */
  | { kind: "staff"; loginId: string }
  /** already an athlete (a member or a coaching client) with a login: they just sign in */
  | { kind: "athlete"; loginId: string; clientId: string }
  /** a coach set them up and they haven't signed in: their coach's setup link is the way in */
  | { kind: "coach_record"; clientId: string }
  /** a login with no athlete record (an old sign-up): activation finishes it */
  | { kind: "orphan_login"; loginId: string };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function accountFor(sb: any, rawEmail: string): Promise<AccountState> {
  const email = rawEmail.trim().toLowerCase();
  const { data: profiles, error } = await sb.from("profiles").select("id, email").ilike("email", escapeLike(email));
  if (error) throw new Error(error.message);
  const login = ((profiles ?? []) as any[]).find((p) => String(p.email ?? "").trim().toLowerCase() === email) ?? null;
  if (login) {
    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", login.id).in("role", ["admin", "coach", "finance"]);
    if ((roles ?? []).length) return { kind: "staff", loginId: login.id };
    const { data: client } = await sb.from("clients").select("id").eq("user_id", login.id).limit(1).maybeSingle();
    if (client?.id) return { kind: "athlete", loginId: login.id, clientId: client.id };
  }
  // A record a coach made (anything but a coaching application nobody took on) owns the email.
  const { data: records } = await sb
    .from("clients")
    .select("id, status, assigned_coach_id, archived")
    .eq("normalized_email", email)
    .is("user_id", null)
    .limit(5);
  const coachMade = ((records ?? []) as any[]).find((c) => !c.archived && !(c.status === "Lead" && !c.assigned_coach_id));
  if (coachMade) return { kind: "coach_record", clientId: coachMade.id };
  return login ? { kind: "orphan_login", loginId: login.id } : { kind: "none" };
}

/** The link the coach can DM or text (no email proof on it: whoever opens it confirms the email with a code). */
export async function activationLink(applicationId: string): Promise<string> {
  const { signActivation } = await import("@/lib/membership-activation.server");
  return `${await publicOrigin()}/activate?a=${encodeURIComponent(signActivation(applicationId))}`;
}

/** The emailed link: the same, plus the proof that opening the email gives. */
export async function emailedActivationLink(applicationId: string, email: string): Promise<string> {
  const { emailProof } = await import("@/lib/membership-activation.server");
  return `${await activationLink(applicationId)}&k=${emailProof(applicationId, email)}`;
}

/** Send (or re-send) the approval email. `round` makes each resend its own email. */
export async function sendApprovalEmail(
  sb: any,
  app: { id: string; email: string; full_name: string },
  opts: { round: number; note?: string | null },
) {
  const { sendTemplateEmail } = await import("@/lib/transactional-email.server");
  return sendTemplateEmail(sb, {
    template: "membership-approved",
    to: app.email,
    data: {
      first_name: firstNameFrom(app.full_name),
      activate_url: await emailedActivationLink(app.id, app.email),
      note: opts.note?.trim() || undefined,
    },
    idempotencyKey: `membership_approved:${app.id}:${opts.round}`,
    sensitive: true,
  });
}

const CONTACT_LINE: Record<string, string> = {
  instagram: "I might send you a quick DM on Instagram first to say hi and hear about your goals.",
  text: "I might send you a quick text first to say hi and hear about your goals.",
  email: "I might reply to this email first to say hi and hear about your goals.",
};

export async function sendReceivedEmail(
  sb: any,
  app: { id: string; email: string; full_name: string; contact_method: string; coaching_interest: string | null },
  bookingUrl: string | null,
) {
  const { sendTemplateEmail } = await import("@/lib/transactional-email.server");
  return sendTemplateEmail(sb, {
    template: "membership-received",
    to: app.email,
    data: {
      first_name: firstNameFrom(app.full_name),
      contact_line: CONTACT_LINE[app.contact_method] ?? CONTACT_LINE.email,
      coaching: app.coaching_interest === "yes",
      booking_url: bookingUrl ?? undefined,
    },
    idempotencyKey: `membership_received:${app.id}`,
  });
}

export async function sendCodeEmail(sb: any, app: { email: string; full_name: string }, code: string) {
  const { sendTemplateEmail } = await import("@/lib/transactional-email.server");
  return sendTemplateEmail(sb, {
    template: "membership-code",
    to: app.email,
    data: { first_name: firstNameFrom(app.full_name), code },
    sensitive: true,
  });
}

/**
 * One push to each admin for a new application. Content-free on the
 * lockscreen apart from who, and a burst collapses into one (30 minutes per
 * admin): the list and the badges carry the rest. Never throws.
 */
export async function pushNewApplication(sb: any, app: { id: string; full_name: string; goal: string }) {
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const { safeDisplayName } = await import("@/lib/push/notification-payload");
    const { data: admins } = await sb.from("user_roles").select("user_id").eq("role", "admin");
    const name = safeDisplayName(app.full_name, "Someone");
    for (const a of (admins ?? []) as any[]) {
      if (!a.user_id) continue;
      await sendWebPushToUser(
        sb,
        a.user_id,
        {
          title: `New member application: ${name}`,
          body: "Tap to read it, say hi, or approve them.",
          url: `/admin/leads?tab=members&app=${app.id}`,
          tag: "member_application",
          data: { kind: "member_application", sourceId: app.id },
        },
        {
          category: "coaching_apps",
          eventKey: `member_application:${app.id}:${a.user_id}`,
          rateKey: "member_application",
          rateWindowMinutes: 30,
          priority: "normal",
        },
      );
    }
  } catch (e) {
    console.warn("[member-application] push failed", e);
  }
}

/** "Build muscle" for an email or a push, never their words. */
export const goalWords = (goal: string) => goalLabelOf(goal).toLowerCase();

export { maskEmail };
