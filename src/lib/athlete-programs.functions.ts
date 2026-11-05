import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeTrainingDays } from "@/lib/member-plan-start.functions";
import type { WeekDay } from "@/lib/training-schedule";

const StartInput = z.object({
  planId: z.string().uuid(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  trainingDays: z.array(z.string().min(2).max(12)).max(7).optional(),
  confirmReplace: z.boolean().optional(),
});

/**
 * A member puts a program they own (built, or copied from the crew) on their
 * calendar. The block itself is written by athlete_program_start, as the
 * member (it checks the program is theirs, they're self-serve and have
 * access); then, like starting a library plan, the plan they started before
 * is archived (never deleted) and the workouts go onto their training days.
 */
export const startMyProgram = createServerFn({ method: "POST" })
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
      throw new Error("Your coach writes your program, so it can't be started here.");
    }
    const clientId = (client as any).id as string;

    const { data: program } = await (supabase as any)
      .from("athlete_programs")
      .select("id, title, days_per_week, owner_id, archived_at")
      .eq("id", data.planId)
      .maybeSingle();
    if (!program || program.owner_id !== userId || program.archived_at)
      throw new Error("Program not found.");

    const { data: current } = await supabaseAdmin
      .from("pl_blocks")
      .select("id, name, prep_id")
      .eq("client_id", clientId)
      .eq("created_by", userId)
      .eq("archived", false);
    const running = (current ?? []) as Array<{ id: string; name: string; prep_id: string | null }>;
    if (running.length && !data.confirmReplace) {
      return { conflict: true as const, currentName: running[0].name };
    }

    const committed = normalizeTrainingDays((client as any).committed_training_days);
    let days = normalizeTrainingDays(data.trainingDays);
    if (!days.length) days = committed;
    const perWeek = Number(program.days_per_week) || 0;
    if (perWeek && days.length && days.length !== perWeek) {
      throw new Error(
        `This program has ${perWeek} workouts a week. Pick ${perWeek} training days so each one has its own day.`,
      );
    }

    const startDate = data.startDate ?? new Date().toISOString().slice(0, 10);
    const { data: res, error } = await (supabase as any).rpc("athlete_program_start", {
      _id: program.id,
      _start: startDate,
    });
    if (error) throw new Error(error.message);
    const blockId = (res as any)?.block_id as string | undefined;

    // the program they started before makes way (archived, history kept), never the new one
    const old = running.filter((b) => b.id !== blockId);
    if (old.length) {
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("pl_blocks")
        .update({
          status: "Archived",
          archived: true,
          archived_at: now,
          archived_by: userId,
        } as any)
        .in(
          "id",
          old.map((b) => b.id),
        );
      const prepIds = Array.from(
        new Set(old.map((b) => b.prep_id).filter((x): x is string => !!x)),
      );
      if (prepIds.length) {
        await supabaseAdmin
          .from("pl_preps")
          .update({
            status: "Archived",
            archived: true,
            archived_at: now,
            archived_by: userId,
          } as any)
          .in("id", prepIds)
          .eq("created_by", userId);
      }
    }

    let unplaced = 0;
    try {
      const { realignClientToCommittedDays, writeCommittedDays } =
        await import("@/lib/schedule-bulk.functions");
      const changed =
        days.join() !== committed.join() || !(client as any).training_schedule_completed;
      if (days.length && changed) {
        await writeCommittedDays({ clientId, userId, role: "client", days: days as WeekDay[] });
      }
      const r = await realignClientToCommittedDays({
        clientId,
        userId,
        role: "client",
        includePinned: false,
      });
      unplaced = r.unplaced ?? 0;
    } catch (e) {
      console.error("[startMyProgram] schedule failed", e);
    }

    return { conflict: false as const, blockId: blockId ?? null, days, unplaced };
  });
