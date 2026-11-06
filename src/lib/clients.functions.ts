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

/**
 * Send the setup email to the client's email on file: an invite for a new
 * login, else (they already have one) a set-password email, linking a login
 * they made themselves first. Stamps when it went out.
 */
async function sendSetupEmailFor(client: SetupEmailClient, redirectTo: string | undefined) {
  await assertNotPrivilegedTarget({ email: client.email, userId: client.user_id });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: invited, error: inviteErr } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(client.email, {
      redirectTo,
      data: { full_name: client.full_name },
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
    invite_sent_at: now,
    invite_last_resent_at: now,
    invite_expires_at: null,
    account_status: "Invite Sent",
  };
  if (invited.user) patch.user_id = invited.user.id;
  await supabaseAdmin.from("clients").update(patch).eq("id", client.id);
  return { ok: true, resent: false };
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
    if (!client?.email) throw new Error("Client has no email address. Copy or text the setup link instead: they add their email when they open it.");

    return sendSetupEmailFor(client as SetupEmailClient, data.redirectTo);
  });

// Generate a setup link without sending an email — for copy-to-clipboard.
export const getSetupLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), redirectTo: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: client, error } = await supabase
      .from("clients").select("id, email, user_id").eq("id", data.clientId).single();
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!client?.email) {
      // No email yet: a link that asks for it, then sends the setup email there (setup-invite.ts).
      const { signSetupInvite } = await import("@/lib/setup-invite.server");
      const now = new Date().toISOString();
      await supabaseAdmin.from("clients").update({
        invite_sent_at: now,
        invite_last_resent_at: now,
        invite_expires_at: null,
        account_status: "Invite Sent",
      } as ClientUpdate).eq("id", client.id);
      return { url: setupInviteUrl(data.redirectTo, signSetupInvite(client.id)), asksForEmail: true };
    }
    await assertNotPrivilegedTarget({ email: client.email, userId: client.user_id });
    let linkType = client.user_id ? "magiclink" : "invite";
    let { data: link, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
      type: linkType as any,
      email: client.email,
      options: { redirectTo: data.redirectTo },
    });
    // They already made a login themselves: link it and send a set-password link instead.
    if (lErr && !client.user_id && (await claimUnlinkedLogin({ id: client.id, email: client.email }))) {
      linkType = "recovery";
      ({ data: link, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: client.email,
        options: { redirectTo: data.redirectTo },
      }));
    }
    if (lErr) throw new Error(lErr.message);
    // Build our own link using the hashed_token + type. The default
    // `action_link` is a one-time Supabase /verify URL — link prefetchers in
    // iMessage/WhatsApp/Gmail consume the token before the recipient clicks,
    // making the link appear expired. Our /setup page exchanges the token via
    // verifyOtp on user click, which prefetchers cannot trigger.
    const hashedToken = (link as any)?.properties?.hashed_token as string | undefined;
    if (!hashedToken) throw new Error("Could not generate setup link token");
    const url = new URL(data.redirectTo);
    url.searchParams.set("token_hash", hashedToken);
    url.searchParams.set("type", linkType);
    const now = new Date().toISOString();
    await supabaseAdmin.from("clients").update({
      invite_sent_at: now,
      invite_last_resent_at: now,
      invite_expires_at: null,
      account_status: client.user_id ? "Account Created" : "Invite Sent",
    }).eq("id", client.id);
    return { url: url.toString(), asksForEmail: false };
  });

/* ============================================================
 * No-email setup link (setup-invite.ts): public, the signed token is the
 * only key, and it only ever sends the setup email.
 * ============================================================ */

const InviteTokenSchema = z.object({ token: z.string().min(10).max(120) });

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

/** What the invite page shows: their first name and, when there's one on file, a masked email. */
export const peekSetupInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InviteTokenSchema.parse(input))
  .handler(async ({ data }): Promise<SetupInviteState> => setupInviteState(await clientForInvite(data.token)));

/**
 * Send the setup email from an invite link: to the email on file, or, for a
 * record with none, to the email they type, which must be new to JF Effect
 * (an email that already has an account is the coach's to connect).
 */
export const requestSetupFromInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    InviteTokenSchema.extend({ email: z.string().max(254).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const client = await clientForInvite(data.token);
    const state = setupInviteState(client);
    if (state.state === "invalid") throw new Error("This setup link doesn't work anymore. Ask your coach for a new one.");
    if (state.state === "signed_in_before") throw new Error("You already have an account. Sign in, or tap Forgot password.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let email: string | null = (client.email ?? "").trim() || null;
    if (!email) {
      const typed = cleanInviteEmail(data.email);
      if (!typed) throw new Error("Enter a valid email address.");
      const taken = "That email already has a JF Effect account. Ask your coach to connect it.";
      const { data: otherClient, error: ocErr } = await supabaseAdmin
        .from("clients").select("id").eq("normalized_email", typed).neq("id", client.id).limit(1);
      if (ocErr) throw new Error(ocErr.message);
      if (otherClient?.length) throw new Error(taken);
      const { data: logins, error: lgErr } = await supabaseAdmin
        .from("profiles").select("id, email").ilike("email", typed.replace(/[\\%_]/g, (c) => `\\${c}`));
      if (lgErr) throw new Error(lgErr.message);
      if ((logins ?? []).some((p: any) => String(p.email ?? "").trim().toLowerCase() === typed)) throw new Error(taken);
      // Only while the record still has no email: a coach who just added one wins.
      let save = supabaseAdmin.from("clients").update({ email: typed } as ClientUpdate).eq("id", client.id);
      save = client.email === null ? save.is("email", null) : save.eq("email", client.email);
      const { data: saved, error: sErr } = await save.select("id").maybeSingle();
      if (sErr) throw new Error(sErr.message);
      if (!saved) throw new Error("Your coach just updated your account. Open the link again.");
      email = typed;
    }

    const { appOrigin } = await import("@/lib/pt-session-gcal.server");
    await sendSetupEmailFor(
      { id: client.id, email, full_name: client.full_name ?? null, user_id: client.user_id ?? null, invite_sent_at: client.invite_sent_at ?? null },
      `${appOrigin()}/setup`,
    );
    return { ok: true, sentTo: maskEmail(email) };
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

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        deleteAuthUser: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: client, error: cErr } = await supabase
      .from("clients")
      .select("id, user_id")
      .eq("id", data.clientId)
      .single();
    if (cErr) throw new Error(cErr.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Chats are never deleted with an account (the database refuses it too,
    // clients_guard_chat_delete): a client with any chat history is
    // deactivated instead, portal off and login kept, so every message and
    // who sent it stays.
    const { data: anyMessage, error: mErr } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("client_id", data.clientId)
      .limit(1);
    if (mErr) throw new Error(mErr.message);
    if (anyMessage?.length) {
      const { error: deErr } = await supabaseAdmin.from("clients").update({
        status: "Deactivated",
        deactivated_at: new Date().toISOString(),
        deactivated_by: userId,
        deactivation_reason: "Deleted by admin (chat history kept)",
        portal_access_disabled: true,
      }).eq("id", data.clientId);
      if (deErr) throw new Error(deErr.message);
      await supabaseAdmin.from("client_activity_log").insert({
        client_id: data.clientId,
        actor_user_id: userId,
        actor_role: "admin",
        action: "client_deactivated",
        details: { instead_of_delete: true, reason: "chat history kept", portal_disabled: true },
      });
      return { ok: true, kept: true as const };
    }

    const { error: delErr } = await supabaseAdmin
      .from("clients")
      .delete()
      .eq("id", data.clientId);
    if (delErr) throw new Error(delErr.message);

    if (data.deleteAuthUser && client.user_id) {
      // Refused (and the login kept) if it has chats elsewhere, e.g. a member's group chats.
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(client.user_id);
      if (authErr) console.warn("[deleteClient] login kept:", authErr.message);
    }
    return { ok: true, kept: false as const };
  });