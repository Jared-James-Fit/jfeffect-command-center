import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertCoachOrAdmin(ctx: any, clientId: string) {
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (isAdmin) return;
  const { data: isCoach } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "coach" });
  if (isCoach) return;
  const { data: isAssigned } = await ctx.supabase.rpc("is_assigned_coach_for_client", { _client_id: clientId });
  if (isAssigned) return;
  throw new Error("Forbidden");
}

/**
 * Client fetches their own combined profile + goals + coach.
 * Only loads what the Profile & Goals section needs — not called on dashboards or lists.
 */
export const getMyProfileAndGoalsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: client } = await supabase
      .from("clients")
      .select(
        "id, first_name, last_name, preferred_name, full_name, email, phone, date_of_birth, timezone, height_cm, preferred_height_unit, address, city, province, postal_code, country, emergency_contact_name, emergency_contact_phone, status, account_status, coaching_type, coaching_package, assigned_coach_id, start_date, created_at, info_last_updated_at, info_update_requested, goals, bodyweight_goal_value, bodyweight_goal_unit",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (!client) return { client: null, goals: null, coach: null };

    const [goalsResult, coachResult] = await Promise.all([
      supabase
        .from("client_goals_setup")
        .select("main_goal, main_goal_other, goal_target, training_days_per_week, available_weekdays, workout_length_minutes, training_experience, training_styles, training_location, equipment, equipment_by_location, nutrition_goal, nutrition_preference, food_restrictions_has, food_restrictions_details, nutrition_challenges, injuries_has, injuries_details, final_notes, completed_at, updated_at, update_requested_at, update_request_message")
        .eq("client_id", client.id)
        .maybeSingle(),
      client.assigned_coach_id
        ? supabase.from("coaches").select("id, full_name").eq("id", client.assigned_coach_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    return {
      client: client as typeof client,
      goals: goalsResult.data ?? null,
      coach: (coachResult as any).data ?? null,
    };
  });

/**
 * Admin/coach fetches any client's combined profile + goals + coach summary.
 * Used by the Profile & Goals admin panel.
 */
export const getAdminClientProfileAndGoalsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ clientId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertCoachOrAdmin(context, data.clientId);

    const [clientResult, goalsResult] = await Promise.all([
      context.supabase
        .from("clients")
        .select(
          "id, first_name, last_name, preferred_name, full_name, email, phone, date_of_birth, timezone, height_cm, preferred_height_unit, address, city, province, postal_code, country, emergency_contact_name, emergency_contact_phone, status, account_status, coaching_type, coaching_package, assigned_coach_id, start_date, created_at, info_last_updated_at, goals, bodyweight_goal_value, bodyweight_goal_unit",
        )
        .eq("id", data.clientId)
        .maybeSingle(),
      context.supabase
        .from("client_goals_setup")
        .select("main_goal, main_goal_other, goal_target, training_days_per_week, workout_length_minutes, training_experience, training_styles, training_location, nutrition_goal, nutrition_preference, injuries_has, injuries_details, completed_at, updated_at, last_reviewed_at")
        .eq("client_id", data.clientId)
        .maybeSingle(),
    ]);

    const client = clientResult.data;
    const coachResult = client?.assigned_coach_id
      ? await context.supabase.from("coaches").select("id, full_name").eq("id", client.assigned_coach_id).maybeSingle()
      : { data: null };

    return {
      client: client ?? null,
      goals: goalsResult.data ?? null,
      coach: (coachResult as any).data ?? null,
    };
  });
