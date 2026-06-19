import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertMemberCanReadProtected } from "@/lib/jf-access.server";

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admin required");
}

/** Even-spread of N workout days across a 7-day week (M..S). */
function dayOffsetsForWeek(daysPerWeek: number): number[] {
  const presets: Record<number, number[]> = {
    1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 2, 4, 6],
    5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6],
  };
  return presets[Math.max(1, Math.min(7, daysPerWeek))] ?? [0, 2, 4];
}

/**
 * Resolve the anchor date for a plan start, in the member's timezone.
 *
 * - When `startISO` is already a date-only string (`YYYY-MM-DD`, from a
 *   `date` column), use it verbatim — timezone is meaningless.
 * - When `startISO` is a timestamp, project it into the supplied tz so a
 *   member in `America/Los_Angeles` whose start fires at 03:00Z still
 *   anchors on the previous calendar day instead of the UTC one.
 */
function anchorDateYMD(startISO: string, timezone?: string | null): { y: number; m: number; d: number } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(startISO)) {
    const [y, m, d] = startISO.split("-").map((n) => parseInt(n, 10));
    return { y, m, d };
  }
  const dt = new Date(startISO);
  const tz = timezone || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(dt);
    const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || "0", 10);
    return { y: get("year"), m: get("month"), d: get("day") };
  } catch {
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
}

function defaultScheduledDate(
  startISO: string,
  weekIndex: number,
  dayIndex: number,
  daysPerWeek: number,
  timezone?: string | null,
): string {
  const { y, m, d } = anchorDateYMD(startISO, timezone);
  // Use UTC arithmetic on the anchor (date-only); the tz is only used to
  // resolve which calendar day the start timestamp falls on.
  const base = new Date(Date.UTC(y, m - 1, d));
  const offsets = dayOffsetsForWeek(daysPerWeek);
  const di = Math.max(0, Math.min(offsets.length - 1, dayIndex - 1));
  const totalDays = (weekIndex - 1) * 7 + offsets[di];
  base.setUTCDate(base.getUTCDate() + totalDays);
  return base.toISOString().slice(0, 10);
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
    const payload: any = t.payload || { weeks_data: [] };
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
    const { error } = await supabaseAdmin.from("member_plans").update(data.patch as any).eq("id", data.planId);
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
    await assertMemberCanReadProtected(supabase, userId);
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
    startedAt: z.string().datetime().optional(),
    activeDurationSeconds: z.number().int().nonnegative().max(12 * 3600).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMemberCanReadProtected(supabase, userId);
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) throw new Error("Not a member");

    const { data: enr } = await supabase
      .from("member_plan_enrollments")
      .select("*, member_plans(published_payload)")
      .eq("id", data.enrollmentId).eq("member_id", member.id).maybeSingle();
    if (!enr) throw new Error("Enrollment not found");

    // Compute shared logging-quality metrics so member completions match
    // the client (`pl_*`) shape — single source of truth for downstream UI.
    const dayObj: any = (enr as any)?.member_plans?.published_payload
      ?.weeks_data?.[data.weekIndex - 1]?.days?.[data.dayIndex - 1];
    const rowsArr: any[] = Array.isArray(dayObj?.rows) ? dayObj.rows : [];
    const { summarizeCompleteness } = await import("./workout-completeness");
    const required = rowsArr.map((row: any, ei: number) => ({
      rowId: String(ei),
      prescribedSets: Math.max(1, Number(row?.sets) || 1),
      metricKind: "load_reps" as const,
    }));
    const { data: setLogs } = await supabase
      .from("member_set_logs").select("exercise_index,set_index,reps,load_lb,rpe,rir")
      .eq("enrollment_id", data.enrollmentId)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex);
    const logged = (setLogs ?? []).map((l: any) => ({
      rowId: String(l.exercise_index),
      setIndex: l.set_index,
      reps: l.reps, loadLb: l.load_lb, rpe: l.rpe, rir: l.rir,
    }));
    const sum = summarizeCompleteness(required, logged);
    const completedAt = new Date().toISOString();

    // Compute durations from any previous start/heartbeat row (best-effort).
    const { data: prevRow } = await supabase
      .from("member_workout_completions").select("started_at,last_activity_at,active_duration_seconds")
      .eq("enrollment_id", data.enrollmentId)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex).maybeSingle();
    // Prefer client-supplied started_at / active duration (heartbeat-derived)
    // when present; fall back to any previous row, then to completedAt.
    const startedAt =
      (prevRow as any)?.started_at ?? data.startedAt ?? completedAt;
    const elapsedSec = Math.max(
      0,
      Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000),
    );
    const activeSec =
      data.activeDurationSeconds ??
      (prevRow as any)?.active_duration_seconds ??
      Math.min(elapsedSec, 12 * 3600);

    const { error } = await supabase.from("member_workout_completions").upsert({
      enrollment_id: data.enrollmentId,
      week_index: data.weekIndex,
      day_index: data.dayIndex,
      notes: data.notes ?? null,
      completed_at: completedAt,
      started_at: startedAt,
      last_activity_at: completedAt,
      elapsed_duration_seconds: elapsedSec,
      active_duration_seconds: activeSec,
      required_sets_count: sum.requiredSets,
      logged_sets_count: sum.loggedSets,
      skipped_exercises_count: sum.skippedExercises,
      logging_percentage: sum.loggingPercentage,
      logging_quality: sum.loggingQuality,
      completed_with_missing_logs: sum.completedWithMissingLogs,
    } as any, { onConflict: "enrollment_id,week_index,day_index" });
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
    await assertMemberCanReadProtected(supabase, userId);
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
    const { supabase, userId } = context;
    await assertMemberCanReadProtected(supabase, userId);
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
    await assertMemberCanReadProtected(supabase, userId);
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
/* ---------- member-side: schedule ---------- */

async function getMember(ctx: any) {
  const { supabase, userId } = ctx;
  await assertMemberCanReadProtected(supabase, userId);
  const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
  if (!member) throw new Error("Not a member");
  return { supabase, member };
}

export const getEnrollmentSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    enrollmentId: z.string().uuid(),
    timezone: z.string().max(64).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, member } = await getMember(context);
    const { data: enr } = await supabase
      .from("member_plan_enrollments")
      .select("id, start_date, started_at, member_plans(days_per_week, weeks, published_payload)")
      .eq("id", data.enrollmentId).eq("member_id", member.id).maybeSingle();
    if (!enr) throw new Error("Enrollment not found");
    const { data: overrides = [] } = await supabase
      .from("member_plan_day_schedule").select("week_index, day_index, scheduled_date")
      .eq("enrollment_id", data.enrollmentId);
    const overrideMap = new Map<string, string>();
    for (const r of (overrides ?? []) as any[]) overrideMap.set(`${r.week_index}:${r.day_index}`, r.scheduled_date);

    const plan = enr.member_plans as any;
    const weeks = plan?.published_payload?.weeks_data ?? [];
    const dpw = plan?.days_per_week ?? 3;
    const startISO = (enr.start_date as any) || (enr.started_at as any) || new Date().toISOString();
    const schedule: { week: number; day: number; date: string; isOverride: boolean }[] = [];
    for (const w of weeks) {
      for (const d of (w.days ?? [])) {
        const key = `${w.week_index}:${d.day_index}`;
        const ov = overrideMap.get(key);
        schedule.push({
          week: w.week_index, day: d.day_index,
          date: ov ?? defaultScheduledDate(
            typeof startISO === "string" ? startISO : new Date(startISO).toISOString(),
            w.week_index, d.day_index, dpw, data.timezone,
          ),
          isOverride: !!ov,
        });
      }
    }
    return { schedule };
  });

export const rescheduleDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    enrollmentId: z.string().uuid(),
    weekIndex: z.number().int().min(1),
    dayIndex: z.number().int().min(1),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, member } = await getMember(context);
    const { data: enr } = await supabase.from("member_plan_enrollments")
      .select("id").eq("id", data.enrollmentId).eq("member_id", member.id).maybeSingle();
    if (!enr) throw new Error("Enrollment not found");
    const { error } = await supabase.from("member_plan_day_schedule").upsert({
      enrollment_id: data.enrollmentId,
      week_index: data.weekIndex,
      day_index: data.dayIndex,
      scheduled_date: data.scheduledDate,
    }, { onConflict: "enrollment_id,week_index,day_index" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const swapDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    enrollmentId: z.string().uuid(),
    a: z.object({ weekIndex: z.number().int().min(1), dayIndex: z.number().int().min(1) }),
    b: z.object({ weekIndex: z.number().int().min(1), dayIndex: z.number().int().min(1) }),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, member } = await getMember(context);
    const { data: enr } = await supabase.from("member_plan_enrollments")
      .select("id, start_date, started_at, member_plans(days_per_week)").eq("id", data.enrollmentId).eq("member_id", member.id).maybeSingle();
    if (!enr) throw new Error("Enrollment not found");
    const dpw = (enr.member_plans as any)?.days_per_week ?? 3;
    const startISO = (enr.start_date as any) || (enr.started_at as any) || new Date().toISOString();
    const startStr = typeof startISO === "string" ? startISO : new Date(startISO).toISOString();
    const findCur = async (w: number, d: number) => {
      const { data: r } = await supabase.from("member_plan_day_schedule")
        .select("scheduled_date").eq("enrollment_id", data.enrollmentId)
        .eq("week_index", w).eq("day_index", d).maybeSingle();
      return r?.scheduled_date ?? defaultScheduledDate(startStr, w, d, dpw);
    };
    const da = await findCur(data.a.weekIndex, data.a.dayIndex);
    const db = await findCur(data.b.weekIndex, data.b.dayIndex);
    const rows = [
      { enrollment_id: data.enrollmentId, week_index: data.a.weekIndex, day_index: data.a.dayIndex, scheduled_date: db },
      { enrollment_id: data.enrollmentId, week_index: data.b.weekIndex, day_index: data.b.dayIndex, scheduled_date: da },
    ];
    const { error } = await supabase.from("member_plan_day_schedule").upsert(rows, { onConflict: "enrollment_id,week_index,day_index" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetDaySchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ enrollmentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, member } = await getMember(context);
    const { data: enr } = await supabase.from("member_plan_enrollments")
      .select("id").eq("id", data.enrollmentId).eq("member_id", member.id).maybeSingle();
    if (!enr) throw new Error("Enrollment not found");
    const { error } = await supabase.from("member_plan_day_schedule").delete().eq("enrollment_id", data.enrollmentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
