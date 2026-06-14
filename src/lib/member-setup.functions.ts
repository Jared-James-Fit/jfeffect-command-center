import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SetupPatch = z.object({
  avatar_url: z.string().min(1).optional(),
  phone: z.string().min(5).max(40).optional(),
  sms_opt_out: z.boolean().optional(),
  sms_consent: z.boolean().optional(),
  date_of_birth: z.string().optional().nullable(),
  address_line1: z.string().max(200).optional(),
  address_city: z.string().max(120).optional(),
  address_state: z.string().max(60).optional(),
  address_zip: z.string().max(20).optional(),
  address_country: z.string().max(60).optional(),
  emergency_contact_name: z.string().max(120).optional(),
  emergency_contact_phone: z.string().max(40).optional(),
  goals: z.string().max(2000).optional(),
  goals_tags: z.array(z.string().max(60)).max(20).optional(),
  experience_level: z.enum(["new", "beginner", "intermediate", "advanced"]).optional(),
  training_background: z.string().max(2000).optional(),
  full_name: z.string().max(200).optional(),
});

export const updateMyMemberProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetupPatch.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: me } = await supabase
      .from("app_members")
      .select("id, avatar_url, phone, sms_opt_out, sms_consent_at, date_of_birth, address_line1, emergency_contact_name, emergency_contact_phone, goals, training_background")
      .eq("user_id", userId)
      .maybeSingle();
    if (!me) throw new Error("Member not found");

    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === "sms_consent") continue;
      if (v !== undefined) patch[k] = v;
    }
    if (data.sms_consent === true) {
      patch.sms_consent_at = new Date().toISOString();
      patch.sms_opt_out = false;
    } else if (data.sms_consent === false) {
      patch.sms_opt_out = true;
    }

    const { error } = await supabase.from("app_members").update(patch as any).eq("id", me.id);
    if (error) throw new Error(error.message);

    // Mark setup complete if all required fields are now present.
    const { data: ok } = await supabase.rpc("member_setup_complete", { _member_id: me.id });
    if (ok) {
      await supabase
        .from("app_members")
        .update({ setup_completed_at: new Date().toISOString() })
        .eq("id", me.id)
        .is("setup_completed_at", null);
    }
    return { ok: true, setupComplete: !!ok };
  });

export const getMySetupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: m } = await supabase
      .from("app_members")
      .select("id, account_type, avatar_url, phone, sms_opt_out, sms_consent_at, date_of_birth, address_line1, address_city, address_state, address_zip, address_country, emergency_contact_name, emergency_contact_phone, goals, goals_tags, experience_level, training_background, full_name, setup_completed_at, is_admin_sandbox")
      .eq("user_id", userId)
      .maybeSingle();
    if (!m) return { member: null, complete: true, missing: [] as string[] };
    if (m.is_admin_sandbox) return { member: m, complete: true, missing: [] };
    const missing: string[] = [];
    if (!m.avatar_url) missing.push("avatar_url");
    if (!m.phone) missing.push("phone");
    if (m.sms_opt_out && !m.sms_consent_at) missing.push("sms_consent");
    if (!m.date_of_birth) missing.push("date_of_birth");
    if (!m.address_line1) missing.push("address_line1");
    if (!m.emergency_contact_name) missing.push("emergency_contact_name");
    if (!m.emergency_contact_phone) missing.push("emergency_contact_phone");
    const hasGoals = !!m.goals || (Array.isArray(m.goals_tags) && m.goals_tags.length > 0);
    if (!hasGoals) missing.push("goals");
    const hasBackground = !!m.training_background || !!m.experience_level;
    if (!hasBackground) missing.push("training_background");
    return { member: m, complete: missing.length === 0, missing };
  });

// Admin: update any member's setup fields.
const AdminSetupPatch = SetupPatch.extend({ memberId: z.string().uuid() });
export const adminUpdateMemberSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AdminSetupPatch.parse(i))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admin required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { memberId, sms_consent, ...rest } = data as any;
    const patch: Record<string, any> = { ...rest };
    if (sms_consent === true) {
      patch.sms_consent_at = new Date().toISOString();
      patch.sms_opt_out = false;
    } else if (sms_consent === false) {
      patch.sms_opt_out = true;
    }
    const { error } = await supabaseAdmin.from("app_members").update(patch as any).eq("id", memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });