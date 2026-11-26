/**
 * Virtual Crew accounts, admin only. Every read and write is a database function that checks the
 * caller (admin_virtual_*), run with the caller's own session. No function here can set a photo,
 * post, comment, follow or message: there is none.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readClientFor, rpcRead } from "@/lib/permissions.server";
import { STARTER_PERSONAS } from "@/lib/virtual-accounts/personas";

export type VirtualAccount = {
  user_id: string;
  slug: string;
  username: string | null;
  first_name: string;
  last_name: string | null;
  bio: string | null;
  background: string | null;
  notes: string | null;
  disciplines: string[];
  active: boolean;
  likes_enabled: boolean;
  daily_like_limit: number;
  quiet_start: number;
  quiet_end: number;
  created_at: string;
  likes_24h: number;
  likes_total: number;
  followers: number;
  last_like_at: string | null;
};

export type VirtualSettings = {
  automation_enabled: boolean;
  per_post_max: number;
  max_post_age_hours: number;
  min_post_age_minutes: number;
  include_coach_posts: boolean;
};

export const listVirtualAccountsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ accounts: VirtualAccount[]; settings: VirtualSettings }> => {
    const { db, viewOnly } = await readClientFor(context as any);
    const call = (fn: string) => (viewOnly ? rpcRead(db, fn, {}) : (context.supabase as any).rpc(fn));
    const [a, s] = await Promise.all([call("admin_virtual_accounts"), call("admin_virtual_settings")]);
    if (a.error) throw new Error(a.error.message);
    if (s.error) throw new Error(s.error.message);
    return { accounts: (a.data ?? []) as VirtualAccount[], settings: s.data as VirtualSettings };
  });

export const virtualActivityFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(50) }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { db } = await readClientFor(context as any);
    let q = db
      .from("virtual_account_activity")
      .select("id, user_id, action, post_id, actor_user_id, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.userId) q = q.eq("user_id", data.userId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ id: number; user_id: string; action: string; post_id: string | null; actor_user_id: string | null; detail: any; created_at: string }>;
  });

/** Creates the starter accounts that don't exist yet (by username), words only. */
export const createStarterVirtualAccountsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data: existing, error } = await sb.rpc("admin_virtual_accounts");
    if (error) throw new Error(error.message);
    const have = new Set(((existing ?? []) as VirtualAccount[]).map((a) => a.slug));
    let made = 0;
    const skipped: string[] = [];
    for (const p of STARTER_PERSONAS) {
      if (have.has(p.slug)) continue;
      const { error: e } = await sb.rpc("admin_virtual_account_create", {
        _slug: p.slug,
        _first: p.first,
        _last: p.last,
        _bio: p.bio,
        _background: p.background,
        _disciplines: p.disciplines,
      });
      if (e) skipped.push(`${p.slug}: ${e.message}`);
      else made++;
    }
    return { made, skipped };
  });

export const updateVirtualAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        patch: z
          .object({
            first_name: z.string().min(1).max(40),
            last_name: z.string().max(40),
            bio: z.string().max(150),
            background: z.string().max(600),
            notes: z.string().max(600),
            disciplines: z.array(z.enum(["powerlifting", "bodybuilding", "strength", "glutes", "fitness"])).max(3),
            active: z.boolean(),
            likes_enabled: z.boolean(),
            daily_like_limit: z.number().int().min(0).max(20),
            quiet_start: z.number().int().min(0).max(23),
            quiet_end: z.number().int().min(0).max(23),
          })
          .partial(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_virtual_account_update", { _uid: data.userId, _patch: data.patch });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const clearVirtualLikesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: n, error } = await (context.supabase as any).rpc("admin_virtual_account_clear_likes", { _uid: data.userId });
    if (error) throw new Error(error.message);
    return { removed: Number(n ?? 0) };
  });

export const setVirtualSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        automation_enabled: z.boolean(),
        per_post_max: z.number().int().min(1).max(5),
        max_post_age_hours: z.number().int().min(6).max(96),
        min_post_age_minutes: z.number().int().min(5).max(240),
        include_coach_posts: z.boolean(),
      })
      .partial()
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: s, error } = await (context.supabase as any).rpc("admin_virtual_settings_set", { _patch: data });
    if (error) throw new Error(error.message);
    return s as VirtualSettings;
  });
