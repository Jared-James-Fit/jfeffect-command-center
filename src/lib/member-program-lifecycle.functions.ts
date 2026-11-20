import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeTrainingDays } from "@/lib/member-plan-start.functions";
import type { WeekDay } from "@/lib/training-schedule";

/**
 * A JF member's program lifecycle beyond starting one (member-plan-start /
 * athlete-programs functions start one): resume a program from their program
 * history, and undo a start right after it. The database does the program
 * part as the member (member_program_resume / member_program_undo_start:
 * their own blocks only, never deleting anything logged, the program on their
 * calendar now moving to the history); then, like starting a program, the
 * workouts go onto their training days (realignClientToCommittedDays).
 */

async function placeOnTrainingDays(clientId: string, userId: string): Promise<number> {
  try {
    const { realignClientToCommittedDays } = await import("@/lib/schedule-bulk.functions");
    const r = await realignClientToCommittedDays({
      clientId,
      userId,
      role: "client",
      includePinned: false,
    });
    return r.unplaced ?? 0;
  } catch (e) {
    console.error("[member-program-lifecycle] schedule failed", e);
    return 0;
  }
}

async function selfServeClient(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, service_tier, committed_training_days, training_schedule_completed")
    .eq("user_id", userId)
    .maybeSingle();
  if (!client || (client as any).service_tier !== "self_serve") {
    throw new Error("Your coach writes your program, so it can't be changed here.");
  }
  return client as {
    id: string;
    committed_training_days: string[] | null;
    training_schedule_completed: boolean | null;
  };
}

const ResumeInput = z.object({
  /** the program's history key (member_program_history) */
  key: z.string().uuid(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  trainingDays: z.array(z.string().min(2).max(12)).max(7).optional(),
});

/** Put a past program back on the calendar where they left off. */
export const resumeMyProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ResumeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = await selfServeClient(userId);

    // the days they picked become their training schedule first, so the
    // program is re-dated against them
    const committed = normalizeTrainingDays(client.committed_training_days);
    const days = normalizeTrainingDays(data.trainingDays);
    if (days.length && (days.join() !== committed.join() || !client.training_schedule_completed)) {
      const { writeCommittedDays } = await import("@/lib/schedule-bulk.functions");
      await writeCommittedDays({
        clientId: client.id,
        userId,
        role: "client",
        days: days as WeekDay[],
      });
    }

    const { data: res, error } = await (supabase as any).rpc("member_program_resume", {
      _key: data.key,
      _start: data.startDate ?? null,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { name?: string; next_day_id?: string; replaced?: number };

    const unplaced = await placeOnTrainingDays(client.id, userId);
    const { data: next } = r.next_day_id
      ? await supabaseAdmin
          .from("pl_days")
          .select("scheduled_date")
          .eq("id", r.next_day_id)
          .maybeSingle()
      : { data: null };
    return {
      name: r.name ?? null,
      nextDate: ((next as any)?.scheduled_date as string | null) ?? null,
      replaced: r.replaced ?? 0,
      unplaced,
    };
  });

const UndoInput = z.object({
  /** a block of the program that was just started */
  blockId: z.string().uuid(),
  /** the program it replaced (its history key), to bring back */
  restoreKey: z.string().uuid().nullable().optional(),
  /** their training days before the start changed them */
  previousDays: z.array(z.string().min(2).max(12)).max(7).nullable().optional(),
});

/**
 * Undo a start right after it: the program just started goes (only while
 * nothing in it is opened or logged), the one it replaced comes back as it
 * was, and their training days go back to what they were.
 */
export const undoProgramStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UndoInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const client = await selfServeClient(userId);

    const before = normalizeTrainingDays(data.previousDays ?? []);
    if (
      before.length &&
      before.join() !== normalizeTrainingDays(client.committed_training_days).join()
    ) {
      const { writeCommittedDays } = await import("@/lib/schedule-bulk.functions");
      await writeCommittedDays({
        clientId: client.id,
        userId,
        role: "client",
        days: before as WeekDay[],
      });
    }

    const { data: res, error } = await (supabase as any).rpc("member_program_undo_start", {
      _block_id: data.blockId,
      _restore_key: data.restoreKey ?? null,
    });
    if (error) throw new Error(error.message);
    await placeOnTrainingDays(client.id, userId);
    const restored = (res as any)?.restored as { name?: string } | null;
    return { restored: restored?.name ?? null };
  });
