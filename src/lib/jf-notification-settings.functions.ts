// ============================================================================
// JF Membership notification mode + allowlist settings.
//
// Backs the admin UI control on /admin/membership/notifications.
// Persists to app_settings.value (key='jf_membership_notifications') which is
// the same row consumed by sms-trigger.server.ts and launch-readiness.
// Admin-only (has_role check), service-role write.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NotificationMode = "dry_run" | "allowlist" | "live";
export type NotificationSettings = {
  mode: NotificationMode;
  allowlist_phones: string[];
  allowlist_emails: string[];
};

const DEFAULT: NotificationSettings = { mode: "dry_run", allowlist_phones: [], allowlist_emails: [] };

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

function parseValue(value: any): NotificationSettings {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : (value ?? {});
    const mode = (["dry_run", "allowlist", "live"] as const).includes(parsed?.mode) ? parsed.mode : "dry_run";
    const phones = Array.isArray(parsed?.allowlist_phones) ? parsed.allowlist_phones.map((p: any) => String(p)) : [];
    const emails = Array.isArray(parsed?.allowlist_emails) ? parsed.allowlist_emails.map((e: any) => String(e).toLowerCase()) : [];
    return { mode, allowlist_phones: phones, allowlist_emails: emails };
  } catch {
    return DEFAULT;
  }
}

export const getJfNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings").select("value")
      .eq("key", "jf_membership_notifications").maybeSingle();
    if (error) throw new Error(error.message);
    return parseValue(data?.value);
  });

const updateSchema = z.object({
  mode: z.enum(["dry_run", "allowlist", "live"]),
  allowlist_phones: z.array(z.string().trim()).max(50),
  allowlist_emails: z.array(z.string().trim().toLowerCase()).max(50),
});

export const updateJfNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof updateSchema>) => updateSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const value: NotificationSettings = {
      mode: data.mode,
      allowlist_phones: data.allowlist_phones.map((p) => p.trim()).filter(Boolean),
      allowlist_emails: data.allowlist_emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
    };
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "jf_membership_notifications", value: value as any }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return value;
  });