// Server only: setting a client's login up (the coach's Send invite, the setup page, a purchase on
// the site). Moved out of clients.functions.ts (Nov 25 2026) because an export there that reached
// these pulled setup-invite.server.ts (Node's crypto) into the browser build, which then failed.
import type { Database } from "@/integrations/supabase/types";
import { setupInviteUrl } from "@/lib/setup-invite";

type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

// SECURITY: Refuse to operate on any auth user that holds a staff role
// (admin, coach, finance, media manager). Without this guard, a client record
// that happens to share an email with a staff login (anyone can apply with any
// email) would let setup / reset / password operations overwrite that login's
// credentials or attach a client record to it. The login is found exactly by
// email (auth_user_id_for_email), never by paging through every login.
export async function assertNotPrivilegedTarget(opts: { email?: string | null; userId?: string | null }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { STAFF_ROLES, loginForEmail } = await import("@/lib/account-recovery-lookup.server");
  const targetIds = new Set<string>();
  if (opts.userId) targetIds.add(opts.userId);
  if (opts.email) {
    const matchId = await loginForEmail(supabaseAdmin as any, opts.email);
    if (matchId) targetIds.add(matchId);
  }
  if (targetIds.size === 0) return;
  const { data: roles, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("user_id", Array.from(targetIds))
    .in("role", [...STAFF_ROLES] as any);
  if (error) throw new Error(error.message);
  if (roles && roles.length > 0) {
    throw new Error(
      "Refusing to send/generate a credential link: the target email is associated with a team account. Use a different email for this client record.",
    );
  }
}

/**
 * The client's email already has a login nobody linked: they made a free
 * account before the coach invited them (member_free_join answered
 * "coach_account" and made nothing). Link it to this record, but first give it
 * a random password, so only whoever opens the email we send next can get in:
 * whoever typed the email at sign-up may not own it. Returns the login's id,
 * or null when there's nothing to claim (no login, or it's already someone's
 * athlete record).
 */
export async function claimUnlinkedLogin(client: { id: string; email: string }): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const email = client.email.trim().toLowerCase();
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`));
  if (error) throw new Error(error.message);
  const login = (profiles ?? []).find((p: any) => String(p.email ?? "").trim().toLowerCase() === email);
  if (!login) return null;
  const { data: owned } = await supabaseAdmin.from("clients").select("id").eq("user_id", login.id).limit(1);
  if (owned && owned.length) return null;
  const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { error: pErr } = await supabaseAdmin.auth.admin.updateUserById(login.id, { password: secret });
  if (pErr) throw new Error(pErr.message);
  const { error: lErr } = await supabaseAdmin
    .from("clients")
    .update({ user_id: login.id, account_status: "Invite Sent" } as ClientUpdate)
    .eq("id", client.id)
    .is("user_id", null);
  if (lErr) throw new Error(lErr.message);
  return login.id;
}

export type SetupEmailClient = {
  id: string;
  email: string;
  full_name: string | null;
  user_id: string | null;
  invite_sent_at: string | null;
};

/** The /setup page every setup link opens, carrying the client's invite (setup-invite.ts). */
export async function setupPageFor(clientId: string, setupPage: string): Promise<string> {
  const { signSetupInvite } = await import("@/lib/setup-invite.server");
  return setupInviteUrl(setupPage, signSetupInvite(clientId));
}

export async function appSetupPage(): Promise<string> {
  const { appOrigin } = await import("@/lib/pt-session-gcal.server");
  return `${appOrigin()}/setup`;
}

/**
 * Send the setup email to the client's email on file: an invite for a new
 * login (re-sent while it's unconfirmed), else a set-password email, linking a
 * login they made themselves first. Stamps when it went out. `selfEntered`
 * marks an email the client typed on the invite page: it can't sign anyone in
 * until its code or link proves it's theirs (`emailUnverified`).
 */
export async function sendSetupEmailFor(
  client: SetupEmailClient,
  redirectTo: string | undefined,
  opts: { selfEntered?: boolean } = {},
) {
  await assertNotPrivilegedTarget({ email: client.email, userId: client.user_id });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: invited, error: inviteErr } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(client.email, {
      redirectTo,
      data: { full_name: client.full_name, ...(opts.selfEntered ? { setup_self_entered_email: true } : {}) },
    });

  const now = new Date().toISOString();
  if (inviteErr) {
    // If user already exists, fall back to a password recovery email.
    // A login they made themselves before this invite is linked first.
    if (!client.user_id) await claimUnlinkedLogin({ id: client.id, email: client.email });
    // resetPasswordForEmail actually SENDS the email (admin.generateLink does not).
    const { error: resetErr } = await supabaseAdmin.auth.resetPasswordForEmail(
      client.email,
      { redirectTo },
    );
    if (resetErr) throw new Error(resetErr.message);
    const patch: ClientUpdate = {
      invite_last_resent_at: now,
      invite_expires_at: null,
      account_status: client.user_id ? "Password Reset Sent" : "Invite Sent",
    };
    if (!client.invite_sent_at) patch.invite_sent_at = now;
    await supabaseAdmin.from("clients").update(patch).eq("id", client.id);
    return { ok: true, resent: true, actionLink: null };
  }

  const patch: ClientUpdate = {
    invite_last_resent_at: now,
    invite_expires_at: null,
    account_status: "Invite Sent",
  };
  if (!client.invite_sent_at) patch.invite_sent_at = now;
  await supabaseAdmin.from("clients").update(patch).eq("id", client.id);
  if (invited.user) {
    await supabaseAdmin.from("clients").update({ user_id: invited.user.id } as ClientUpdate).eq("id", client.id).is("user_id", null);
  }
  return { ok: true, resent: false };
}

/**
 * Server-only (never a server function): the same setup email the coach's Send
 * invite sends, for a client who just bought coaching on the site
 * (coaching-sales/onboarding.server.ts). Only the inbox owner can open it.
 */
export async function sendClientSetupEmail(clientId: string): Promise<{ sent: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, email, full_name, user_id, invite_sent_at")
    .eq("id", clientId)
    .maybeSingle();
  if (!client?.email || client.user_id) return { sent: false };
  const redirectTo = await setupPageFor(client.id, await appSetupPage());
  await sendSetupEmailFor(client as SetupEmailClient, redirectTo);
  return { sent: true };
}
