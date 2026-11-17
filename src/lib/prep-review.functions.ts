/**
 * The coach's meet-prep review on a client's Training tab (prep-review.server.ts):
 * the block Training Maxes against their sets, the calibration read for a missing
 * one, and the lift-by-lift taper once the lifting day is confirmed. Reads and
 * writes go through the caller's own session (RLS decides; admins and the
 * client's coach). A Training Max changes, or a session moves, only here, on a
 * coach's tap: never from a job or a model.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadPrepReview, previewMeetDay, TM_LIFT_NAME } from "@/lib/prep-review.server";
import { isCompetitionMaxName } from "@/lib/workouts/load-reference";

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function assertCoach(supabase: any, userId: string, clientId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if ((roles ?? []).some((r: any) => r.role === "admin")) return;
  const { data: ok } = await supabase.rpc("is_assigned_coach", { _client_id: clientId });
  if (!ok) throw new Error("Not authorized for this client");
}

export const getPrepReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid(), today: ISO }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertCoach(supabase, userId, data.clientId);
    return loadPrepReview(supabase, data.clientId, data.today);
  });

export const previewMeetDayFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid(), prepId: z.string().uuid(), day: ISO, today: ISO }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertCoach(supabase, userId, data.clientId);
    return previewMeetDay(supabase, data.clientId, data.prepId, data.day, data.today);
  });

/**
 * Confirms the lifting day. "lift": the lift-by-lift plan, worked out again here
 * (never the phone's copy); "even": every taper session keeps its distance from
 * the meet. pl_prep_set_meet_day checks every rule again before it moves anything.
 */
export const applyMeetDayFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ clientId: z.string().uuid(), prepId: z.string().uuid(), day: ISO, today: ISO, plan: z.enum(["lift", "even"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertCoach(supabase, userId, data.clientId);
    let moves: Array<{ day_id: string; date: string }> | null = null;
    if (data.plan === "lift") {
      const p = await previewMeetDay(supabase, data.clientId, data.prepId, data.day, data.today);
      moves = p.plan.sessions.map((s) => ({ day_id: s.dayId, date: s.planned }));
    }
    const { data: out, error } = await supabase.rpc("pl_prep_set_meet_day", {
      _prep: data.prepId,
      _day: data.day,
      _apply: true,
      _moves: moves,
    });
    if (error) throw new Error(error.message);
    return out as { moved: number; plan: string };
  });

/**
 * Sets a competition lift's block Training Max on this block and every later one
 * in the prep (a block row is added where there's none). The coach's call, with
 * the reason kept in its notes.
 */
export const setPrepTrainingMaxFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        prepId: z.string().uuid(),
        fromBlockId: z.string().uuid(),
        lift: z.enum(["squat", "bench", "deadlift"]),
        kg: z.number().min(20).max(500),
        note: z.string().max(600),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertCoach(supabase, userId, data.clientId);
    const kg = Math.round(data.kg / 2.5) * 2.5;
    const { data: blocks, error } = await supabase
      .from("pl_blocks")
      .select("id, start_date, sort_order")
      .eq("prep_id", data.prepId)
      .eq("client_id", data.clientId)
      .eq("archived", false)
      .order("sort_order");
    if (error) throw new Error(error.message);
    const from = (blocks ?? []).find((b: any) => b.id === data.fromBlockId);
    if (!from) throw new Error("That block isn't part of this prep.");
    const targets = (blocks ?? []).filter((b: any) => (b.start_date ?? "") >= (from.start_date ?? "") );
    let written = 0;
    for (const b of targets) {
      const { data: rows } = await supabase
        .from("pl_client_maxes")
        .select("id, lift")
        .eq("client_id", data.clientId)
        .eq("block_id", b.id);
      const mine = (rows ?? []).find((r: any) => isCompetitionMaxName(String(r.lift ?? ""), data.lift));
      if (mine) {
        const { error: ue } = await supabase
          .from("pl_client_maxes")
          .update({ training_max: kg, unit: "kg", notes: data.note, active: true })
          .eq("id", mine.id);
        if (ue) throw new Error(ue.message);
      } else {
        const { error: ie } = await supabase.from("pl_client_maxes").insert({
          client_id: data.clientId,
          block_id: b.id,
          lift: TM_LIFT_NAME[data.lift],
          training_max: kg,
          unit: "kg",
          source: "manual",
          rounding_step: 2.5,
          active: true,
          notes: data.note,
        });
        if (ie) throw new Error(ie.message);
      }
      written++;
    }
    return { kg, blocks: written };
  });
