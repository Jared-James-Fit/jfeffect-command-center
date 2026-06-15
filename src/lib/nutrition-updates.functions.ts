import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function isAdminOrAssignedCoach(supabase: any, userId: string, clientId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  if (isAdmin) return true;
  const { data: ok } = await supabase.rpc("is_assigned_coach", { _client_id: clientId });
  return !!ok;
}

async function requireCoachOrAdmin(supabase: any, userId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const ok = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "coach");
  if (!ok) throw new Error("Not authorized");
}

// ============================================================================
// CLIENT: submit nutrition update
// ============================================================================
const SubmitInput = z.object({
  current_bodyweight: z.number().nullable().optional(),
  avg_bodyweight: z.number().nullable().optional(),
  bodyweight_unit: z.enum(["lb", "kg"]).default("lb"),
  compliance_pct: z.number().int().min(0).max(100).nullable().optional(),
  hunger_rating: z.number().int().min(1).max(5).nullable().optional(),
  energy_rating: z.number().int().min(1).max(5).nullable().optional(),
  digestion_rating: z.number().int().min(1).max(5).nullable().optional(),
  sleep_rating: z.number().int().min(1).max(5).nullable().optional(),
  training_performance_rating: z.number().int().min(1).max(5).nullable().optional(),
  steps_completed: z.number().int().nullable().optional(),
  cardio_completed: z.string().max(500).nullable().optional(),
  missed_meals: z.string().max(2000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  goal_direction: z.enum(["losing", "maintaining", "gaining", "unsure"]).nullable().optional(),
  progress_photo_urls: z.array(z.string()).max(8).default([]),
});

export const submitNutritionUpdateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SubmitInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    const { data: client } = await supabase
      .from("clients").select("id, assigned_coach_id").eq("user_id", userId).maybeSingle();
    if (!client) throw new Error("Client profile not found");

    const { data: existingOpen } = await supabase
      .from("nutrition_update_submissions")
      .select("id")
      .eq("client_id", client.id)
      .in("status", ["submitted", "under_review"])
      .maybeSingle();
    if (existingOpen) throw new Error("You already have an update waiting for your coach.");

    const { data: target } = await supabase
      .from("nutrition_targets")
      .select("id, phase, goal, update_cadence, last_updated_date, next_due_date, nutrition_target_days(*)")
      .eq("client_id", client.id)
      .neq("status", "Archived")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: inserted, error: insErr } = await supabase
      .from("nutrition_update_submissions")
      .insert({
        client_id: client.id,
        target_id: target?.id ?? null,
        status: "submitted",
        previous_targets_json: target ?? null,
        ...data,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    // create coach task + update tracking_status
    if (target?.id) {
      await supabase.from("nutrition_targets").update({ tracking_status: "submitted" }).eq("id", target.id);
    }
    await supabase.from("nutrition_review_tasks").insert({
      submission_id: inserted.id,
      client_id: client.id,
      assigned_coach_id: client.assigned_coach_id ?? null,
      status: "open",
    });
    await supabase.from("nutrition_notification_log").insert({
      client_id: client.id,
      submission_id: inserted.id,
      kind: "coach_submitted",
      channel: "app",
      status: "queued",
    });

    return { ok: true, id: inserted.id };
  });

// ============================================================================
// CLIENT: get my nutrition status
// ============================================================================
export const getMyNutritionStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: client } = await supabase
      .from("clients").select("id, full_name, assigned_coach_id").eq("user_id", userId).maybeSingle();
    if (!client) return { client: null, target: null, openSubmission: null, lastPublished: null };

    const { data: target } = await supabase
      .from("nutrition_targets")
      .select("*, nutrition_target_days(*)")
      .eq("client_id", client.id)
      .neq("status", "Archived")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: openSubmission } = await supabase
      .from("nutrition_update_submissions")
      .select("*")
      .eq("client_id", client.id)
      .in("status", ["submitted", "under_review"])
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: lastPublished } = await supabase
      .from("nutrition_update_submissions")
      .select("*")
      .eq("client_id", client.id)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return { client, target, openSubmission, lastPublished };
  });

// ============================================================================
// COACH/ADMIN: list dashboard
// ============================================================================
const ListInput = z.object({
  filter: z.enum(["all", "overdue", "due_today", "submitted", "due_this_week", "up_to_date", "paused"]).default("all"),
  search: z.string().max(200).optional(),
}).partial();

const STATUS_ORDER: Record<string, number> = {
  overdue: 0, due_today: 1, submitted: 2, under_review: 3, due_soon: 4, up_to_date: 5, published: 6, not_needed: 7, paused: 8,
};

export const listNutritionDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await requireCoachOrAdmin(supabase, userId);

    const { data: targets, error } = await supabase
      .from("nutrition_targets")
      .select(`
        id, client_id, phase, custom_phase, goal, custom_goal, structure,
        update_cadence, cadence_interval_days, last_updated_date, next_due_date,
        tracking_status, goal_direction, assigned_coach_id,
        clients!inner ( id, full_name, assigned_coach_id, coaches:assigned_coach_id ( id, user_id, name ) ),
        nutrition_target_days ( day_label, calories, protein, carbs, fats )
      `)
      .neq("status", "Archived")
      .order("next_due_date", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);

    const clientIds = (targets ?? []).map((t: any) => t.client_id);
    const { data: openSubs } = clientIds.length
      ? await supabase
          .from("nutrition_update_submissions")
          .select("id, client_id, submitted_at, status, current_bodyweight, compliance_pct")
          .in("client_id", clientIds)
          .in("status", ["submitted", "under_review"])
      : { data: [] };
    const openByClient = new Map<string, any>();
    for (const s of openSubs ?? []) openByClient.set(s.client_id, s);

    let rows = (targets ?? []).map((t: any) => ({
      ...t,
      open_submission: openByClient.get(t.client_id) ?? null,
    }));

    if (data.search?.trim()) {
      const q = data.search.toLowerCase();
      rows = rows.filter((r: any) => (r.clients?.full_name || "").toLowerCase().includes(q));
    }

    const f = data.filter ?? "all";
    if (f !== "all") {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      rows = rows.filter((r: any) => {
        const ts = r.tracking_status;
        if (f === "overdue") return ts === "overdue";
        if (f === "due_today") return ts === "due_today";
        if (f === "submitted") return ts === "submitted" || ts === "under_review";
        if (f === "up_to_date") return ts === "up_to_date" || ts === "published";
        if (f === "paused") return ts === "paused" || ts === "not_needed";
        if (f === "due_this_week") {
          if (!r.next_due_date) return false;
          const d = new Date(r.next_due_date + "T00:00:00"); const diff = (d.getTime() - today.getTime()) / 86400000;
          return diff >= 0 && diff <= 7;
        }
        return true;
      });
    }

    rows.sort((a: any, b: any) => {
      const ra = STATUS_ORDER[a.tracking_status] ?? 99;
      const rb = STATUS_ORDER[b.tracking_status] ?? 99;
      if (ra !== rb) return ra - rb;
      const da = a.next_due_date || "9999-12-31";
      const db = b.next_due_date || "9999-12-31";
      return da.localeCompare(db);
    });

    const counts = { overdue: 0, due_today: 0, submitted: 0, due_this_week: 0, up_to_date: 0, paused: 0 };
    for (const r of rows) {
      if (r.tracking_status === "overdue") counts.overdue++;
      else if (r.tracking_status === "due_today") counts.due_today++;
      else if (r.tracking_status === "submitted" || r.tracking_status === "under_review") counts.submitted++;
      else if (r.tracking_status === "paused" || r.tracking_status === "not_needed") counts.paused++;
      else counts.up_to_date++;
    }

    return { rows, counts };
  });

// ============================================================================
// COACH/ADMIN: get submission detail
// ============================================================================
export const getSubmissionDetailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    const { data: sub, error } = await supabase
      .from("nutrition_update_submissions")
      .select("*")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) throw new Error("Submission not found");
    if (!(await isAdminOrAssignedCoach(supabase, userId, sub.client_id))) throw new Error("Not authorized");

    const { data: client } = await supabase
      .from("clients").select("id, full_name, assigned_coach_id").eq("id", sub.client_id).maybeSingle();

    const { data: currentTarget } = await supabase
      .from("nutrition_targets")
      .select("*, nutrition_target_days(*)")
      .eq("client_id", sub.client_id)
      .neq("status", "Archived")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: weightHistory } = await supabase
      .from("progress_metrics")
      .select("recorded_at, weight, weight_unit")
      .eq("client_id", sub.client_id)
      .not("weight", "is", null)
      .order("recorded_at", { ascending: false })
      .limit(20);

    return { submission: sub, client, currentTarget, weightHistory: (weightHistory ?? []).reverse() };
  });

// ============================================================================
// COACH/ADMIN: publish nutrition update
// ============================================================================
const DayInput = z.object({
  day_label: z.string().min(1).max(50),
  calories: z.number().int().nullable().optional(),
  protein: z.number().int().nullable().optional(),
  carbs: z.number().int().nullable().optional(),
  fats: z.number().int().nullable().optional(),
  fibre: z.number().int().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
const PublishInput = z.object({
  submissionId: z.string().uuid(),
  days: z.array(DayInput).min(1),
  cardio_target: z.string().max(500).nullable().optional(),
  step_target: z.string().max(200).nullable().optional(),
  phase: z.string().max(100).nullable().optional(),
  coach_note: z.string().max(5000).nullable().optional(),
  notify_sms: z.boolean().default(false),
  notify_email: z.boolean().default(true),
});

export const publishNutritionReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PublishInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    const { data: sub } = await supabase
      .from("nutrition_update_submissions")
      .select("id, client_id, target_id, status").eq("id", data.submissionId).maybeSingle();
    if (!sub) throw new Error("Submission not found");
    if (!(await isAdminOrAssignedCoach(supabase, userId, sub.client_id))) throw new Error("Not authorized");
    if (sub.status === "published") throw new Error("Already published");

    let targetId = sub.target_id as string | null;
    if (!targetId) {
      const { data: t } = await supabase
        .from("nutrition_targets").select("id").eq("client_id", sub.client_id)
        .neq("status", "Archived").order("start_date", { ascending: false }).limit(1).maybeSingle();
      targetId = t?.id ?? null;
    }
    if (!targetId) {
      const { data: newT, error: tErr } = await supabase.from("nutrition_targets").insert({
        client_id: sub.client_id,
        phase: data.phase || "Maintenance",
        goal: "Maintain bodyweight",
        structure: data.days.length > 1 ? "Training / Rest Day Split" : "Same Every Day",
        start_date: new Date().toISOString().slice(0, 10),
        status: "Active",
      }).select("id").single();
      if (tErr) throw new Error(tErr.message);
      targetId = newT.id;
    }

    // replace day rows
    await supabase.from("nutrition_target_days").delete().eq("target_id", targetId);
    const dayRows = data.days.map((d, i) => ({ target_id: targetId, sort_order: i, ...d }));
    const { error: dErr } = await supabase.from("nutrition_target_days").insert(dayRows);
    if (dErr) throw new Error(dErr.message);

    const today = new Date().toISOString().slice(0, 10);

    // update target
    const updates: any = {
      last_updated_at: new Date().toISOString(),
      last_updated_date: today,
      tracking_status: "published",
      admin_notes: data.coach_note ?? undefined,
    };
    if (data.phase) updates.phase = data.phase;
    await supabase.from("nutrition_targets").update(updates).eq("id", targetId);

    // recompute next due
    await supabase.rpc("fn_apply_nutrition_cadence", { _target_id: targetId });

    // mark submission published
    await supabase.from("nutrition_update_submissions").update({
      status: "published",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      coach_note: data.coach_note ?? null,
      published_targets_json: { days: data.days, cardio_target: data.cardio_target, step_target: data.step_target, phase: data.phase },
    }).eq("id", data.submissionId);

    // close task
    await supabase.from("nutrition_review_tasks").update({
      status: "done", completed_at: new Date().toISOString(),
    }).eq("submission_id", data.submissionId);

    await supabase.from("nutrition_notification_log").insert({
      client_id: sub.client_id,
      submission_id: data.submissionId,
      kind: "client_plan_published",
      channel: data.notify_email ? "email" : data.notify_sms ? "sms" : "app",
      status: "queued",
    });

    return { ok: true, target_id: targetId };
  });

// ============================================================================
// COACH/ADMIN: quick actions
// ============================================================================
export const pushDueDateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ targetId: z.string().uuid(), days: z.number().int().min(1).max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: t } = await supabase.from("nutrition_targets").select("client_id, next_due_date").eq("id", data.targetId).maybeSingle();
    if (!t) throw new Error("Not found");
    if (!(await isAdminOrAssignedCoach(supabase, userId, t.client_id))) throw new Error("Not authorized");
    const base = t.next_due_date ? new Date(t.next_due_date + "T00:00:00") : new Date();
    base.setDate(base.getDate() + data.days);
    const newDate = base.toISOString().slice(0, 10);
    await supabase.from("nutrition_targets").update({ next_due_date: newDate }).eq("id", data.targetId);
    await supabase.rpc("fn_recompute_nutrition_status", { _target_id: data.targetId });
    return { ok: true, next_due_date: newDate };
  });

export const setNutritionCadenceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    targetId: z.string().uuid(),
    cadence: z.enum(["weekly","biweekly","monthly","custom","manual","paused"]),
    cadence_interval_days: z.number().int().min(1).max(365).optional(),
    reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: t } = await supabase.from("nutrition_targets").select("client_id").eq("id", data.targetId).maybeSingle();
    if (!t) throw new Error("Not found");
    if (!(await isAdminOrAssignedCoach(supabase, userId, t.client_id))) throw new Error("Not authorized");
    const patch: any = { update_cadence: data.cadence, cadence_interval_days: data.cadence_interval_days ?? null };
    if (data.cadence === "paused") { patch.paused_at = new Date().toISOString(); patch.paused_reason = data.reason ?? null; }
    else { patch.paused_at = null; patch.paused_reason = null; }
    await supabase.from("nutrition_targets").update(patch).eq("id", data.targetId);
    await supabase.rpc("fn_apply_nutrition_cadence", { _target_id: data.targetId });
    await supabase.rpc("fn_recompute_nutrition_status", { _target_id: data.targetId });
    return { ok: true };
  });

export const markNotNeededFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ targetId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: t } = await supabase.from("nutrition_targets").select("client_id").eq("id", data.targetId).maybeSingle();
    if (!t) throw new Error("Not found");
    if (!(await isAdminOrAssignedCoach(supabase, userId, t.client_id))) throw new Error("Not authorized");
    await supabase.from("nutrition_targets").update({ tracking_status: "not_needed", next_due_date: null }).eq("id", data.targetId);
    return { ok: true };
  });

export const allowResubmitFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!(await isAdminOrAssignedCoach(supabase, userId, data.clientId))) throw new Error("Not authorized");
    // dismiss any open submission so the client can submit again
    await supabase.from("nutrition_update_submissions")
      .update({ status: "dismissed", reviewed_by: userId, reviewed_at: new Date().toISOString() })
      .eq("client_id", data.clientId)
      .in("status", ["submitted","under_review"]);
    const { data: tgt } = await supabase.from("nutrition_targets").select("id").eq("client_id", data.clientId)
      .neq("status", "Archived").order("start_date", { ascending: false }).limit(1).maybeSingle();
    if (tgt?.id) await supabase.rpc("fn_recompute_nutrition_status", { _target_id: tgt.id });
    return { ok: true };
  });

// ============================================================================
// ADMIN: automation settings
// ============================================================================
export const getNutritionAutomationSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data } = await supabase.from("nutrition_automation_settings").select("*").limit(1).maybeSingle();
    return data;
  });

const SettingsInput = z.object({
  default_cadence: z.enum(["weekly","biweekly","monthly","custom","manual","paused"]).optional(),
  cadence_interval_days: z.number().int().min(1).max(365).nullable().optional(),
  reminder_lead_days: z.number().int().min(0).max(30).optional(),
  overdue_reminder_days: z.number().int().min(0).max(30).optional(),
  client_reminders_enabled: z.boolean().optional(),
  coach_reminders_enabled: z.boolean().optional(),
  sms_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  push_enabled: z.boolean().optional(),
  coach_review_sla_hours: z.number().int().min(1).max(168).optional(),
});

export const updateNutritionAutomationSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SettingsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
    const { data: existing } = await supabase.from("nutrition_automation_settings").select("id").limit(1).maybeSingle();
    if (existing) {
      await supabase.from("nutrition_automation_settings").update(data).eq("id", existing.id);
    } else {
      await supabase.from("nutrition_automation_settings").insert({ singleton: true, ...data });
    }
    return { ok: true };
  });

// ============================================================================
// CRON HOOK helper: recompute statuses for all active clients
// ============================================================================
export const recomputeAllNutritionStatusesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) throw new Error("Admin only");
    const { data: ts } = await supabase.from("nutrition_targets").select("id").neq("status", "Archived");
    let n = 0;
    for (const t of ts ?? []) {
      await supabase.rpc("fn_recompute_nutrition_status", { _target_id: t.id });
      n++;
    }
    return { ok: true, processed: n };
  });