import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
      .select("id, email, full_name, user_id")
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

    if (inviteErr) {
      // If user already exists, fall back to a password recovery / magic link
      const { data: link, error: linkErr } =
        await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email: client.email,
          options: { redirectTo: data.redirectTo },
        });
      if (linkErr) throw new Error(inviteErr.message);
      if (link.user && !client.user_id) {
        await supabaseAdmin.from("clients").update({ user_id: link.user.id }).eq("id", client.id);
      }
      return { ok: true, resent: true };
    }

    if (invited.user) {
      await supabaseAdmin.from("clients").update({ user_id: invited.user.id }).eq("id", client.id);
    }
    return { ok: true, resent: false };
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