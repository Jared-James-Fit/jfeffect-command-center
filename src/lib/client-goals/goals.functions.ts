import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientGoalsSetupSchema, EDITABLE_GOALS_FIELDS } from "@/lib/client-goals/schema";
import { goalsForSchedule, scheduleForGoalsSave, weekOrder } from "@/lib/client-goals/schedule-sync";
import { WEEK_DAYS } from "@/lib/training-schedule";

const clientIdInput = z.object({ clientId: z.string().uuid() });

const saveGoalsSetupInput = z.object({
  clientId: z.string().uuid(),
  patch: clientGoalsSetupSchema.partial().extend({ completed: z.boolean().optional() }),
  /** The exact training days picked in Goals & Setup ("Monday"…): saved as the program schedule. */
  trainingDays: z.array(z.enum(WEEK_DAYS)).min(1).max(7).optional(),
});

/** What a Goals & Setup save did to the program schedule (null: it stayed as it was). */
export type GoalsScheduleResult = {
  days: string[];
  applied: number;
  unplaced: number;
  realignError: string | null;
} | null;

async function assertCoachOrAdmin(ctx: any, clientId: string) {
  // admin or coach role, or assigned coach for this client.
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId, _role: "admin",
  });
  if (isAdmin) return;
  const { data: isAssigned } = await ctx.supabase.rpc("is_assigned_coach_for_client", {
    _client_id: clientId,
  });
  if (isAssigned) return;
  throw new Error("Forbidden");
}

async function assertClientOwnerOrCoachOrAdmin(ctx: any, clientId: string) {
  const { data: isOwner } = await ctx.supabase.rpc("is_client_owner", {
    _client_id: clientId,
  });
  if (isOwner) return;
  await assertCoachOrAdmin(ctx, clientId);
}

/** Save a client's Goals & Setup answers after confirming the caller is allowed to edit them. */
export const saveGoalsSetupFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => saveGoalsSetupInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertClientOwnerOrCoachOrAdmin(context, data.clientId);

    const { completed, ...patch } = data.patch;
    // Strict whitelist — never trust the client to send server-owned
    // columns (id/timestamps/audit). This is a defence in depth on top
    // of the zod validator above.
    const body: Record<string, unknown> = { client_id: data.clientId };
    for (const key of EDITABLE_GOALS_FIELDS) {
      if (key in patch) body[key] = (patch as any)[key];
    }
    if (completed) {
      body.completed_at = new Date().toISOString();
      // Clearing any pending "please update" banner is also handled by the
      // BEFORE trigger, but set it here too so a stale client cache reflects
      // the change immediately on refetch.
      body.update_requested_at = null;
      body.update_requested_by = null;
      body.update_request_message = null;
    }

    // Defence in depth: scrub conditional details when the user said "No".
    if (body.food_restrictions_has === false) body.food_restrictions_details = null;
    if (body.injuries_has === false) body.injuries_details = null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [storedRes, clientRes] = await Promise.all([
      supabaseAdmin
        .from("client_goals_setup")
        .select("client_id, training_days_per_week, available_weekdays")
        .eq("client_id", data.clientId)
        .maybeSingle(),
      supabaseAdmin.from("clients").select("committed_training_days").eq("id", data.clientId).maybeSingle(),
    ]);
    if (storedRes.error || clientRes.error) {
      console.error("[saveGoalsSetupFn] read failed", { clientId: data.clientId, error: storedRes.error ?? clientRes.error });
      throw new Error("We couldn't save your answers. Please try again.");
    }
    const stored = storedRes.data as { training_days_per_week: number | null; available_weekdays: string[] | null } | null;

    // "Days a week" and "which days" are the program schedule: the days asked
    // for become the committed schedule below, and Goals always says what the
    // schedule is (a DB trigger keeps it so when the schedule changes elsewhere).
    const live = weekOrder((clientRes.data as { committed_training_days: string[] | null } | null)?.committed_training_days);
    const desired = scheduleForGoalsSave({
      live,
      stored,
      patch: body as { training_days_per_week?: number | null; available_weekdays?: string[] | null },
      trainingDays: data.trainingDays,
    });
    const synced = goalsForSchedule(
      desired ?? live,
      ("available_weekdays" in body ? body.available_weekdays : stored?.available_weekdays) as string[] | null,
    );
    if (synced) {
      body.training_days_per_week = synced.training_days_per_week;
      body.available_weekdays = synced.available_weekdays;
    }

    // Update the row when it exists: an upsert also runs the INSERT trigger,
    // which logged a "(created)" audit line and re-touched the coach's task on
    // every save.
    const { client_id: _clientId, ...changes } = body;
    let error: { code?: string; message?: string } | null = null;
    if (stored) {
      ({ error } = await supabaseAdmin.from("client_goals_setup").update(changes as any).eq("client_id", data.clientId));
    } else {
      ({ error } = await supabaseAdmin.from("client_goals_setup").insert(body as any));
      if (error?.code === "23505") {
        // Saved from another tab a moment ago: update that row instead.
        ({ error } = await supabaseAdmin.from("client_goals_setup").update(changes as any).eq("client_id", data.clientId));
      }
    }
    if (error) {
      // Log raw error for ops; return a safe, human message to the client.
      console.error("[saveGoalsSetupFn] save failed", {
        clientId: data.clientId, error,
      });
      throw new Error("We couldn't save your answers. Please try again.");
    }

    let schedule: GoalsScheduleResult = null;
    if (desired) {
      const { resolveActorAccess, writeCommittedDays, realignClientToCommittedDays } = await import(
        "@/lib/schedule-bulk.functions"
      );
      try {
        const { role } = await resolveActorAccess({ supabase: context.supabase, userId: context.userId }, data.clientId);
        await writeCommittedDays({ clientId: data.clientId, userId: context.userId, role, days: desired });
        try {
          // New days are the instruction to move every upcoming, unstarted
          // workout onto them (the Training Schedule card's save does the same).
          const res = await realignClientToCommittedDays({
            clientId: data.clientId, userId: context.userId, role, includePinned: true,
          });
          schedule = { days: desired, applied: res.applied ?? 0, unplaced: res.unplaced ?? 0, realignError: null };
        } catch (e: any) {
          schedule = {
            days: desired, applied: 0, unplaced: 0,
            realignError: (e?.message as string) || "Could not update the workout calendar.",
          };
        }
      } catch (e: any) {
        console.error("[saveGoalsSetupFn] schedule write failed", { clientId: data.clientId, error: e?.message ?? e });
        // Thrown so the answers stay on the device and the next save tries again.
        throw new Error("Your answers saved, but your training days didn't update. Please try again.");
      }
    }
    return { ok: true, schedule };
  });

/** Mark the client's Goals & Setup as reviewed by the current coach/admin. */
export const markGoalsReviewedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => clientIdInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertCoachOrAdmin(context, data.clientId);
    const { error } = await context.supabase
      .from("client_goals_setup")
      .update({
        last_reviewed_at: new Date().toISOString(),
        last_reviewed_by: context.userId,
      } as any)
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Coach/admin asks the client to update their Goals & Setup. */
export const requestGoalsUpdateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      clientId: z.string().uuid(),
      message: z.string().trim().max(500).optional().nullable(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertCoachOrAdmin(context, data.clientId);
    // Make sure a row exists so the banner condition works in the portal.
    await context.supabase
      .from("client_goals_setup")
      .upsert(
        {
          client_id: data.clientId,
          update_requested_at: new Date().toISOString(),
          update_requested_by: context.userId,
          update_request_message: data.message ?? null,
        } as any,
        { onConflict: "client_id" },
      );
    return { ok: true };
  });

/** Clear the "update requested" flag once the client acknowledges it. */
export const clearGoalsUpdateRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => clientIdInput.parse(data))
  .handler(async ({ data, context }) => {
    // Either the client owner or the coach/admin can clear it.
    const { error } = await context.supabase
      .from("client_goals_setup")
      .update({
        update_requested_at: null,
        update_requested_by: null,
        update_request_message: null,
      } as any)
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
/** Fetch the signed-in member's own Goals & Setup row. Returns null when no client record exists. */
export const getMyGoalsSetupFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!client) return { goals: null as any };
    const { data: goals } = await supabase
      .from("client_goals_setup")
      .select("main_goal, training_days_per_week, workout_length_minutes, training_experience, training_styles, training_location, equipment, completed_at")
      .eq("client_id", (client as any).id)
      .maybeSingle();
    return { goals: goals ?? null };
  });

/** Fetch any client's Goals & Setup row (admin/coach only). Used by the admin program builder to power Recommended-for-Client. */
export const getClientGoalsSetupFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => clientIdInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertCoachOrAdmin(context, data.clientId);
    const { data: goals } = await context.supabase
      .from("client_goals_setup")
      .select("main_goal, training_days_per_week, workout_length_minutes, training_experience, training_styles, training_location, equipment, completed_at")
      .eq("client_id", data.clientId)
      .maybeSingle();
    return { goals: goals ?? null };
  });
