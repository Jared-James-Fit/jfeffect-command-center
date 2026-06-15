import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admin required");
}

export type MembershipOnboardingEmailSettings = {
  enabled: boolean;
  subject: string;
  preheader: string;
  welcome_message: string;
  next_step: string;
  support_email: string;
  cancel_instructions: string;
  product_name: string;
  monthly_price_display: string;
  trial_timezone: string;
  updated_at: string;
};

export const getMembershipOnboardingEmail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("membership_onboarding_email_settings")
      .select("*").eq("id", true).maybeSingle();
    if (error) throw new Error(error.message);
    return data as MembershipOnboardingEmailSettings | null;
  });

const UpdateInput = z.object({
  enabled: z.boolean().optional(),
  subject: z.string().min(1).max(200).optional(),
  preheader: z.string().min(1).max(200).optional(),
  welcome_message: z.string().min(1).max(2000).optional(),
  next_step: z.string().min(1).max(2000).optional(),
  support_email: z.string().email().optional(),
  cancel_instructions: z.string().min(1).max(2000).optional(),
  product_name: z.string().min(1).max(100).optional(),
  monthly_price_display: z.string().min(1).max(100).optional(),
  trial_timezone: z.string().min(1).max(64).optional(),
});

export const updateMembershipOnboardingEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("membership_onboarding_email_settings")
      .update(data).eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Sends the onboarding email NOW to a chosen address (admin preview).
 * Bypasses dedupe by using a fresh idempotency key; honours suppression list.
 */
const PreviewInput = z.object({
  recipientEmail: z.string().email(),
  memberId: z.string().uuid().optional(),
});

export const sendMembershipOnboardingEmailPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PreviewInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendMembershipOnboardingEmail } = await import("@/lib/membership-onboarding-email.server");
    const origin = process.env.PUBLIC_APP_URL || process.env.SITE_URL || "";

    // Look up a real member when memberId provided, else build a preview member
    let member: any;
    if (data.memberId) {
      const { data: m } = await supabaseAdmin
        .from("app_members")
        .select("id,email,full_name,setup_token,user_id,trial_end_at,current_period_end")
        .eq("id", data.memberId).maybeSingle();
      if (!m) throw new Error("Member not found");
      member = { ...m, email: data.recipientEmail };
    } else {
      const trial = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
      member = {
        id: crypto.randomUUID(),
        email: data.recipientEmail,
        full_name: "Preview Member",
        setup_token: null,
        user_id: "preview",
        trial_end_at: trial,
        current_period_end: trial,
      };
    }
    // Force bypass dedupe by clearing any pre-existing key for this preview id
    await supabaseAdmin
      .from("notification_dedupe")
      .delete()
      .eq("key", `membership_onboarding:${member.id}:email`)
      .eq("channel", "email")
      .then(() => {}, () => {});
    return sendMembershipOnboardingEmail(supabaseAdmin, member, origin);
  });