import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Admin/coach: fetch the active, client-visible meal plan for a specific
 * client by client_id. Mirrors getCoachAssignedMealPlan but keyed by
 * clients.id (the row id used in the admin directory) instead of user_id.
 * Returns null when no visible, non-archived plan exists.
 */
export const getClientMealPlanForCoach = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ clientId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [{ data: isAdmin }, { data: isCoach }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
    ]);
    if (!isAdmin && !isCoach) throw new Error("Forbidden");

    const { data: client } = await supabase
      .from("clients")
      .select("id, first_name, last_name, full_name")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client?.id) return null;

    const { data: target } = await supabase
      .from("nutrition_targets")
      .select(
        "id, phase, custom_phase, goal, custom_goal, structure, status, start_date, end_date, water, client_notes, pdf_url, pdf_name, visible_to_client, updated_at, last_updated_at, assigned_coach_id, nutrition_target_days(id, day_label, calories, protein, carbs, fats, fibre, notes, sort_order)",
      )
      .eq("client_id", client.id)
      .eq("visible_to_client", true)
      .neq("status", "Archived")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!target) return null;

    const days = (((target as any).nutrition_target_days ?? []) as any[])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    let coach_name: string | null = null;
    const coachId = (target as any).assigned_coach_id as string | null;
    if (coachId) {
      const { data: coachRow } = await supabase
        .from("coaches")
        .select("full_name, first_name, last_name")
        .eq("id", coachId)
        .maybeSingle();
      if (coachRow) {
        coach_name =
          (coachRow as any).full_name ||
          [(coachRow as any).first_name ?? "", (coachRow as any).last_name ?? ""]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          null;
      }
    }

    const clientName =
      (client as any).full_name ||
      [(client as any).first_name ?? "", (client as any).last_name ?? ""]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      null;

    return {
      id: (target as any).id,
      client_name: clientName,
      coach_name,
      updated_at:
        (target as any).last_updated_at ?? (target as any).updated_at ?? null,
      phase: (target as any).custom_phase || (target as any).phase || null,
      goal: (target as any).custom_goal || (target as any).goal || null,
      structure: (target as any).structure ?? null,
      status: (target as any).status ?? null,
      start_date: (target as any).start_date ?? null,
      end_date: (target as any).end_date ?? null,
      water: (target as any).water ?? null,
      client_notes: (target as any).client_notes ?? null,
      days: days.map((d) => ({
        id: d.id,
        day_label: d.day_label,
        calories: d.calories ?? null,
        protein: d.protein ?? null,
        carbs: d.carbs ?? null,
        fats: d.fats ?? null,
        fibre: d.fibre ?? null,
        notes: d.notes ?? null,
      })),
    };
  });