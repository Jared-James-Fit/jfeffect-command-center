/**
 * Member Management's server calls. Every read and write is a database function that checks the
 * caller itself (admins; the view-only admin login reads), run with the caller's own session, never
 * the service role. See 20270531090000_accounts_directory_badges_pov_virtual.sql.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readClientFor, rpcRead } from "@/lib/permissions.server";
import type { AccountRow, SyncIssueRow } from "@/lib/accounts/account-directory";

export type SyncRun = {
  ran_at: string;
  applied: boolean;
  accounts: number;
  issues: SyncIssueRow[];
  fixed: Array<{ issue: string; client_id?: string; member_id?: string; user_id?: string }>;
};

/** Every non-staff account, classified (admin_account_directory). */
export const listAccountDirectoryFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: AccountRow[] }> => {
    const { db, viewOnly } = await readClientFor(context as any);
    const { data, error } = viewOnly
      ? await rpcRead(db, "admin_account_directory", {})
      : await (context.supabase as any).rpc("admin_account_directory");
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as any[]).map((r) => ({
      ...r,
      workouts_30d: Number(r.workouts_30d ?? 0),
      issues: Array.isArray(r.issues) ? r.issues : [],
    })) as AccountRow[];
    return { rows };
  });

/** The last check (what the sync status shows when nothing's been run on this visit). */
export const lastAccountSyncFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncRun | null> => {
    const { db } = await readClientFor(context as any);
    const { data, error } = await db
      .from("account_sync_runs")
      .select("ran_at, applied, accounts, issues, fixed")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as SyncRun | null) ?? null;
  });

/** Check every account (and with `apply`, make the safe fixes). Admins only. */
export const reconcileAccountsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ apply: z.boolean().default(false) }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_account_reconcile", { _apply: data.apply });
    if (error) throw new Error(error.message);
    return out as { checked_at: string; accounts: number; issues: SyncIssueRow[]; fixed: SyncRun["fixed"] };
  });

/** A login with no athlete record, made a free member by the admin's decision. */
export const makeFreeMemberFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: out, error } = await (context.supabase as any).rpc("admin_account_make_free_member", { _uid: data.userId });
    if (error) throw new Error(error.message);
    const status = (out as any)?.status as string;
    if (status !== "member") {
      const why: Record<string, string> = {
        unconfirmed: "Their email was never confirmed, so the login can't be used yet.",
        staff: "That's a team login.",
        virtual: "That's a virtual account.",
        athlete: "They already have an athlete record.",
        no_user: "That login no longer exists.",
      };
      throw new Error(why[status] ?? "Couldn't make them a member.");
    }
    return out as { status: "member"; member_id: string; client_id: string };
  });

/** Mark an account real, test or demo ('auto' goes back to the rules). */
export const setAccountClassFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        accountClass: z.enum(["real", "test", "demo", "auto"]),
        note: z.string().max(300).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_account_set_class", {
      _uid: data.userId,
      _class: data.accountClass,
      _note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
