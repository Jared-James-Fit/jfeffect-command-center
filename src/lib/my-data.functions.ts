/**
 * Self-serve data rights: download everything we hold about your training,
 * and ask for your account to be deleted (30-day hold, cancellable).
 *
 * The export runs on the caller's own RLS-scoped client, so it can only ever
 * contain the caller's rows.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PAGE = 1000;

/** Read every page of a query (PostgREST returns at most 1,000 rows). */
export async function fetchAllRows(make: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? String(error));
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Run one export section; a failing section is noted instead of failing the export. */
async function section<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

export async function buildMyDataExport(supabase: any, userId: string) {
  const { data: clients } = await supabase.from("clients").select("*").eq("user_id", userId);
  const { data: member } = await supabase.from("app_members").select("*").eq("user_id", userId).maybeSingle();
  const clientIds: string[] = (clients ?? []).map((c: any) => c.id);
  const byClient = (table: string, order: string) =>
    clientIds.length
      ? fetchAllRows((a, b) => supabase.from(table).select("*").in("client_id", clientIds).order(order, { ascending: true }).range(a, b))
      : Promise.resolve([]);

  return {
    exported_at: new Date().toISOString(),
    account: { user_id: userId, clients: clients ?? [], member: member ?? null },
    workouts: {
      completions: await section(() => byClient("pl_day_completions", "created_at")),
      sets: await section(() => byClient("pl_row_results", "created_at")),
    },
    personal_records: await section(async () => {
      const out: any[] = [];
      for (const id of clientIds) {
        const { data, error } = await supabase.rpc("client_recent_records", { _client_id: id, _since: "1970-01-01T00:00:00Z" });
        if (error) throw new Error(error.message);
        out.push({ client_id: id, ...(data ?? {}) });
      }
      return out;
    }),
    bodyweight: {
      logs: await section(() =>
        fetchAllRows((a, b) => supabase.from("progress_bodyweight").select("*").eq("user_id", userId).order("logged_date", { ascending: true }).range(a, b))),
      legacy_metrics: await section(() => byClient("progress_metrics", "entry_date")),
      member_logs: member
        ? await section(() =>
            fetchAllRows((a, b) => supabase.from("member_bodyweight_logs").select("*").eq("member_id", member.id).range(a, b)))
        : [],
    },
    check_ins: {
      submissions: await section(() =>
        fetchAllRows((a, b) => supabase.from("progress_submissions").select("*").eq("user_id", userId).order("created_at", { ascending: true }).range(a, b))),
      weekly_threads: await section(() => byClient("weekly_checkin_threads", "created_at")),
    },
    member_training: member
      ? {
          completions: await section(() =>
            fetchAllRows((a, b) => supabase.from("member_workout_completions").select("*, member_plan_enrollments!inner(member_id)").eq("member_plan_enrollments.member_id", member.id).range(a, b))),
          sets: await section(() =>
            fetchAllRows((a, b) => supabase.from("member_set_logs").select("*, member_plan_enrollments!inner(member_id)").eq("member_plan_enrollments.member_id", member.id).range(a, b))),
        }
      : null,
  };
}

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    return buildMyDataExport(supabase, userId);
  });

export const getMyDeletionRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("account_deletion_requests")
      .select("id, requested_at, delete_after, status")
      .eq("user_id", userId)
      .eq("status", "pending")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  });

export const requestAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reason: z.string().trim().max(1000).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    // The database sets requested_at / delete_after (now + 30 days) itself.
    const { data: row, error } = await supabase
      .from("account_deletion_requests")
      .insert({ user_id: userId, reason: data.reason || null })
      .select("id, requested_at, delete_after, status")
      .single();
    if (error) {
      if ((error as any).code === "23505") throw new Error("You already have a deletion request pending.");
      throw new Error(error.message);
    }
    return row;
  });

export const cancelAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("account_deletion_requests")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: pending deletion requests, soonest due first. */
export const listDeletionRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (isAdmin !== true) throw new Error("Forbidden: admin only");
    const { data: rows, error } = await supabase
      .from("account_deletion_requests")
      .select("id, user_id, requested_at, delete_after, reason")
      .eq("status", "pending")
      .order("delete_after", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: any) => r.user_id);
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("id, email, full_name").in("id", ids)
      : { data: [] as any[] };
    const byId = new Map<string, any>((profiles ?? []).map((p: any) => [p.id, p]));
    return (rows ?? []).map((r: any) => ({ ...r, email: byId.get(r.user_id)?.email ?? null, full_name: byId.get(r.user_id)?.full_name ?? null }));
  });
