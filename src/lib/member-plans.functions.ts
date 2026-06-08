import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admin required");
}

function countWorkouts(payload: any): number {
  let n = 0;
  const weeks = payload?.weeks_data ?? [];
  for (const w of weeks) for (const d of (w?.days ?? [])) {
    // Count a day as a workout if it has any rows (i.e. exercises)
    if (Array.isArray(d?.rows) && d.rows.length > 0) n++;
    // If rows can be empty but the day still counts, fall back to day count
    else n++;
  }
  return n;
}

/* ---------- admin CRUD ---------- */

const CreatePlanInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  training_style: z.string().default("custom"),
  goal: z.string().optional(),
  difficulty: z.enum(["Beginner","Intermediate","Advanced","All Levels"]).default("All Levels"),
  weeks: z.number().int().min(1).max(52).default(4),
  days_per_week: z.number().int().min(1).max(7).default(3),
  est_minutes_per_workout: z.number().int().nullable().optional(),
  equipment_needed: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  tracking_enabled: z.boolean().default(true),
  logging_enabled: z.boolean().default(true),
  required_access_level: z.string().default("app_membership"),
  source_template_id: z.string().uuid().nullable().optional(),
});

export const createMemberPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreatePlanInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Build empty payload skeleton
    const weeks_data = Array.from({ length: data.weeks }, (_, wi) => ({
      week_index: wi + 1,
      days: Array.from({ length: data.days_per_week }, (_, di) => ({
        day_index: di + 1, title: `Day ${di + 1}`, rows: [],
      })),
    }));
    const payload = { weeks_data };
    const workouts_total = data.weeks * data.days_per_week;
    const { data: row, error } = await supabaseAdmin
      .from("member_plans")
      .insert({
        ...data,
        published_payload: payload,
        workouts_total,
        status: "Draft",
      })
      .select("*").single();
    if (error) throw new Error(error.message);
    return { plan: row };
  });

export const publishFromTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    templateId: z.string().uuid(),
    overrides: z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      difficulty: z.enum(["Beginner","Intermediate","Advanced","All Levels"]).optional(),
      required_access_level: z.string().optional(),
      training_style: z.string().optional(),
      goal: z.string().optional(),
    }).default({}),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: t, error } = await supabaseAdmin.from("pl_templates").select("*").eq("id", data.templateId).maybeSingle();
    if (error || !t) throw new Error("Template not found");
    const payload = t.payload || { weeks_data: [] };
    const weeks = t.weeks ?? (payload?.weeks_data?.length ?? 4);
    const days = t.days_per_week ?? (payload?.weeks_data?.[0]?.days?.length ?? 3);
    const workouts_total = countWorkouts(payload);
    const { data: row, error: ie } = await supabaseAdmin.from("member_plans").insert({
      name: data.overrides.name ?? t.name,
      description: data.overrides.description ?? t.notes ?? null,
      training_style: data.overrides.training_style ?? t.training_style ?? "custom",
      goal: data.overrides.goal ?? t.goal ?? null,
      difficulty: data.overrides.difficulty ?? "All Levels",
      weeks,
      days_per_week: days,
      est_minutes_per_workout: t.est_duration_min ?? null,
      tags: t.tags ?? [],
      required_access_level: data.overrides.required_access_level ?? "app_membership",
      source_template_id: t.id,
      published_payload: payload,
      workouts_total,
      status: "Draft",
    }).select("*").single();
    if (ie) throw new Error(ie.message);
    return { plan: row };
  });

export const updateMemberPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    planId: z.string().uuid(),
    patch: z.record(z.string(), z.any()),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("member_plans").update(data.patch).eq("id", data.planId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setPlanStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    planId: z.string().uuid(),
    status: z.enum(["Draft","Published","Archived"]),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("member_plans").update({ status: data.status }).eq("id", data.planId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateMemberPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { planId: string }) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin.from("member_plans").select("*").eq("id", data.planId).maybeSingle();
    if (!p) throw new Error("Not found");
    const { id, created_at, updated_at, ...rest } = p as any;
    const { data: row, error } = await supabaseAdmin.from("member_plans").insert({
      ...rest, name: `${p.name} (Copy)`, status: "Draft",
    }).select("*").single();
    if (error) throw new Error(error.message);
    return { plan: row };
  });

export const deleteMemberPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { planId: string }) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("member_plans").delete().eq("id", data.planId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- member-side: start / complete ---------- */

export const startPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    planId: z.string().uuid(),
    confirmReplace: z.boolean().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) throw new Error("Not a member");

    const { data: plan } = await supabase.from("member_plans").select("*").eq("id", data.planId).maybeSingle();
    if (!plan) throw new Error("Plan not found");
    if (plan.status !== "Published") throw new Error("Plan not available");

    // Access check
    const { data: access } = await supabase
      .from("member_access").select("access_level_key")
      .eq("member_id", member.id).eq("active", true);
    const keys = new Set((access ?? []).map((a: any) => a.access_level_key));
    if (!keys.has(plan.required_access_level)) {
      throw new Error("You don't have access to this plan");
    }

    // Already-active guard
    const { data: active } = await supabase
      .from("member_plan_enrollments")
      .select("*").eq("member_id", member.id).eq("status", "Active").maybeSingle();
    if (active && !data.confirmReplace) {
      return { conflict: true, activeEnrollmentId: active.id, activePlanId: active.plan_id };
    }
    if (active && data.confirmReplace) {
      await supabase.from("member_plan_enrollments").update({ status: "Abandoned" }).eq("id", active.id);
    }

    const { data: row, error } = await supabase.from("member_plan_enrollments").insert({
      member_id: member.id,
      plan_id: plan.id,
      status: "Active",
      current_week: 1,
      workouts_completed: 0,
      workouts_total: plan.workouts_total ?? 0,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return { conflict: false, enrollmentId: row.id };
  });

export const completeWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    enrollmentId: z.string().uuid(),
    weekIndex: z.number().int().min(1),
    dayIndex: z.number().int().min(1),
    notes: z.string().max(2000).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) throw new Error("Not a member");

    const { data: enr } = await supabase
      .from("member_plan_enrollments")
      .select("*").eq("id", data.enrollmentId).eq("member_id", member.id).maybeSingle();
    if (!enr) throw new Error("Enrollment not found");

    const { error } = await supabase.from("member_workout_completions").upsert({
      enrollment_id: data.enrollmentId,
      week_index: data.weekIndex,
      day_index: data.dayIndex,
      notes: data.notes ?? null,
      completed_at: new Date().toISOString(),
    }, { onConflict: "enrollment_id,week_index,day_index" });
    if (error) throw new Error(error.message);

    // Recompute progress
    const { count } = await supabase
      .from("member_workout_completions")
      .select("id", { count: "exact", head: true })
      .eq("enrollment_id", data.enrollmentId);
    const done = count ?? 0;
    const total = enr.workouts_total ?? 0;
    const status = total > 0 && done >= total ? "Completed" : "Active";
    await supabase.from("member_plan_enrollments").update({
      workouts_completed: done,
      current_week: data.weekIndex,
      status,
      completed_at: status === "Completed" ? new Date().toISOString() : null,
    }).eq("id", data.enrollmentId);

    return { ok: true, workouts_completed: done, workouts_total: total, status };
  });

export const uncompleteWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    enrollmentId: z.string().uuid(),
    weekIndex: z.number().int().min(1),
    dayIndex: z.number().int().min(1),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) throw new Error("Not a member");
    const { error } = await supabase
      .from("member_workout_completions").delete()
      .eq("enrollment_id", data.enrollmentId)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex);
    if (error) throw new Error(error.message);
    const { count } = await supabase
      .from("member_workout_completions")
      .select("id", { count: "exact", head: true })
      .eq("enrollment_id", data.enrollmentId);
    await supabase.from("member_plan_enrollments").update({
      workouts_completed: count ?? 0,
      status: "Active",
      completed_at: null,
    }).eq("id", data.enrollmentId);
    return { ok: true };
  });

export const logSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    enrollmentId: z.string().uuid(),
    weekIndex: z.number().int().min(1),
    dayIndex: z.number().int().min(1),
    exerciseIndex: z.number().int().min(0),
    setIndex: z.number().int().min(0),
    reps: z.number().int().nullable().optional(),
    load_kg: z.number().nullable().optional(),
    load_lb: z.number().nullable().optional(),
    rpe: z.number().nullable().optional(),
    rir: z.number().nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { enrollmentId, weekIndex, dayIndex, exerciseIndex, setIndex, ...rest } = data;
    const { error } = await supabase.from("member_set_logs").upsert({
      enrollment_id: enrollmentId,
      week_index: weekIndex,
      day_index: dayIndex,
      exercise_index: exerciseIndex,
      set_index: setIndex,
      ...rest,
    }, { onConflict: "enrollment_id,week_index,day_index,exercise_index,set_index" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const restartPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { enrollmentId: string }) => z.object({ enrollmentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) throw new Error("Not a member");
    const { data: old } = await supabase.from("member_plan_enrollments").select("plan_id").eq("id", data.enrollmentId).eq("member_id", member.id).maybeSingle();
    if (!old) throw new Error("Not found");
    const { data: plan } = await supabase.from("member_plans").select("workouts_total").eq("id", old.plan_id).maybeSingle();
    // Abandon any other active
    await supabase.from("member_plan_enrollments").update({ status: "Abandoned" }).eq("member_id", member.id).eq("status", "Active");
    const { data: row, error } = await supabase.from("member_plan_enrollments").insert({
      member_id: member.id,
      plan_id: old.plan_id,
      status: "Active",
      current_week: 1,
      workouts_completed: 0,
      workouts_total: plan?.workouts_total ?? 0,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return { enrollmentId: row.id };
  });