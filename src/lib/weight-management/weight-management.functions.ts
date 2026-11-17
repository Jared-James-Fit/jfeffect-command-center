/**
 * The coach's weight-management card: read the assessment (with the coach's
 * own login, so RLS decides which client they may see), set the goal and
 * the few settings the records can't tell, and approve or dismiss what the
 * engine recommends. Approving writes exactly what was shown, never more,
 * and records the before and after on the review. Staff only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Assessment } from "@/lib/weight-management/assessment";
import type { Json } from "@/integrations/supabase/types";

const server = () => import("@/lib/weight-management/reviews.server");
const loader = () => import("@/lib/weight-management/load.server");

async function isStaff(supabase: any, userId: string) {
  const [{ data: a }, { data: c }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  return !!a || !!c;
}

export type WeightReviewRow = {
  id: string;
  hash: string;
  created_at: string;
  source: "checkin" | "coach";
  verdict: string;
  headline: string;
  material: boolean;
  status: "open" | "approved" | "dismissed" | "superseded" | "noted";
  decided_at: string | null;
  decision_note: string | null;
  applied: Json | null;
};

export type WeightManagementView = {
  assessment: Assessment;
  firstName: string;
  hasLogin: boolean;
  goalUnit: "kg" | "lb" | null;
  /** The coach's bodyweight goal as typed, in goalUnit. */
  goal: { type: "lose" | "gain" | "maintain" | "performance_cut" | "custom" | null; value: number | null; valueMax: number | null; date: string | null };
  refs: { trainingCardioId: string | null; restCardioId: string | null; planId: string | null; water: { activeMl: number; trainingExtraMl: number | null; source: string } | null };
  profile: { speed_unit: string | null; climate: string | null; sweat_level: string | null; max_incline: number | null; max_session_minutes: number | null; meet_importance: string | null } | null;
  reviews: WeightReviewRow[];
  /** Weigh-ins in kg, the last 6 months, for the chart. */
  series: Array<{ date: string; kg: number }>;
};

const clientIdSchema = z.object({ clientId: z.string().uuid() });
const sixMonthsBefore = (today: string) => new Date(Date.parse(`${today}T00:00:00Z`) - 183 * 86_400_000).toISOString().slice(0, 10);

export const getWeightManagementFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => clientIdSchema.parse(d))
  .handler(async ({ data, context }): Promise<WeightManagementView> => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const loaded = await (await loader()).loadWeightManagement(context.supabase, data.clientId);
    const { data: reviews } = await context.supabase
      .from("weight_management_reviews")
      .select("id, hash, created_at, source, verdict, headline, material, status, decided_at, decision_note, applied")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(12);
    const p = loaded.refs.profile as any;
    return {
      assessment: loaded.assessment,
      firstName: loaded.client.firstName,
      hasLogin: !!loaded.client.userId,
      goalUnit: loaded.client.goalUnit,
      goal: loaded.client.goal,
      refs: {
        trainingCardioId: loaded.refs.trainingCardioId,
        restCardioId: loaded.refs.restCardioId,
        planId: loaded.refs.planId,
        water: loaded.refs.waterTarget ? { activeMl: loaded.refs.waterTarget.active_ml, trainingExtraMl: loaded.refs.waterTarget.training_extra_ml, source: loaded.refs.waterTarget.target_source } : null,
      },
      profile: p
        ? { speed_unit: p.speed_unit ?? null, climate: p.climate ?? null, sweat_level: p.sweat_level ?? null, max_incline: p.max_incline != null ? Number(p.max_incline) : null, max_session_minutes: p.max_session_minutes ?? null, meet_importance: p.meet_importance ?? null }
        : null,
      reviews: (reviews ?? []) as WeightReviewRow[],
      series: loaded.input.weighIns.filter((p) => p.date >= sixMonthsBefore(loaded.assessment.today)),
    };
  });

/** The bodyweight goal (clients.bodyweight_goal_*), now with the date it's for. */
export const saveWeightGoalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        type: z.enum(["lose", "gain", "maintain", "performance_cut", "custom"]).nullable(),
        value: z.number().min(20).max(800).nullable(),
        valueMax: z.number().min(20).max(800).nullable().optional(),
        unit: z.enum(["kg", "lb"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const clear = data.type == null || data.value == null;
    const { error } = await context.supabase
      .from("clients")
      .update({
        bodyweight_goal_type: clear ? null : data.type,
        bodyweight_goal_value: clear ? null : data.value,
        bodyweight_goal_value_max: clear ? null : (data.valueMax ?? null),
        bodyweight_goal_unit: clear ? null : data.unit,
        bodyweight_goal_date: clear ? null : data.date,
        bodyweight_goal_set_at: clear ? null : new Date().toISOString(),
      })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveWeightProfileFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        speed_unit: z.enum(["mph", "kmh"]).nullable(),
        climate: z.enum(["temperate", "hot"]).nullable(),
        sweat_level: z.enum(["light", "average", "heavy"]).nullable(),
        max_incline: z.number().min(0).max(40).nullable(),
        max_session_minutes: z.number().int().min(10).max(180).nullable(),
        meet_importance: z.enum(["primary", "tune_up"]).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const { clientId, ...fields } = data;
    const { error } = await context.supabase.from("weight_management_profiles").upsert({ client_id: clientId, ...fields, updated_by: context.userId }, { onConflict: "client_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const sessionSchema = z
  .object({
    minutes: z.number().int().min(5).max(120),
    speedMph: z.number().min(1).max(8),
    inclinePct: z.number().min(0).max(40),
    perWeek: z.number().int().min(0).max(7),
    weekdays: z.array(z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])).max(7),
  })
  .nullable();

/**
 * Put a cardio plan on the client: the engine's step (from a review) or the
 * coach's own edit of the treadmill prescription. Either way it's the coach's
 * explicit choice, recorded on a review with what it replaced.
 */
export const saveCardioPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        reviewId: z.string().uuid().nullable().optional(),
        plan: z.object({ trainingDay: sessionSchema, restDay: sessionSchema }),
        /** The coach is switching a non-treadmill plan to a treadmill. */
        switchToTreadmill: z.boolean().optional(),
        note: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const s = await server();
    const loaded = await (await loader()).loadWeightManagement(context.supabase, data.clientId);
    const treadmill = loaded.assessment.cardio.modality === "treadmill" || !!data.switchToTreadmill;
    const applied = await s.writeCardioPlan(context.supabase, { clientId: data.clientId, refs: loaded.refs, plan: data.plan, treadmill, today: loaded.assessment.today });
    await recordDecision(context, data.clientId, loaded.assessment, data.reviewId ?? null, "approved", applied, data.note ?? null);
    return { ok: true, changed: applied.length };
  });

/** The engine's water target (day off, and how much more a training day is), as the coach's. */
export const saveWaterTargetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        reviewId: z.string().uuid().nullable().optional(),
        restMl: z.number().int().min(1000).max(6000),
        trainingExtraMl: z.number().int().min(0).max(3000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const loaded = await (await loader()).loadWeightManagement(context.supabase, data.clientId);
    if (!loaded.client.userId) throw new Error("They need to sign in to the app before water can be tracked.");
    if (loaded.assessment.hydration.restricted) throw new Error("A medical fluid limit is on file: their doctor sets their water.");
    const s = await server();
    const applied = await s.writeWater(context.supabase, { userId: loaded.client.userId, restMl: Math.round(data.restMl / 100) * 100, trainingExtraMl: Math.round(data.trainingExtraMl / 100) * 100, setBy: context.userId });
    await recordDecision(context, data.clientId, loaded.assessment, data.reviewId ?? null, "approved", [applied], null);
    return { ok: true };
  });

/**
 * Approve or dismiss a recommendation without writing anything here: a
 * nutrition change is approved by handing it to Change it with AI (recorded as
 * such), "investigate" and "hold" are acknowledged, and a dismissal keeps why.
 */
export const decideWeightReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        reviewId: z.string().uuid().nullable(),
        decision: z.enum(["approved", "dismissed"]),
        note: z.string().max(1000).optional(),
        handedOff: z.enum(["change_with_ai"]).optional(),
        instruction: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const loaded = await (await loader()).loadWeightManagement(context.supabase, data.clientId);
    const applied = data.handedOff ? [{ kind: "nutrition", handedTo: data.handedOff, instruction: data.instruction ?? null }] : null;
    await recordDecision(context, data.clientId, loaded.assessment, data.reviewId, data.decision, applied, data.note ?? null);
    return { ok: true };
  });

/** The decision on a review (or a new coach review of the read as it is now when there's none). */
async function recordDecision(context: any, clientId: string, a: Assessment, reviewId: string | null, status: "approved" | "dismissed", applied: unknown, note: string | null) {
  const now = new Date().toISOString();
  if (reviewId) {
    const { data: prev } = await context.supabase.from("weight_management_reviews").select("applied").eq("id", reviewId).eq("client_id", clientId).maybeSingle();
    const merged = applied == null ? (prev?.applied ?? null) : [...(Array.isArray(prev?.applied) ? prev.applied : []), ...(Array.isArray(applied) ? applied : [applied])];
    const { error } = await context.supabase
      .from("weight_management_reviews")
      .update({ status, decided_by: context.userId, decided_at: now, decision_note: note, applied: merged })
      .eq("id", reviewId)
      .eq("client_id", clientId);
    if (error) throw new Error(error.message);
    return;
  }
  const { storedAssessment } = await server();
  const { error } = await context.supabase.from("weight_management_reviews").upsert(
    {
      client_id: clientId,
      source: "coach",
      hash: `${a.hash}-c${Date.now().toString(36)}`,
      engine_version: a.version,
      verdict: a.recommendation.verdict,
      headline: a.recommendation.headline.slice(0, 300),
      material: a.recommendation.material,
      assessment: storedAssessment(a),
      status,
      decided_by: context.userId,
      decided_at: now,
      decision_note: note,
      applied,
    },
    { onConflict: "client_id,hash" },
  );
  if (error) throw new Error(error.message);
  await context.supabase.from("weight_management_reviews").update({ status: "superseded" }).eq("client_id", clientId).eq("status", "open");
}
