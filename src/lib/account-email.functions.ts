import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  newEmail: z.string().trim().toLowerCase().email().max(254),
  redirectTo: z.string().url().optional(),
});

/**
 * Request an email change for the signed-in user.
 *
 * Supabase Auth handles the confirmation flow: it sends a confirmation link
 * to the new address (and, when enabled in Auth settings, a notice to the
 * current address). The change only takes effect after the user clicks the
 * link in the new inbox.
 *
 * We also fire the `email_change_requested` SMS automation (best-effort) so
 * the account holder gets a heads-up on their phone that the change is in
 * flight — useful for catching unauthorized change attempts.
 */
export const requestEmailChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Look up current email for change-notification + sms vars.
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not signed in");
    const currentEmail = userData.user.email ?? "";
    if (currentEmail.toLowerCase() === data.newEmail) {
      throw new Error("That's already your email address.");
    }

    // Trigger Supabase's confirmation email to the new address.
    const { error } = await supabase.auth.updateUser(
      { email: data.newEmail },
      data.redirectTo ? { emailRedirectTo: data.redirectTo } : undefined,
    );
    if (error) throw new Error(error.message);

    // Best-effort SMS notification — never block the email change on this.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { fireAutomationTrigger } = await import("@/lib/sms-trigger.server");

      // Resolve whether this user is a member or a client so we can use their
      // stored phone + brand-aware automation rendering.
      const [{ data: member }, { data: client }] = await Promise.all([
        supabaseAdmin.from("app_members").select("id").eq("user_id", userId).maybeSingle(),
        supabaseAdmin.from("clients").select("id").eq("user_id", userId).maybeSingle(),
      ]);
      await fireAutomationTrigger(supabaseAdmin, {
        trigger: "email_change_requested",
        memberId: member?.id ?? null,
        clientId: client?.id ?? null,
        vars: {
          old_email: currentEmail,
          new_email: data.newEmail,
        },
      });
    } catch (e) {
      console.warn("[account-email] sms notification failed", e);
    }

    return { ok: true, pendingEmail: data.newEmail };
  });