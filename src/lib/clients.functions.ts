import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

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
    if (!client?.email) throw new Error("Client has no email address");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invited, error: inviteErr } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(client.email, {
        redirectTo: data.redirectTo,
        data: { full_name: client.full_name },
      });

    const now = new Date().toISOString();
    // Default invite expiry tracked at 7 days (Supabase default)
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    if (inviteErr) {
      // If user already exists, fall back to a password recovery email.
      // resetPasswordForEmail actually SENDS the email (admin.generateLink does not).
      const { error: resetErr } = await supabaseAdmin.auth.resetPasswordForEmail(
        client.email,
        { redirectTo: data.redirectTo },
      );
      if (resetErr) throw new Error(resetErr.message);
      const patch: ClientUpdate = {
        invite_last_resent_at: now,
        invite_expires_at: expires,
        account_status: "Invite Sent",
      };
      if (!client.invite_sent_at) patch.invite_sent_at = now;
      await supabaseAdmin.from("clients").update(patch).eq("id", client.id);
      return { ok: true, resent: true, actionLink: null };
    }

    const patch: ClientUpdate = {
      invite_sent_at: now,
      invite_expires_at: expires,
      account_status: "Invite Sent",
    };
    if (invited.user) patch.user_id = invited.user.id;
    await supabaseAdmin.from("clients").update(patch).eq("id", client.id);
    return { ok: true, resent: false };
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
    if (!client?.email) throw new Error("Client has no email address");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const linkType = client.user_id ? "magiclink" : "invite";
    const { data: link, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
      type: linkType as any,
      email: client.email,
      options: { redirectTo: data.redirectTo },
    });
    if (lErr) throw new Error(lErr.message);
    return { url: (link as any)?.properties?.action_link as string };
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
    }).eq("id", client.id);
    return { ok: true, url: null as string | null };
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

    const { error: delErr } = await supabaseAdmin
      .from("clients")
      .delete()
      .eq("id", data.clientId);
    if (delErr) throw new Error(delErr.message);

    if (data.deleteAuthUser && client.user_id) {
      await supabaseAdmin.auth.admin.deleteUser(client.user_id);
    }
    return { ok: true };
  });