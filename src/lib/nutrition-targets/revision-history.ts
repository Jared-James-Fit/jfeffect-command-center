import { supabase } from "@/integrations/supabase/client";
import { planPeriod, type PlanRow } from "./plan-history";

export type NutritionRevision = {
  id: string; plan_id: string; captured_at: string; prior_updated_at: string | null;
  source: "coach" | "cleo" | "undo"; actor_id?: string | null; snapshot: PlanRow;
};

export const nutritionRevisionKey = (clientId: string) => ["nutrition-plan-revisions", clientId] as const;

export function nutritionRevisionQuery(clientId: string) {
  return {
    queryKey: nutritionRevisionKey(clientId),
    queryFn: async (): Promise<PlanRow[]> => {
      const { data, error } = await (supabase as any).from("nutrition_plan_revisions")
        .select("id,plan_id,captured_at,prior_updated_at,source,actor_id,snapshot")
        .eq("client_id", clientId).order("captured_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      const saved = (data as NutritionRevision[] ?? []).map((r) => ({
        ...r.snapshot, id: r.id, status: "Archived", revision_of: r.plan_id,
        revision_captured_at: r.captured_at, revision_source: r.source, revision_actor_id: r.actor_id,
      } as PlanRow));
      // Older applied Cleo changes already contain exact pre-edit day rows in
      // their undo payload. Surface them without claiming we saved plan metadata.
      const { data: edits, error: editError } = await (supabase as any).from("nutrition_plan_edits")
        .select("id,target_id,applied_at,applied_by,restore,status")
        .eq("client_id", clientId).not("applied_at", "is", null)
        .order("applied_at", { ascending: false }).limit(100);
      if (editError) throw new Error(editError.message);
      const legacy = (edits ?? []).flatMap((edit: any): PlanRow[] => {
        if (!edit.target_id || !edit.applied_at || !Array.isArray(edit.restore?.days) || !edit.restore.days.length) return [];
        if (saved.some((p) => p.revision_of === edit.target_id &&
          p.revision_source === "cleo" &&
          Math.abs(Date.parse(p.revision_captured_at) - Date.parse(edit.applied_at)) < 5000 &&
          JSON.stringify((p.nutrition_target_days ?? []).map(daySignature)) === JSON.stringify(edit.restore.days.map(daySignature)))) return [];
        return [{ id: edit.id, status: "Archived", start_date: null, end_date: null,
          revision_of: edit.target_id, revision_captured_at: edit.applied_at, revision_source: "cleo",
          revision_actor_id: edit.applied_by, revision_partial: true,
          nutrition_target_days: edit.restore.days, food_weighing_rules: edit.restore.food_weighing_rules }];
      });
      return [...saved, ...legacy];
    },
  };
}

function daySignature(d: Record<string, any>) {
  return [d.day_label, d.calories, d.protein, d.carbs, d.fats, d.fibre, d.steps, d.notes, d.sort_order, d.use_on, d.weekdays];
}

export function referenceLabel(plan: PlanRow) {
  if (!plan.revision_captured_at) return planPeriod(plan);
  const at = new Date(plan.revision_captured_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (plan.revision_partial ? "Before Cleo edit · " : "Before edit · ") + at + (plan.revision_partial ? " · saved day targets" : " · " + planPeriod(plan));
}

/** Latest archived plan or saved in-place revision, whichever was most recently superseded. */
export function orderPlanReferences(archived: PlanRow[], revisions: PlanRow[]) {
  const at = (p: PlanRow) => p.revision_captured_at ?? p.end_date ?? p.start_date ?? "";
  return [...archived, ...revisions].sort((a, b) => String(at(b)).localeCompare(String(at(a))) || a.id.localeCompare(b.id));
}
