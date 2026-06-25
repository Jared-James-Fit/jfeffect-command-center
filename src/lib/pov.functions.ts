import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin POV ("Preview as Member") system.
 *
 * Strategy: each admin gets exactly one `app_members` row with
 * `is_admin_sandbox = true`, linked to their own auth user_id. Toggling a
 * persona simply swaps the `member_access` rows on that sandbox member.
 * Since `current_member_id()` resolves via `auth.uid()`, the sandbox row
 * naturally activates whenever the admin visits `/m/*`.
 */

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Admin required");
  return userId as string;
}

const PERSONA_PRESETS: Record<string, string[]> = {
  app_member: ["app_membership"],
  app_member_premium: ["app_membership", "premium_membership"],
  program_only: ["program_only"],
  none: [],
};

async function getAdminEmail(supabaseAdmin: any, userId: string): Promise<string> {
  const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
  return (u?.user?.email ?? `pov+${userId}@admin.local`) as string;
}

/** Get-or-create the admin's sandbox app_members row. */
export const ensurePovSandbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Already linked?
    const { data: existing } = await supabaseAdmin
      .from("app_members")
      .select("*")
      .eq("user_id", userId)
      .eq("is_admin_sandbox", true)
      .maybeSingle();
    if (existing) return { member: existing };

    const email = await getAdminEmail(supabaseAdmin, userId);
    const povEmail = `pov+${userId}@admin.local`;
    const { data: row, error } = await supabaseAdmin
      .from("app_members")
      .insert({
        email: povEmail,
        full_name: `[POV Sandbox] ${email}`,
        account_type: "app_member",
        status: "Active",
        user_id: userId,
        is_admin_sandbox: true,
        admin_notes: "Admin POV sandbox — do not delete. Used for Preview-as-Member.",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { member: row };
  });

/** Replace sandbox access with a persona preset or explicit keys. */
export const setPovPersona = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      persona: z.enum(["app_member", "app_member_premium", "program_only", "none", "custom"]),
      accessKeys: z.array(z.string().min(1).max(64)).max(20).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const userId = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ensure sandbox exists.
    let { data: sandbox } = await supabaseAdmin
      .from("app_members")
      .select("id")
      .eq("user_id", userId)
      .eq("is_admin_sandbox", true)
      .maybeSingle();
    if (!sandbox) {
      const povEmail = `pov+${userId}@admin.local`;
      const ins = await supabaseAdmin
        .from("app_members")
        .insert({
          email: povEmail,
          full_name: "[POV Sandbox]",
          account_type: "app_member",
          status: "Active",
          user_id: userId,
          is_admin_sandbox: true,
        })
        .select("id")
        .single();
      if (ins.error) throw new Error(ins.error.message);
      sandbox = ins.data;
    }

    const keys = data.persona === "custom"
      ? (data.accessKeys ?? [])
      : PERSONA_PRESETS[data.persona] ?? [];

    // Wipe existing sandbox access, then re-insert.
    await supabaseAdmin.from("member_access").delete().eq("member_id", sandbox.id);
    if (keys.length > 0) {
      const rows = keys.map((k) => ({
        member_id: sandbox.id,
        access_level_key: k,
        source: "admin_grant" as const,
        active: true,
      }));
      const ins = await supabaseAdmin.from("member_access").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }

    // Reflect persona on the sandbox account_type for label clarity.
    const accountType = data.persona === "program_only" ? "program_only" : "app_member";
    await supabaseAdmin
      .from("app_members")
      .update({ account_type: accountType })
      .eq("id", sandbox.id);

    return { ok: true, memberId: sandbox.id, persona: data.persona, accessKeys: keys };
  });

/** Copy a real member's active access onto the admin sandbox. */
export const copyPovFromMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ memberId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const userId = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: src } = await supabaseAdmin
      .from("app_members")
      .select("account_type")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!src) throw new Error("Member not found");

    const { data: srcAccess } = await supabaseAdmin
      .from("member_access")
      .select("access_level_key")
      .eq("member_id", data.memberId)
      .eq("active", true);

    // Ensure sandbox.
    let { data: sandbox } = await supabaseAdmin
      .from("app_members")
      .select("id")
      .eq("user_id", userId)
      .eq("is_admin_sandbox", true)
      .maybeSingle();
    if (!sandbox) {
      const ins = await supabaseAdmin
        .from("app_members")
        .insert({
          email: `pov+${userId}@admin.local`,
          full_name: "[POV Sandbox]",
          account_type: src.account_type,
          status: "Active",
          user_id: userId,
          is_admin_sandbox: true,
        })
        .select("id")
        .single();
      if (ins.error) throw new Error(ins.error.message);
      sandbox = ins.data;
    }

    await supabaseAdmin.from("member_access").delete().eq("member_id", sandbox.id);
    if (srcAccess && srcAccess.length) {
      await supabaseAdmin.from("member_access").insert(
        srcAccess.map((a: any) => ({
          member_id: sandbox!.id,
          access_level_key: a.access_level_key,
          source: "admin_grant" as const,
          active: true,
        })),
      );
    }
    await supabaseAdmin
      .from("app_members")
      .update({ account_type: src.account_type })
      .eq("id", sandbox.id);

    return { ok: true, memberId: sandbox.id };
  });