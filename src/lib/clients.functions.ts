import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { cleanInviteEmail, maskEmail, setupInviteState, setupInviteUrl, type SetupInviteState } from "@/lib/setup-invite";

type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

// SECURITY: Refuse to operate on any auth user that holds a privileged role
// (admin or coach). Without this guard, a client record that happens to share
// an email with an admin/coach — or whose user_id was auto-linked to one —
// would let setup / reset / password operations silently overwrite the
// admin's credentials.
async function assertNotPrivilegedTarget(opts: { email?: string | null; userId?: string | null }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const targetIds = new Set<string>();
  if (opts.userId) targetIds.add(opts.userId);
  if (opts.email) {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers();
    const match = list.users.find(
      (u: any) => (u.email || "").toLowerCase() === opts.email!.toLowerCase(),
    );
    if (match) targetIds.add(match.id);
  }
  if (targetIds.size === 0) return;
  const { data: roles, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("user_id", Array.from(targetIds))
    .in("role", ["admin", "coach"]);
  if (error) throw new Error(error.message);
  if (roles && roles.length > 0) {
    throw new Error(
      "Refusing to send/generate a credential link: the target email is associated with an admin or coach account. Use a different email for this client record.",
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
async function claimUnlinkedLogin(client: { id: string; email: string }): Promise<string | null> {
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

type SetupEmailClient = {
  id: string;
  email: string;
  full_name: string | null;
  user_id: string | null;
  invite_sent_at: string | null;
};

/** The /setup page every setup link opens, carrying the client's invite (setup-invite.ts). */
async function setupPageFor(clientId: string, setupPage: string): Promise<string> {
  const { signSetupInvite } = await import("@/lib/setup-invite.server");
  return setupInviteUrl(setupPage, signSetupInvite(clientId));
}

async function appSetupPage(): Promise<string> {
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
async function sendSetupEmailFor(
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
 * A one-time sign-in for the client's email on file, for the setup page to
 * exchange right away: an invite for a new login, a magic link for an
 * existing one, or a set-password link for a login they made themselves.
 */
async function mintSetupToken(client: { id: string; email: string; user_id: string | null }) {
  await assertNotPrivilegedTarget({ email: client.email, userId: client.user_id });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const redirectTo = await appSetupPage();
  let type: "invite" | "magiclink" | "recovery" = client.user_id ? "magiclink" : "invite";
  let { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
    type: type as any,
    email: client.email,
    options: { redirectTo },
  });
  if (error && type === "invite") {
    // A login with this email already exists: link one they made themselves, then sign in.
    await claimUnlinkedLogin({ id: client.id, email: client.email });
    type = "magiclink";
    ({ data: link, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: client.email, options: { redirectTo } }));
  }
  if (error) throw new Error(error.message);
  const tokenHash = (link as any)?.properties?.hashed_token as string | undefined;
  if (!tokenHash) throw new Error("Could not start your setup. Try again.");
  const userId = (link as any)?.user?.id as string | undefined;
  if (userId) {
    await supabaseAdmin.from("clients").update({ user_id: userId } as ClientUpdate).eq("id", client.id).is("user_id", null);
  }
  return { tokenHash, type };
}

export const inviteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        redirectTo: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: client, error: cErr } = await supabase
      .from("clients")
      .select("id, email, full_name, user_id, account_status, invite_sent_at")
      .eq("id", data.clientId)
      .single();
    if (cErr) throw new Error(cErr.message);
    if (!client?.email) throw new Error("No email on file. Text or copy the setup link instead: they add their email when they open it.");

    // The email's link carries the invite too, so it still works once its own token has expired.
    const redirectTo = data.redirectTo ? await setupPageFor(client.id, data.redirectTo) : undefined;
    return sendSetupEmailFor(client as SetupEmailClient, redirectTo);
  });

// The client's setup link, for copy-to-clipboard: the same link a text sends.
export const getSetupLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), redirectTo: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: client, error } = await supabase
      .from("clients").select("id, email, user_id, invite_sent_at").eq("id", data.clientId).single();
    if (error) throw new Error(error.message);
    // Say so now if the email belongs to staff, not when the client opens the link.
    if (client.email) await assertNotPrivilegedTarget({ email: client.email, userId: client.user_id });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const patch: ClientUpdate = { invite_last_resent_at: now, invite_expires_at: null };
    if (!client.invite_sent_at) patch.invite_sent_at = now;
    if (!client.user_id) patch.account_status = "Invite Sent";
    await supabaseAdmin.from("clients").update(patch).eq("id", client.id);
    return { url: await setupPageFor(client.id, data.redirectTo), asksForEmail: !client.email };
  });

/* ============================================================
 * The setup page (setup-invite.ts): public, the signed invite is the only
 * key. A coach-entered email signs in with one tap; an email the client typed
 * signs in only with the code (or link) we email to it.
 * ============================================================ */

const InviteTokenSchema = z.object({ token: z.string().min(10).max(120) });
const CodeSchema = z.string().trim().regex(/^\d{6,10}$/, "Enter the code from the email.");

async function clientForInvite(token: string) {
  const { verifySetupInvite } = await import("@/lib/setup-invite.server");
  const clientId = verifySetupInvite(token);
  if (!clientId) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, email, first_name, preferred_name, full_name, user_id, archived, status, portal_access_disabled, last_signed_in_at, invite_sent_at")
    .eq("id", clientId)
    .maybeSingle();
  return data as any;
}

/** The client's login is one made from an email they typed here and haven't proven yet. */
async function emailUnverified(client: { user_id?: string | null } | null): Promise<boolean> {
  if (!client?.user_id) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.admin.getUserById(client.user_id);
  const u = data?.user as any;
  return !!u && !u.email_confirmed_at && u.user_metadata?.setup_self_entered_email === true;
}

async function inviteView(token: string) {
  const client = await clientForInvite(token);
  const view = setupInviteState(client, { emailUnverified: await emailUnverified(client) });
  return { client, view };
}

const TAKEN = "That email already has a JF Effect account. Ask your coach to connect it.";

/** An email typed on the setup page: valid and not on any login or other client yet. */
async function newEmailFor(clientId: string, raw: string | undefined): Promise<string> {
  const typed = cleanInviteEmail(raw);
  if (!typed) throw new Error("Enter a valid email address.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: otherClient, error: ocErr } = await supabaseAdmin
    .from("clients").select("id").eq("normalized_email", typed).neq("id", clientId).limit(1);
  if (ocErr) throw new Error(ocErr.message);
  if (otherClient?.length) throw new Error(TAKEN);
  const { data: logins, error: lgErr } = await supabaseAdmin
    .from("profiles").select("id, email").ilike("email", typed.replace(/[\\%_]/g, (c) => `\\${c}`));
  if (lgErr) throw new Error(lgErr.message);
  if ((logins ?? []).some((p: any) => String(p.email ?? "").trim().toLowerCase() === typed)) throw new Error(TAKEN);
  return typed;
}

/** Save a typed email on a record with none and email its code. */
async function sendCodeToNewEmail(client: any, typed: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Only while the record still has no email: a coach who just added one wins.
  let save = supabaseAdmin.from("clients").update({ email: typed } as ClientUpdate).eq("id", client.id);
  save = client.email === null ? save.is("email", null) : save.eq("email", client.email);
  const { data: saved, error } = await save.select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!saved) throw new Error("Your coach just updated your account. Open the link again.");
  const setupPage = await setupPageFor(client.id, await appSetupPage());
  await sendSetupEmailFor(
    { id: client.id, email: typed, full_name: client.full_name ?? null, user_id: null, invite_sent_at: client.invite_sent_at ?? null },
    setupPage,
    { selfEntered: true },
  );
}

function refuse(view: SetupInviteState): never {
  if (view.state === "signed_in_before") throw new Error("You already have an account. Sign in, or tap Forgot password.");
  throw new Error("This setup link doesn't work anymore. Ask your coach for a new one.");
}

/** What the setup page shows: their first name, the step they're on and, when there's one on file, a masked email. */
export const peekSetupInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InviteTokenSchema.parse(input))
  .handler(async ({ data }): Promise<SetupInviteState> => (await inviteView(data.token)).view);

export type SetupStartResult =
  | { kind: "session"; tokenHash: string; type: "invite" | "magiclink" | "recovery" }
  | { kind: "code"; sentTo: string | null };

/**
 * Continue from the setup page: a coach-entered email signs in now (the page
 * exchanges the token); a typed email (step "email") or one waiting on its
 * code (step "code", a resend) gets the code emailed.
 */
export const startSetupFromInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    InviteTokenSchema.extend({ email: z.string().max(254).optional() }).parse(input),
  )
  .handler(async ({ data }): Promise<SetupStartResult> => {
    const { client, view } = await inviteView(data.token);
    if (view.state !== "ok") refuse(view);
    if (view.step === "continue") {
      return { kind: "session", ...(await mintSetupToken({ id: client.id, email: client.email, user_id: client.user_id ?? null })) };
    }
    if (view.step === "email") {
      const typed = await newEmailFor(client.id, data.email);
      await sendCodeToNewEmail(client, typed);
      return { kind: "code", sentTo: maskEmail(typed) };
    }
    // step "code": send it again (re-invites the unconfirmed login).
    await sendSetupEmailFor(
      { id: client.id, email: client.email, full_name: client.full_name ?? null, user_id: client.user_id ?? null, invite_sent_at: client.invite_sent_at ?? null },
      await setupPageFor(client.id, await appSetupPage()),
      { selfEntered: true },
    );
    return { kind: "code", sentTo: maskEmail(client.email) };
  });

/** The code from the email: proves the email is theirs and signs them in. */
export const verifySetupCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InviteTokenSchema.extend({ code: CodeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { client, view } = await inviteView(data.token);
    if (view.state !== "ok") refuse(view);
    if (view.step !== "code" || !client.email) throw new Error("Open the link again to continue.");
    const { createClient } = await import("@supabase/supabase-js");
    // The same project and public key the app's own sign-in uses (integrations/supabase/client.ts).
    const url = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anon) throw new Error("Sign-in isn't available right now. Tap the button in the email instead.");
    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }).auth;
    // An invite code, or a set-password code when the invite fell back to one (sendSetupEmailFor).
    for (const type of ["invite", "recovery"] as const) {
      const { data: v } = await auth.verifyOtp({ email: client.email, token: data.code, type });
      if (v?.session) {
        return { accessToken: v.session.access_token, refreshToken: v.session.refresh_token };
      }
    }
    throw new Error("That code didn't work. Check it, or tap Send a new code.");
  });

/** A typo: drop the unproven email (and the login made for it) and send the code to another. */
export const changeSetupEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InviteTokenSchema.extend({ email: z.string().max(254) }).parse(input))
  .handler(async ({ data }): Promise<SetupStartResult> => {
    const { client, view } = await inviteView(data.token);
    if (view.state !== "ok") refuse(view);
    if (view.step !== "code") throw new Error("Open the link again to continue.");
    const typed = await newEmailFor(client.id, data.email);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const oldUser = client.user_id as string;
    const { data: cleared, error } = await supabaseAdmin
      .from("clients")
      .update({ email: null, user_id: null } as ClientUpdate)
      .eq("id", client.id)
      .eq("user_id", oldUser)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!cleared) throw new Error("Your coach just updated your account. Open the link again.");
    // The login was never confirmed and holds nothing: best effort, it can't sign in either way.
    await supabaseAdmin.auth.admin.deleteUser(oldUser).catch(() => {});
    await sendCodeToNewEmail({ ...client, email: null, user_id: null }, typed);
    return { kind: "code", sentTo: maskEmail(typed) };
  });

/**
 * "This link has expired": send a fresh setup email to a client who hasn't
 * signed in yet, or a password reset to anyone else. Always the same answer,
 * so it never says whether an email is on an account.
 */
export const requestNewSetupLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ email: z.string().max(254) }).parse(input))
  .handler(async ({ data }) => {
    const email = cleanInviteEmail(data.email);
    if (!email) throw new Error("Enter a valid email address.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const { data: rows } = await supabaseAdmin
        .from("clients")
        .select("id, email, full_name, first_name, preferred_name, user_id, archived, status, portal_access_disabled, last_signed_in_at, invite_sent_at")
        .eq("normalized_email", email)
        .limit(2);
      const client = rows?.length === 1 ? (rows[0] as any) : null;
      if (client && setupInviteState(client).state === "ok") {
        await sendSetupEmailFor(client as SetupEmailClient, await setupPageFor(client.id, await appSetupPage()));
      } else {
        const { appOrigin } = await import("@/lib/pt-session-gcal.server");
        await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo: `${appOrigin()}/reset-password` });
      }
    } catch (e: any) {
      console.warn("[setup] new link request failed:", e?.message ?? e);
    }
    return { ok: true };
  });

// Send a password reset email.
export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), redirectTo: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: client, error } = await supabase
      .from("clients").select("id, email").eq("id", data.clientId).single();
    if (error) throw new Error(error.message);
    if (!client?.email) throw new Error("Client has no email address");
    await assertNotPrivilegedTarget({ email: client.email });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // resetPasswordForEmail SENDS the email; admin.generateLink only generates a URL.
    const { error: lErr } = await supabaseAdmin.auth.resetPasswordForEmail(
      client.email,
      { redirectTo: data.redirectTo },
    );
    if (lErr) throw new Error(lErr.message);
    await supabaseAdmin.from("clients").update({
      password_reset_sent_at: new Date().toISOString(),
      account_status: "Password Reset Sent",
      invite_expires_at: null,
    }).eq("id", client.id);
    return { ok: true, url: null as string | null };
  });

// Generate a password reset link without sending an email — for copy-to-clipboard.
export const getPasswordResetLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), redirectTo: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: client, error } = await supabase
      .from("clients").select("id, email").eq("id", data.clientId).single();
    if (error) throw new Error(error.message);
    if (!client?.email) throw new Error("Client has no email address");
    await assertNotPrivilegedTarget({ email: client.email });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: client.email,
      options: { redirectTo: data.redirectTo },
    });
    if (lErr) throw new Error(lErr.message);
    const hashedToken = (link as any)?.properties?.hashed_token as string | undefined;
    if (!hashedToken) throw new Error("Could not generate reset link token");
    const url = new URL(data.redirectTo);
    url.searchParams.set("token_hash", hashedToken);
    url.searchParams.set("type", "recovery");
    await supabaseAdmin.from("clients").update({
      password_reset_sent_at: new Date().toISOString(),
      account_status: "Password Reset Sent",
      invite_expires_at: null,
    }).eq("id", client.id);
    return { url: url.toString() };
  });

// Admin sets a client's password directly.
export const setClientPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      clientId: z.string().uuid(),
      password: z.string().min(1).max(72),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: client, error } = await supabase
      .from("clients").select("id, email, user_id").eq("id", data.clientId).single();
    if (error) throw new Error(error.message);
    if (!client?.email) throw new Error("Client has no email address");
    await assertNotPrivilegedTarget({ email: client.email, userId: client.user_id });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let authUserId = client.user_id as string | null;
    if (!authUserId) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers();
      const existing = list.users.find(
        (u: any) => (u.email || "").toLowerCase() === client.email!.toLowerCase(),
      );
      if (existing) {
        authUserId = existing.id;
        const { error: uErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
          password: data.password,
          email_confirm: true,
        });
        if (uErr) throw new Error(uErr.message);
      } else {
        const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
          email: client.email,
          password: data.password,
          email_confirm: true,
        });
        if (cErr) throw new Error(cErr.message);
        authUserId = created.user.id;
      }
      await supabaseAdmin.from("clients").update({
        user_id: authUserId,
        account_status: "Account Created",
        account_created_at: new Date().toISOString(),
      }).eq("id", client.id);
    } else {
      const { error: uErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password: data.password,
      });
      if (uErr) throw new Error(uErr.message);
    }
    return { ok: true };
  });

// Admin manual toggles
export const markSetupComplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase.from("clients").update({
      account_status: "Account Created",
      account_created_at: new Date().toISOString(),
      needs_admin_help: false,
    }).eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setNeedsAdminHelp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), value: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const patch: ClientUpdate = { needs_admin_help: data.value };
    if (data.value) patch.account_status = "Needs Admin Help";
    const { error } = await supabase.from("clients").update(patch).eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const archiveClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), archived: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("clients")
      .update({
        archived: data.archived,
        status: data.archived ? "Archived" : "Active",
      })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * "Delete client" never deletes on the spot: the account goes to Recently
 * deleted for 30 days (account_delete_by_admin: held, out of the Clients list
 * and Crew, restorable from Recently deleted), then the purge job deletes it
 * for good the way this always did (chat history kept: account-deletion.server.ts).
 */
export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        /** older builds send it; the login always goes with the account on day 30 */
        deleteAuthUser: z.boolean().optional(),
        reason: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: res, error } = await (supabase as any).rpc("account_delete_by_admin", {
      _client_id: data.clientId,
      _member_id: null,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("client_activity_log").insert({
      client_id: data.clientId,
      actor_user_id: userId,
      actor_role: "admin",
      action: "client_moved_to_recently_deleted",
      details: { purge_after: (res as any)?.purge_after ?? null },
    } as any);
    return {
      ok: true,
      kept: false as const,
      binned: true as const,
      purgeAfter: ((res as any)?.purge_after ?? null) as string | null,
    };
  });