import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function genToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Admin required");
}

/* ---------- list / read ---------- */

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accountType?: string; status?: string } | undefined) => i ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("app_members").select("*").order("created_at", { ascending: false });
    if (data.accountType) q = q.eq("account_type", data.accountType);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { members: rows ?? [] };
  });

export const getMember = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { memberId: string }) => z.object({ memberId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: member } = await supabaseAdmin.from("app_members").select("*").eq("id", data.memberId).maybeSingle();
    if (!member) throw new Error("Not found");
    const { data: access } = await supabaseAdmin.from("member_access").select("*").eq("member_id", data.memberId);
    return { member, access: access ?? [] };
  });

/* ---------- create / update ---------- */

const CreateMemberInput = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).max(200),
  account_type: z.enum(["app_member", "program_only", "jf_member"]).default("app_member"),
  initial_access_keys: z.array(z.string()).optional(),
  apply_defaults: z.boolean().optional().default(true),
});

export const createAppMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateMemberInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const setup_token = genToken();
    const setup_token_expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("app_members")
      .insert({
        email: data.email,
        full_name: data.full_name,
        account_type: data.account_type,
        status: "Active",
        setup_token,
        setup_token_expires_at,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    if (data.initial_access_keys?.length) {
      await supabaseAdmin.from("member_access").insert(
        data.initial_access_keys.map((k) => ({
          member_id: row.id,
          access_level_key: k,
          source: "admin_grant",
        })),
      );
    }
    if (data.apply_defaults !== false) {
      await supabaseAdmin.rpc("apply_default_member_access", { _member_id: row.id });
    }
    // Fire SMS automations registered for the "account_created" trigger.
    try {
      const { fireAutomationTrigger } = await import("@/lib/sms-trigger.server");
      const origin = getOrigin();
      const link = `${origin}/member-setup?token=${setup_token}`;
      await fireAutomationTrigger(supabaseAdmin, {
        trigger: "account_created",
        memberId: row.id,
        vars: { setup_link: link },
      });
    } catch (e) {
      console.error("[createAppMember] automation trigger failed", e);
    }
    return { member: row };
  });

const UpdateMemberInput = z.object({
  memberId: z.string().uuid(),
  full_name: z.string().optional(),
  status: z.enum(["Active","Trial","Past Due","Cancelled","Expired","Deactivated","Archived"]).optional(),
  account_type: z.enum(["app_member","program_only","jf_member"]).optional(),
  messaging_permission: z.enum(["none","support_only","upgrade_only"]).optional(),
  admin_notes: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  sms_opt_out: z.boolean().optional(),
});

export const updateAppMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateMemberInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { memberId, ...patch } = data;
    const { data: prev } = await supabaseAdmin.from("app_members").select("account_type").eq("id", memberId).maybeSingle();
    const { error } = await supabaseAdmin.from("app_members").update(patch).eq("id", memberId);
    if (error) throw new Error(error.message);
    if (patch.account_type && prev?.account_type !== patch.account_type) {
      await supabaseAdmin.rpc("apply_default_member_access", { _member_id: memberId });
    }
    return { ok: true };
  });

/* ---------- defaults ---------- */

export const applyDefaultMemberAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { memberId: string }) => z.object({ memberId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin.rpc("apply_default_member_access", { _member_id: data.memberId });
    if (error) throw new Error(error.message);
    return { inserted: (inserted as number) ?? 0 };
  });

export const listMemberDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accountType: string }) => z.object({ accountType: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("member_access_defaults")
      .select("access_level_key, enabled")
      .eq("account_type", data.accountType);
    return { keys: (rows ?? []).filter((r: any) => r.enabled).map((r: any) => r.access_level_key) };
  });

/* ---------- setup / reset links ---------- */

function getOrigin() {
  return process.env.PUBLIC_APP_URL || process.env.SITE_URL || "";
}

export const generateSetupLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { memberId: string }) => z.object({ memberId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const setup_token = genToken();
    const setup_token_expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("app_members")
      .update({ setup_token, setup_token_expires_at })
      .eq("id", data.memberId)
      .select("email")
      .single();
    if (error) throw new Error(error.message);
    const origin = getOrigin();
    const link = `${origin}/member-setup?token=${setup_token}`;
    return { link, email: row.email };
  });

export const generatePasswordResetLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { memberId: string }) => z.object({ memberId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("app_members").select("email").eq("id", data.memberId).maybeSingle();
    if (!row?.email) throw new Error("Member has no email");
    const origin = getOrigin();
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: row.email,
      options: { redirectTo: `${origin}/reset-password` },
    });
    if (error) throw new Error(error.message);
    return { link: link.properties.action_link, email: row.email };
  });

/* ---------- access grants ---------- */

export const grantAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    memberId: z.string().uuid(),
    accessKey: z.string().min(1),
    source: z.enum(["subscription","one_time","admin_grant"]).default("admin_grant"),
    expiresAt: z.string().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("member_access").insert({
      member_id: data.memberId,
      access_level_key: data.accessKey,
      source: data.source,
      expires_at: data.expiresAt ?? null,
      active: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { accessId: string }) => z.object({ accessId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("member_access").update({ active: false }).eq("id", data.accessId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- member-side: read own profile ---------- */

export const getCurrentMember = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("app_members").select("*").eq("user_id", userId).maybeSingle();
    if (!member) return { member: null, access: [] };
    const { data: access } = await supabase
      .from("member_access")
      .select("*")
      .eq("member_id", member.id)
      .eq("active", true);
    return { member, access: access ?? [] };
  });

/* ---------- self: update own marketing preferences ---------- */

const UpdateMyMarketingPrefsInput = z.object({
  email_marketing_opt_in: z.boolean().optional(),
  sms_marketing_on: z.boolean().optional(),
});

export const updateMyMarketingPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateMyMarketingPrefsInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase
      .from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) throw new Error("Member profile not found");
    const patch: {
      email_marketing_opt_in?: boolean;
      sms_opt_out?: boolean;
      sms_consent_at?: string;
    } = {};
    if (typeof data.email_marketing_opt_in === "boolean") {
      patch.email_marketing_opt_in = data.email_marketing_opt_in;
    }
    if (typeof data.sms_marketing_on === "boolean") {
      if (data.sms_marketing_on) {
        patch.sms_opt_out = false;
        patch.sms_consent_at = new Date().toISOString();
      } else {
        patch.sms_opt_out = true;
      }
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase
      .from("app_members").update(patch).eq("id", member.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- public: redeem setup token ---------- */

const RedeemInput = z.object({
  token: z.string().min(20).max(128),
  password: z.string().min(1).max(72),
});

export const redeemSetupToken = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => RedeemInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: member, error } = await supabaseAdmin
      .from("app_members")
      .select("*")
      .eq("setup_token", data.token)
      .maybeSingle();
    if (error || !member) throw new Error("Invalid setup link");
    if (member.setup_token_expires_at && new Date(member.setup_token_expires_at) < new Date()) {
      throw new Error("Setup link expired — ask the admin for a new one");
    }

    // Find or create auth user
    let userId = member.user_id as string | null;
    if (!userId) {
      // Look up existing user by email
      const { data: list } = await supabaseAdmin.auth.admin.listUsers();
      const existing = list.users.find((u: any) => (u.email || "").toLowerCase() === member.email.toLowerCase());
      if (existing) {
        userId = existing.id;
        await supabaseAdmin.auth.admin.updateUserById(existing.id, { password: data.password });
      } else {
        const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
          email: member.email,
          password: data.password,
          email_confirm: true,
          user_metadata: { full_name: member.full_name },
        });
        if (cErr) throw new Error(cErr.message);
        userId = created.user.id;
      }
    } else {
      await supabaseAdmin.auth.admin.updateUserById(userId, { password: data.password });
    }

    await supabaseAdmin
      .from("app_members")
      .update({ user_id: userId, setup_token: null, setup_token_expires_at: null })
      .eq("id", member.id);

    return { ok: true, email: member.email };
  });