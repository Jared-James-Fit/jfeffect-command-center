import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const inviteCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      coachId: z.string().uuid(),
      redirectTo: z.string().url(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: coach, error } = await supabase
      .from("coaches").select("id, email, full_name, user_id").eq("id", data.coachId).single();
    if (error) throw new Error(error.message);
    if (!coach?.email) throw new Error("Coach has no email");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invited, error: inviteErr } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(coach.email, {
        redirectTo: data.redirectTo,
        data: { full_name: coach.full_name, coach_id: coach.id, invite_role: "coach" },
      });

    let userIdAssigned: string | null = coach.user_id ?? null;
    if (inviteErr) {
      // Fall back to password recovery if user already exists.
      const { error: resetErr } = await supabaseAdmin.auth.resetPasswordForEmail(
        coach.email, { redirectTo: data.redirectTo },
      );
      if (resetErr) throw new Error(resetErr.message);
    } else if (invited.user) {
      userIdAssigned = invited.user.id;
    }

    const patch: any = { status: "Pending Invite" };
    if (userIdAssigned) patch.user_id = userIdAssigned;
    await supabaseAdmin.from("coaches").update(patch).eq("id", coach.id);

    return { ok: true };
  });

// Generate a copy-able setup link (no email) — useful before email domain is configured.
export const getCoachSetupLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ coachId: z.string().uuid(), redirectTo: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: coach, error } = await supabase
      .from("coaches").select("id, email, user_id").eq("id", data.coachId).single();
    if (error) throw new Error(error.message);
    if (!coach?.email) throw new Error("Coach has no email");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const linkType = coach.user_id ? "magiclink" : "invite";
    const { data: link, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
      type: linkType as any,
      email: coach.email,
      options: {
        redirectTo: data.redirectTo,
        data: { coach_id: coach.id, invite_role: "coach" },
      } as any,
    });
    if (lErr) throw new Error(lErr.message);
    return { url: (link as any)?.properties?.action_link as string };
  });

// Called from the client after a coach signs in (via /setup) to link their
// auth user to the coach row and grant the 'coach' role.
export const acceptCoachInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const meta = (claims?.user_metadata ?? {}) as Record<string, any>;
    const coachId: string | undefined = meta.coach_id;
    if (!coachId) return { ok: false, reason: "no_coach_metadata" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify the coach row matches the user's email.
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email?.toLowerCase();
    if (!email) throw new Error("Missing email on auth user");

    const { data: coach, error: cErr } = await supabaseAdmin
      .from("coaches").select("id, email, user_id").eq("id", coachId).single();
    if (cErr) throw new Error(cErr.message);
    if (coach.email.toLowerCase() !== email) throw new Error("Coach email mismatch");

    // Link + activate
    await supabaseAdmin.from("coaches").update({
      user_id: userId,
      status: "Active",
      last_login_at: new Date().toISOString(),
    }).eq("id", coachId);

    // Swap default 'client' role for 'coach' role.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "client");
    await supabaseAdmin.from("user_roles").upsert(
      { user_id: userId, role: "coach" as any },
      { onConflict: "user_id,role" } as any,
    );

    return { ok: true };
  });

export const assignClientToCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      clientId: z.string().uuid(),
      coachId: z.string().uuid().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("clients")
      .update({ assigned_coach_id: data.coachId })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("client_activity_log").insert({
      client_id: data.clientId,
      actor_user_id: userId,
      actor_role: "admin",
      action: data.coachId ? "coach_assigned" : "coach_unassigned",
      details: { coach_id: data.coachId } as any,
    });
    return { ok: true };
  });

export const setCoachStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      coachId: z.string().uuid(),
      status: z.enum(["Active", "Inactive", "Pending Invite", "Suspended", "Archived"]),
      archived: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { status: data.status };
    if (data.archived !== undefined) patch.archived = data.archived;
    if (data.status === "Archived") patch.archived = true;
    const { error } = await supabaseAdmin.from("coaches").update(patch).eq("id", data.coachId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });