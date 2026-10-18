import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertMemberCanReadProtected } from "@/lib/jf-access.server";
import type { WeekDay } from "@/lib/training-schedule";

const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** "Mon" / "monday" / "Monday" → "Monday" (committed training days store full names). */
export function normalizeTrainingDays(days: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const d of days ?? []) {
    const k = String(d).trim().toLowerCase().slice(0, 3);
    const full = FULL_DAYS.find((f) => f.toLowerCase().startsWith(k));
    if (full && !out.includes(full)) out.push(full);
  }
  return FULL_DAYS.filter((f) => out.includes(f));
}

const StartInput = z.object({
  planId: z.string().uuid(),
  /** yyyy-mm-dd; defaults to today */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  trainingDays: z.array(z.string().min(2).max(12)).max(7).optional(),
  /** they already run a plan they started: replace it (it's archived, history kept) */
  confirmReplace: z.boolean().optional(),
});

/**
 * A JF member starts a library plan. Same engine as a coach assigning a
 * program: the plan's template is copied into the member's own program
 * (pl_blocks), so logging, PRs, analytics and history all just work. The
 * member owns what they started (created_by), which is how a plan they
 * picked is told apart from one a coach wrote. A plan they started before is
 * archived once the new one exists (never deleted: its history stays).
 */
export const startLibraryPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => StartInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, service_tier, committed_training_days, training_schedule_completed")
      .eq("user_id", userId)
      .maybeSingle();
    if (!client || (client as any).service_tier !== "self_serve") {
      throw new Error("Starting a library plan is part of JF Membership. Your coach builds your program.");
    }
    await assertMemberCanReadProtected(supabase, userId);

    const { data: plan } = await supabaseAdmin
      .from("member_plans")
      .select("id, name, public_title, source_template_id, status, membership_status, imports_count, days_per_week")
      .eq("id", data.planId)
      .maybeSingle();
    const p = plan as any;
    if (!p || p.status !== "Published" || p.membership_status !== "live" || !p.source_template_id) {
      throw new Error("This plan isn't available right now.");
    }

    // a plan they started earlier makes way (asked first)
    const { data: current } = await supabaseAdmin
      .from("pl_blocks")
      .select("id, name, prep_id")
      .eq("client_id", (client as any).id)
      .eq("created_by", userId)
      .eq("archived", false);
    const running = (current ?? []) as Array<{ id: string; name: string; prep_id: string | null }>;
    if (running.length && !data.confirmReplace) {
      return { conflict: true as const, currentName: running[0].name };
    }

    // the days the plan runs on: the ones they picked, else their committed
    // schedule (the setup wizard's copy on app_members if the client row has none)
    const committed = normalizeTrainingDays((client as any).committed_training_days);
    let days = normalizeTrainingDays(data.trainingDays);
    if (!days.length) days = committed;
    if (!days.length) {
      const { data: member } = await supabaseAdmin
        .from("app_members")
        .select("committed_training_days")
        .eq("user_id", userId)
        .maybeSingle();
      days = normalizeTrainingDays((member as any)?.committed_training_days);
    }
    // every workout of the week gets its own day, or the extras land off their schedule
    const perWeek = Number(p.days_per_week) || 0;
    if (perWeek && days.length && days.length !== perWeek) {
      throw new Error(`This plan has ${perWeek} workouts a week. Pick ${perWeek} training days so each one has its own day.`);
    }

    const startDate = data.startDate ?? new Date().toISOString().slice(0, 10);
    // as the member: the assign RPC lets a self-serve member start a live library plan on their own row
    const { data: res, error } = await (supabase as any).rpc("pl_assign_template_to_client", {
      p_template_id: p.source_template_id,
      p_client_id: (client as any).id,
      p_placement: { mode: "standalone_block" },
      p_name: p.public_title || p.name,
      p_client_visible: true,
      p_start_date: startDate,
      p_end_date: null,
      p_selected_block_ids: null,
      p_start_from_block_id: null,
    });
    if (error) throw new Error(error.message);
    const result = (res ?? {}) as { block_id?: string; prep_id?: string };

    // the member owns what they started
    if (result.prep_id) {
      await supabaseAdmin.from("pl_preps").update({ created_by: userId } as any).eq("id", result.prep_id);
      await supabaseAdmin.from("pl_blocks").update({ created_by: userId } as any).eq("prep_id", result.prep_id);
    } else if (result.block_id) {
      await supabaseAdmin.from("pl_blocks").update({ created_by: userId } as any).eq("id", result.block_id);
    }

    // only now (the new plan exists) does the one they started before make way
    if (running.length) {
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("pl_blocks")
        .update({ status: "Archived", archived: true, archived_at: now, archived_by: userId } as any)
        .in("id", running.map((b) => b.id));
      const prepIds = Array.from(new Set(running.map((b) => b.prep_id).filter((x): x is string => !!x)));
      if (prepIds.length) {
        await supabaseAdmin
          .from("pl_preps")
          .update({ status: "Archived", archived: true, archived_at: now, archived_by: userId } as any)
          .in("id", prepIds)
          .eq("created_by", userId);
      }
    }

    // the plan's days become their committed schedule (one schedule, so the
    // calendar, Home and reminders agree), then every workout goes onto them
    // (no days at all: the template's own pattern)
    let unplaced = 0;
    try {
      const { realignClientToCommittedDays, writeCommittedDays } = await import("@/lib/schedule-bulk.functions");
      const changed = days.join() !== committed.join() || !(client as any).training_schedule_completed;
      if (days.length && changed) {
        await writeCommittedDays({ clientId: (client as any).id, userId, role: "client", days: days as WeekDay[] });
      }
      const res = await realignClientToCommittedDays({ clientId: (client as any).id, userId, role: "client", includePinned: false });
      unplaced = res.unplaced ?? 0;
    } catch (e) {
      console.error("[startLibraryPlan] schedule failed", e);
    }

    // library stats for the admin
    try {
      const { data: member } = await supabaseAdmin.from("app_members").select("id").eq("user_id", userId).maybeSingle();
      if ((member as any)?.id) {
        await supabaseAdmin.from("member_plan_events").insert({
          plan_id: p.id,
          member_id: (member as any).id,
          actor_user_id: userId,
          event_type: "import",
          metadata: { engine: "pl", block_id: result.block_id ?? null, prep_id: result.prep_id ?? null, replaced: running.length },
        } as any);
      }
      await supabaseAdmin.from("member_plans").update({ imports_count: (p.imports_count ?? 0) + 1 } as any).eq("id", p.id);
    } catch (e) {
      console.error("[startLibraryPlan] stats failed", e);
    }

    return { conflict: false as const, blockId: result.block_id ?? null, prepId: result.prep_id ?? null, days, unplaced };
  });

/** The plan a member is running, if they started one (for the library's "Current plan" badge). */
export const getMyStartedPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: client } = await supabase.from("clients").select("id").eq("user_id", userId).maybeSingle();
    if (!client) return { templateIds: [] as string[], name: null as string | null };
    const { data: blocks } = await supabase
      .from("pl_blocks")
      .select("name, source_template_id")
      .eq("client_id", (client as any).id)
      .eq("created_by", userId)
      .eq("archived", false);
    const rows = (blocks ?? []) as Array<{ name: string; source_template_id: string | null }>;
    return {
      templateIds: Array.from(new Set(rows.map((b) => b.source_template_id).filter((x): x is string => !!x))),
      name: rows[0]?.name ?? null,
    };
  });
