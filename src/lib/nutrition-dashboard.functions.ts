import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PovInput, resolvePovUserId, type PovArgs } from "@/lib/client-pov.server";

const povShape = PovInput.shape;

/**
 * Session identity, or — in coach "View as client" — the viewed client's
 * user id. POV reads/writes go through the service client because member
 * food-log tables are owner-only under RLS; resolvePovUserId has already
 * confirmed the caller is an admin or that client's coach.
 */
async function nutritionCtx(context: any, pov: PovArgs) {
  const { supabase, userId } = context;
  if (!pov?.viewAsUserId || pov.viewAsUserId === userId) return { supabase, userId };
  const uid = await resolvePovUserId(supabase, userId, pov);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { supabase: supabaseAdmin as any, userId: uid };
}

async function loadMember(supabase: any, userId: string) {
  const { data } = await supabase
    .from("app_members")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.id) return data;

  // No app_members row yet (e.g. coaching-only client). Lazily provision one
  // via the admin client so the same nutrition tracker works for everyone.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Re-check with admin in case RLS hid an existing row.
  const existing = await supabaseAdmin
    .from("app_members")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.data?.id) return existing.data;

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email =
    authUser?.user?.email ??
    `${userId}@placeholder.local`;
  const fullName =
    (authUser?.user?.user_metadata as any)?.full_name ??
    (authUser?.user?.user_metadata as any)?.name ??
    null;

  // Reuse any pre-existing row that matches this email (case-insensitive),
  // since app_members has a unique lower(email) index.
  const { data: byEmail } = await supabaseAdmin
    .from("app_members")
    .select("id, user_id")
    .ilike("email", email)
    .maybeSingle();
  if (byEmail?.id) {
    if (!byEmail.user_id) {
      await supabaseAdmin
        .from("app_members")
        .update({ user_id: userId })
        .eq("id", byEmail.id);
    }
    return { id: byEmail.id, user_id: userId };
  }

  const { data: created, error } = await supabaseAdmin
    .from("app_members")
    .insert({
      user_id: userId,
      email,
      full_name: fullName,
      account_type: "program_only",
      status: "Active",
    })
    .select("id, user_id")
    .single();
  if (error) return null;
  return created;
}

function dayBoundsUTC(dateISO: string) {
  // dateISO: YYYY-MM-DD (treat as local-ish midnight to midnight UTC bucket)
  const start = new Date(`${dateISO}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// =================== Dashboard read =====================================
export const getNutritionDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).extend(povShape).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await nutritionCtx(context, data);
    const member = await loadMember(supabase, userId);
    if (!member?.id) {
      return {
        member: null,
        target: null,
        pendingTarget: null,
        meals: [],
        presets: [],
        supplements: [],
        supplementLogs: [],
        weekMeals: [],
      };
    }

    const { start, end } = dayBoundsUTC(data.date);
    const weekStart = new Date(new Date(start).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: targetRow },
      { data: meals },
      { data: presets },
      { data: supplements },
      { data: supplementLogs },
      { data: weekMeals },
    ] = await Promise.all([
      supabase
        .from("member_nutrition_targets")
        .select("*")
        .eq("member_id", member.id)
        .eq("active", true)
        .maybeSingle(),
      supabase
        .from("member_meal_logs")
        .select("*")
        .eq("member_id", member.id)
        .gte("logged_at", start)
        .lt("logged_at", end)
        .order("logged_at", { ascending: true }),
      supabase
        .from("member_meal_presets")
        .select("*")
        .eq("member_id", member.id)
        .order("name", { ascending: true }),
      supabase
        .from("member_supplements")
        .select("*")
        .eq("member_id", member.id)
        .eq("active", true)
        .order("name", { ascending: true }),
      supabase
        .from("member_supplement_logs")
        .select("*")
        .eq("member_id", member.id)
        .gte("taken_at", start)
        .lt("taken_at", end),
      supabase
        .from("member_meal_logs")
        .select("logged_at, calories, protein_g, carbs_g, fat_g")
        .eq("member_id", member.id)
        .gte("logged_at", weekStart)
        .lt("logged_at", end),
    ]);

    const pending = targetRow && (targetRow as any).pending_review ? targetRow : null;
    const approved = targetRow && !(targetRow as any).pending_review ? targetRow : null;

    return {
      member,
      target: approved,
      pendingTarget: pending,
      meals: meals ?? [],
      presets: presets ?? [],
      supplements: supplements ?? [],
      supplementLogs: supplementLogs ?? [],
      weekMeals: weekMeals ?? [],
    };
  });

// =================== Meals =====================================
const MealInput = z.object({
  name: z.string().trim().min(1).max(120),
  calories: z.number().int().min(0).max(10000),
  protein_g: z.number().min(0).max(1000),
  carbs_g: z.number().min(0).max(1000),
  fat_g: z.number().min(0).max(1000),
  source: z.enum(["preset", "manual", "ai"]).default("manual"),
  preset_id: z.string().uuid().optional().nullable(),
  raw_text: z.string().max(500).optional().nullable(),
  logged_at: z.string().datetime().optional(),
  save_as_preset: z.boolean().optional(),
});

export const logMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MealInput.extend(povShape).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await nutritionCtx(context, data);
    const member = await loadMember(supabase, userId);
    if (!member?.id) throw new Error("Member profile not found");
    const { data: inserted, error } = await supabase
      .from("member_meal_logs")
      .insert({
        member_id: member.id,
        user_id: userId,
        name: data.name,
        calories: data.calories,
        protein_g: data.protein_g,
        carbs_g: data.carbs_g,
        fat_g: data.fat_g,
        source: data.source,
        preset_id: data.preset_id ?? null,
        raw_text: data.raw_text ?? null,
        logged_at: data.logged_at ?? new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    if (data.save_as_preset) {
      await supabase.from("member_meal_presets").insert({
        member_id: member.id,
        user_id: userId,
        name: data.name,
        calories: data.calories,
        protein_g: data.protein_g,
        carbs_g: data.carbs_g,
        fat_g: data.fat_g,
      });
    }
    return inserted;
  });

export const updateMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(120),
      calories: z.number().int().min(0),
      protein_g: z.number().min(0),
      carbs_g: z.number().min(0),
      fat_g: z.number().min(0),
    }).extend(povShape).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await nutritionCtx(context, data);
    const { error } = await supabase
      .from("member_meal_logs")
      .update({
        name: data.name,
        calories: data.calories,
        protein_g: data.protein_g,
        carbs_g: data.carbs_g,
        fat_g: data.fat_g,
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).extend(povShape).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await nutritionCtx(context, data);
    const { error } = await supabase
      .from("member_meal_logs")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).extend(povShape).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await nutritionCtx(context, data);
    const { error } = await supabase
      .from("member_meal_presets")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// =================== Supplements =====================================
export const upsertSupplement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(80),
      daily_target_count: z.number().int().min(1).max(20).default(1),
      active: z.boolean().default(true),
    }).extend(povShape).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await nutritionCtx(context, data);
    const member = await loadMember(supabase, userId);
    if (!member?.id) throw new Error("Member profile not found");
    if (data.id) {
      const { error } = await supabase
        .from("member_supplements")
        .update({
          name: data.name,
          daily_target_count: data.daily_target_count,
          active: data.active,
        })
        .eq("id", data.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabase.from("member_supplements").insert({
      member_id: member.id,
      user_id: userId,
      name: data.name,
      daily_target_count: data.daily_target_count,
      active: data.active,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSupplement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).extend(povShape).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await nutritionCtx(context, data);
    const { error } = await supabase
      .from("member_supplements")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const logSupplement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      supplement_id: z.string().uuid().optional().nullable(),
      supplement_name: z.string().trim().min(1).max(80),
      dose: z.string().max(60).optional().nullable(),
    }).extend(povShape).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await nutritionCtx(context, data);
    const member = await loadMember(supabase, userId);
    if (!member?.id) throw new Error("Member profile not found");
    const { error } = await supabase.from("member_supplement_logs").insert({
      member_id: member.id,
      user_id: userId,
      supplement_id: data.supplement_id ?? null,
      supplement_name: data.supplement_name,
      dose: data.dose ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const undoSupplementLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ supplement_id: z.string().uuid().nullable().optional(), supplement_name: z.string() }).extend(povShape).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await nutritionCtx(context, data);
    // Delete most recent log today matching supplement
    const { start, end } = dayBoundsUTC(new Date().toISOString().slice(0, 10));
    let q = supabase
      .from("member_supplement_logs")
      .select("id")
      .eq("user_id", userId)
      .gte("taken_at", start)
      .lt("taken_at", end)
      .order("taken_at", { ascending: false })
      .limit(1);
    if (data.supplement_id) q = q.eq("supplement_id", data.supplement_id);
    else q = q.eq("supplement_name", data.supplement_name);
    const { data: row } = await q;
    const id = row?.[0]?.id;
    if (!id) return { ok: true };
    await supabase.from("member_supplement_logs").delete().eq("id", id).eq("user_id", userId);
    return { ok: true };
  });

// =================== AI parse =====================================
/**
 * The AI food log: estimate a typed meal's macros. Metered with AI credits
 * (src/lib/ai-credits): out of credits answers `{ ok: false, outOfCredits }`
 * with where they stand, never an error; a call that fails or can't be read
 * gives its credit back. Runs on the OpenAI key (route `meal_estimate`),
 * never Lovable credits. It always runs as the person signed in, so a coach
 * previewing a client never spends the client's credits.
 */
export const parseMealFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ text: z.string().trim().min(2).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const [{ withAiCredits, MeteredCallError }, { callModelNow }, { resolveRoute }, { MEAL_ESTIMATE_SYSTEM, parseMealEstimate }] = await Promise.all([
      import("@/lib/ai-credits/meter.server"),
      import("@/lib/ai/model-client.server"),
      import("@/lib/ai/routing"),
      import("@/lib/ai-credits/meal-estimate"),
    ]);
    const route = resolveRoute("meal_estimate");
    const r = await withAiCredits(userId, "meal_estimate", async () => {
      let lastError = "no answer";
      for (const model of route.models) {
        try {
          const reply = await callModelNow(model, {
            system: MEAL_ESTIMATE_SYSTEM,
            prompt: data.text,
            effort: route.effort,
            maxOutputTokens: route.maxOutputTokens,
            timeoutMs: 25_000,
          });
          const value = parseMealEstimate(reply.text, data.text);
          if (!value) throw new MeteredCallError("The AI couldn't make sense of that, so no credit was used. Try saying it another way.", reply.model, reply.usage);
          return { value, model: reply.model, usage: reply.usage };
        } catch (e: any) {
          if (e instanceof MeteredCallError) throw e;
          lastError = e?.message ?? lastError;
          console.error("[meal-estimate] model failed", { model, message: lastError });
        }
      }
      throw new MeteredCallError(`The AI couldn't estimate that right now, so no credit was used. Try again in a minute.`);
    });
    if (!r.ok) return { ok: false as const, outOfCredits: true as const, credits: r.credits };
    return { ok: true as const, ...r.value, credits: r.credits };
  });

// =================== Coach approval =====================================
async function assertStaff(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: isCoach }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  if (!isAdmin && !isCoach) throw new Error("Forbidden");
}

export const listPendingTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { data, error } = await supabase
      .from("member_nutrition_targets")
      .select("*, app_members(user_id, display_name, full_name)")
      .eq("active", true)
      .eq("pending_review", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const approveMemberTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      calories: z.number().int().positive().optional(),
      protein_g: z.number().int().min(0).optional(),
      carbs_g: z.number().int().min(0).optional(),
      fat_g: z.number().int().min(0).optional(),
      water_ml: z.number().int().min(0).optional(),
      note: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const patch: Record<string, any> = {
      pending_review: false,
      approved_by: userId,
      approved_at: new Date().toISOString(),
    };
    if (data.calories !== undefined) patch.calories = data.calories;
    if (data.protein_g !== undefined) patch.protein_g = data.protein_g;
    if (data.carbs_g !== undefined) patch.carbs_g = data.carbs_g;
    if (data.fat_g !== undefined) patch.fat_g = data.fat_g;
    if (data.water_ml !== undefined) patch.water_ml = data.water_ml;
    if (data.note !== undefined) patch.coach_note = data.note;
    const { error } = await supabase
      .from("member_nutrition_targets")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });