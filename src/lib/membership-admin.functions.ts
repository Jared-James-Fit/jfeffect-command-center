import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMemberAccessActive } from "@/lib/memberAccess";
import { z } from "zod";

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

export const getMembershipStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("app_members")
      .select("id, account_type, status, subscription_status, trial_end_at, current_period_end, avatar_url, phone, sms_opt_out, last_signed_in_at, user_id, full_name, email, profile_picture_required, created_at, paused_until, hold_plan_started_at, cancelled_at, cancel_at, manual_access_override, manual_access_disabled, access_end_date, in_grace")
      .eq("account_type", "jf_member");
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    const has = (m: any) => !!m.user_id;
    const counts = {
      active: list.filter((m) => m.subscription_status === "Active").length,
      trialing: list.filter((m) => m.subscription_status === "Trialing").length,
      past_due: list.filter((m) => ["Past Due", "Payment Failed"].includes(m.subscription_status ?? "")).length,
      paused: list.filter((m) => !!m.paused_until || m.subscription_status === "Paused").length,
      hold: list.filter((m) => !!m.hold_plan_started_at || m.subscription_status === "Hold Plan").length,
      cancelled: list.filter((m) => m.subscription_status === "Cancelled" || !!m.cancelled_at).length,
      incomplete_setup: list.filter((m) => !has(m)).length,
      missing_pfp: list.filter((m) => m.profile_picture_required && !m.avatar_url).length,
      missing_phone: list.filter((m) => !m.phone).length,
      missing_sms: list.filter((m) => !!m.sms_opt_out).length,
      total: list.length,
      access_active: list.filter((m) => isMemberAccessActive(m)).length,
      access_expired: list.filter((m) => !isMemberAccessActive(m)).length,
      manual_override: list.filter((m) => m.manual_access_override === true).length,
    };
    const recentSignups = list
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);
    const now = Date.now();
    const upcomingTrialEndings = list
      .filter((m) => m.trial_end_at && new Date(m.trial_end_at).getTime() > now && new Date(m.trial_end_at).getTime() < now + 1000 * 60 * 60 * 24 * 7)
      .sort((a, b) => new Date(a.trial_end_at!).getTime() - new Date(b.trial_end_at!).getTime());
    return { counts, recentSignups, upcomingTrialEndings };
  });

export const getMembershipActionNeeded = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("app_members")
      .select("id, full_name, email, avatar_url, phone, sms_opt_out, user_id, subscription_status, trial_end_at, setup_token, last_signed_in_at, account_type, profile_picture_required, cancelled_at")
      .eq("account_type", "jf_member");
    const list = rows ?? [];
    const now = Date.now();
    const buckets = {
      incomplete_setup: list.filter((m) => !m.user_id),
      missing_pfp: list.filter((m) => m.profile_picture_required && !m.avatar_url),
      missing_phone: list.filter((m) => !m.phone),
      missing_sms: list.filter((m) => !!m.sms_opt_out),
      payment_failed: list.filter((m) => ["Past Due", "Payment Failed"].includes(m.subscription_status ?? "")),
      trial_ending: list.filter((m) => m.trial_end_at && new Date(m.trial_end_at).getTime() > now && new Date(m.trial_end_at).getTime() < now + 1000 * 60 * 60 * 24 * 3),
      cancelled_recent: list.filter((m) => m.cancelled_at && new Date(m.cancelled_at).getTime() > now - 1000 * 60 * 60 * 24 * 14),
      setup_link_not_opened: list.filter((m) => m.setup_token && !m.last_signed_in_at),
    };
    return { buckets };
  });

export const getSignupStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("app_members")
      .select("id, created_at, subscription_status, account_type, cancelled_at")
      .eq("account_type", "jf_member");
    const list = rows ?? [];
    const day = 1000 * 60 * 60 * 24;
    const now = Date.now();
    const bucket = (n: number) => list.filter((m) => new Date(m.created_at).getTime() > now - n * day).length;
    return {
      last_7_days: bucket(7),
      last_30_days: bucket(30),
      last_90_days: bucket(90),
      all_time: list.length,
      churn_30d: list.filter((m) => m.cancelled_at && new Date(m.cancelled_at).getTime() > now - 30 * day).length,
    };
  });

export const getRecentlyExpiredMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("app_members")
      .select("id, full_name, email, avatar_url, subscription_status, status, manual_access_override, manual_access_disabled, access_end_date, in_grace, cancelled_at, current_period_end, trial_end_at")
      .eq("account_type", "jf_member");
    const list = rows ?? [];
    const now = Date.now();
    const day = 1000 * 60 * 60 * 24;
    const expired = list
      .filter((m) => !isMemberAccessActive(m as any))
      .map((m) => {
        const candidates = [m.access_end_date, m.cancelled_at, m.current_period_end, m.trial_end_at]
          .map((v) => (v ? new Date(v as string).getTime() : null))
          .filter((v): v is number => v !== null && v <= now);
        const expiredAt = candidates.length ? Math.max(...candidates) : null;
        return { ...m, _expiredAt: expiredAt };
      })
      .filter((m) => m._expiredAt !== null && m._expiredAt > now - 30 * day)
      .sort((a, b) => (b._expiredAt as number) - (a._expiredAt as number))
      .slice(0, 15);
    return { members: expired };
  });

export const grantTemporaryAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ memberId: z.string().uuid(), days: z.number().int().positive().max(365).default(7) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const endDate = new Date(Date.now() + data.days * 24 * 60 * 60 * 1000).toISOString();
    const note = `Admin granted ${data.days}-day access on ${new Date().toLocaleDateString()}`;
    const { error } = await supabaseAdmin
      .from("app_members")
      .update({
        manual_access_override: true,
        manual_access_disabled: false,
        access_end_date: endDate,
        admin_access_note: note,
      })
      .eq("id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true, access_end_date: endDate };
  });