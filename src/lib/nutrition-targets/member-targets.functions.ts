import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  calculateTargets,
  DEFAULT_FORMULA_SETTINGS,
  type FormulaSettings,
  type FormulaInput,
} from "./formula";

const inputSchema = z.object({
  bodyweightKg: z.number().positive(),
  heightCm: z.number().positive(),
  ageYears: z.number().int().min(10).max(120),
  sex: z.enum(["male", "female"]),
  activity: z.enum(["sedentary", "light", "moderate", "very", "extra"]),
  goal: z.enum(["lose", "maintain", "gain"]),
  unitsPreference: z.enum(["metric", "imperial"]).optional(),
});

async function loadSettings(supabase: any): Promise<FormulaSettings> {
  const { data } = await supabase
    .from("nutrition_target_settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (!data) return DEFAULT_FORMULA_SETTINGS;
  return {
    deficit_percent: Number(data.deficit_percent),
    surplus_percent: Number(data.surplus_percent),
    protein_g_per_kg: Number(data.protein_g_per_kg),
    fat_g_per_kg: Number(data.fat_g_per_kg),
    pal_sedentary: Number(data.pal_sedentary),
    pal_light: Number(data.pal_light),
    pal_moderate: Number(data.pal_moderate),
    pal_very: Number(data.pal_very),
    pal_extra: Number(data.pal_extra),
    water_ml_per_kg: Number(data.water_ml_per_kg),
  };
}

async function loadMember(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("app_members")
    .select("id, height_cm, biological_sex, activity_level, units_preference")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Read the member's active targets (returns null if not yet set up). */
export const getActiveMemberTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const member = await loadMember(supabase, userId);
    if (!member?.id) return null;
    const { data } = await supabase
      .from("member_nutrition_targets")
      .select("*")
      .eq("member_id", member.id)
      .eq("active", true)
      .maybeSingle();
    return data ?? null;
  });

/** Calculate + save active targets for the current member. */
export const saveCalculatedTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const member = await loadMember(supabase, userId);
    if (!member?.id) throw new Error("Member profile not found");

    const settings = await loadSettings(supabase);
    const input: FormulaInput = {
      bodyweightKg: data.bodyweightKg,
      heightCm: data.heightCm,
      ageYears: data.ageYears,
      sex: data.sex,
      activity: data.activity,
      goal: data.goal,
    };
    const targets = calculateTargets(input, settings);

    // Persist profile fields used by the calc so we have them next time.
    await supabase
      .from("app_members")
      .update({
        height_cm: data.heightCm,
        biological_sex: data.sex,
        activity_level: data.activity,
        ...(data.unitsPreference ? { units_preference: data.unitsPreference } : {}),
      })
      .eq("id", member.id);

    // Deactivate previous active row, then insert a fresh active one.
    await supabase
      .from("member_nutrition_targets")
      .update({ active: false })
      .eq("member_id", member.id)
      .eq("active", true);

    const { data: inserted, error: insErr } = await supabase
      .from("member_nutrition_targets")
      .insert({
        member_id: member.id,
        source: "calculated",
        goal: data.goal,
        calories: targets.calories,
        protein_g: targets.protein_g,
        carbs_g: targets.carbs_g,
        fat_g: targets.fat_g,
        water_ml: targets.water_ml,
        input_snapshot: {
          ...input,
          bmr: targets.bmr,
          tdee: targets.tdee,
          settings_version: 1,
        },
        active: true,
      })
      .select("*")
      .single();
    if (insErr) throw insErr;
    return inserted;
  });

/** Save manually-entered targets (skips the formula). */
export const saveManualTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      calories: z.number().int().positive(),
      protein_g: z.number().int().min(0),
      carbs_g: z.number().int().min(0),
      fat_g: z.number().int().min(0),
      water_ml: z.number().int().min(0).optional(),
      goal: z.enum(["lose", "maintain", "gain"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const member = await loadMember(supabase, userId);
    if (!member?.id) throw new Error("Member profile not found");
    await supabase
      .from("member_nutrition_targets")
      .update({ active: false })
      .eq("member_id", member.id)
      .eq("active", true);
    const { data: inserted, error } = await supabase
      .from("member_nutrition_targets")
      .insert({
        member_id: member.id,
        source: "manual",
        goal: data.goal ?? null,
        calories: data.calories,
        protein_g: data.protein_g,
        carbs_g: data.carbs_g,
        fat_g: data.fat_g,
        water_ml: data.water_ml ?? null,
        active: true,
      })
      .select("*")
      .single();
    if (error) throw error;
    return inserted;
  });

/** Profile + latest bodyweight prefill for the setup wizard. */
export const getTargetsSetupPrefill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: m } = await supabase
      .from("app_members")
      .select("id, date_of_birth, height_cm, biological_sex, activity_level, units_preference, goals_tags, goals")
      .eq("user_id", userId)
      .maybeSingle();

    // Latest bodyweight from progress_bodyweight (preferred), then progress_metrics.
    let bodyweightKg: number | null = null;
    const { data: bw } = await supabase
      .from("progress_bodyweight")
      .select("weight_value, weight_unit, logged_date")
      .eq("user_id", userId)
      .order("logged_date", { ascending: false })
      .limit(1);
    if (bw && bw[0]) {
      const v = Number(bw[0].weight_value);
      bodyweightKg = bw[0].weight_unit === "kg" ? v : v * 0.45359237;
    }

    return {
      member: m ?? null,
      bodyweightKg,
    };
  });

export const getFormulaSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => loadSettings(context.supabase));

/** Read the current member's target history (most recent first). */
export const getMemberTargetsHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const member = await loadMember(supabase, userId);
    if (!member?.id) return [];
    const { data, error } = await supabase
      .from("member_nutrition_targets")
      .select("*")
      .eq("member_id", member.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return data ?? [];
  });

/** Clear (deactivate) the current member's active target. */
export const clearActiveMemberTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const member = await loadMember(supabase, userId);
    if (!member?.id) throw new Error("Member profile not found");
    const { error } = await supabase
      .from("member_nutrition_targets")
      .update({ active: false })
      .eq("member_id", member.id)
      .eq("active", true);
    if (error) throw error;
    return { ok: true };
  });

async function assertStaff(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: isCoach }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  if (!isAdmin && !isCoach) throw new Error("Forbidden");
}

async function loadMemberByUserId(supabase: any, targetUserId: string) {
  const { data, error } = await supabase
    .from("app_members")
    .select("id, height_cm, biological_sex, activity_level, units_preference, date_of_birth")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Coach/admin: read the active member targets for any user. */
export const getMemberTargetsForUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStaff(supabase, userId);
    const member = await loadMemberByUserId(supabase, data.userId);
    if (!member?.id) return { member: null, target: null };
    const { data: target } = await supabase
      .from("member_nutrition_targets")
      .select("*")
      .eq("member_id", member.id)
      .eq("active", true)
      .maybeSingle();
    return { member, target: target ?? null };
  });

/** Coach/admin: save coach-set targets for a member (source: "coach"). */
export const saveCoachOverrideTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      userId: z.string().uuid(),
      calories: z.number().int().positive(),
      protein_g: z.number().int().min(0),
      carbs_g: z.number().int().min(0),
      fat_g: z.number().int().min(0),
      water_ml: z.number().int().min(0).optional(),
      goal: z.enum(["lose", "maintain", "gain"]).optional(),
      note: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStaff(supabase, userId);
    const member = await loadMemberByUserId(supabase, data.userId);
    if (!member?.id) throw new Error("Member profile not found for this client");
    await supabase
      .from("member_nutrition_targets")
      .update({ active: false })
      .eq("member_id", member.id)
      .eq("active", true);
    const { data: inserted, error } = await supabase
      .from("member_nutrition_targets")
      .insert({
        member_id: member.id,
        source: "coach",
        goal: data.goal ?? null,
        calories: data.calories,
        protein_g: data.protein_g,
        carbs_g: data.carbs_g,
        fat_g: data.fat_g,
        water_ml: data.water_ml ?? null,
        input_snapshot: { set_by: userId, note: data.note ?? null, at: new Date().toISOString() },
        active: true,
      })
      .select("*")
      .single();
    if (error) throw error;
    return inserted;
  });