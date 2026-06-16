import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Member dismisses the setup checklist on home for N hours. */
export const dismissSetupChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ hours: z.number().int().min(1).max(24 * 14) }).parse(i))
  .handler(async ({ data, context }) => {
    const until = new Date(Date.now() + data.hours * 3_600_000).toISOString();
    const { error } = await context.supabase
      .from("app_members")
      .update({ setup_dismissed_until: until })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, until };
  });

/** Records the browser notification permission state for the current member. */
export const recordNotificationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ status: z.enum(["granted", "denied", "default", "unsupported"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("app_members")
      .update({ notifications_status: data.status })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const OnboardingFilter = z.enum([
  "all",
  "not_signed_in",
  "not_installed",
  "setup_incomplete",
  "notifications_off",
  "errors",
  "ready",
]);

/** Admin-only: returns app members with onboarding state for the admin dashboard. */
export const listOnboardingMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      filter: OnboardingFilter.default("all"),
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admin required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("app_members")
      .select(
        "id,email,full_name,account_type,status,created_at,last_signed_in_at,setup_completed_at,install_detected_at,install_platform,install_dismissed_at,notifications_status,last_setup_error,setup_dismissed_until,first_workout_opened_at",
        { count: "exact" },
      )
      .eq("account_type", "jf_member")
      .neq("status", "Archived");

    if (data.search) {
      const s = data.search.replace(/[,]/g, " ").trim();
      q = q.or(`email.ilike.%${s}%,full_name.ilike.%${s}%`);
    }

    switch (data.filter) {
      case "not_signed_in":
        q = q.is("last_signed_in_at", null);
        break;
      case "not_installed":
        q = q.is("install_detected_at", null);
        break;
      case "setup_incomplete":
        q = q.is("setup_completed_at", null);
        break;
      case "notifications_off":
        q = q.or("notifications_status.is.null,notifications_status.in.(denied,default,unsupported)");
        break;
      case "errors":
        q = q.not("last_setup_error", "is", null);
        break;
      case "ready":
        q = q.not("setup_completed_at", "is", null).not("install_detected_at", "is", null);
        break;
    }

    q = q.order("created_at", { ascending: false }).range(data.offset, data.offset + data.limit - 1);

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

/** Admin-only: returns aggregate onboarding counts for the dashboard summary. */
export const onboardingCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admin required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    async function count(build: (q: any) => any): Promise<number> {
      let q = supabaseAdmin
        .from("app_members")
        .select("id", { count: "exact", head: true })
        .eq("account_type", "jf_member")
        .neq("status", "Archived");
      q = build(q);
      const { count: c, error } = await q;
      if (error) throw new Error(error.message);
      return c ?? 0;
    }

    const [total, notSignedIn, notInstalled, incomplete, notifOff, errors, ready] = await Promise.all([
      count((q) => q),
      count((q) => q.is("last_signed_in_at", null)),
      count((q) => q.is("install_detected_at", null)),
      count((q) => q.is("setup_completed_at", null)),
      count((q) =>
        q.or("notifications_status.is.null,notifications_status.in.(denied,default,unsupported)"),
      ),
      count((q) => q.not("last_setup_error", "is", null)),
      count((q) => q.not("setup_completed_at", "is", null).not("install_detected_at", "is", null)),
    ]);

    return { total, notSignedIn, notInstalled, incomplete, notifOff, errors, ready };
  });