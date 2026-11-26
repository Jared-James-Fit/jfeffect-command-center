import { supabase } from "@/integrations/supabase/client";
import { planPeriod, type PlanRow } from "./plan-history";

export type NutritionRevision = {
  id: string; plan_id: string; captured_at: string; prior_updated_at: string | null;
  source: "coach" | "cleo" | "undo"; snapshot: Omit<PlanRow, "id">;
};

export const nutritionRevisionKey = (clientId: string) => ["nutrition-plan-revisions", clientId] as const;

export function nutritionRevisionQuery(clientId: string) {
  return {
    queryKey: nutritionRevisionKey(clientId),
    queryFn: async (): Promise<PlanRow[]> => {
      const { data, error } = await (supabase as any).from("nutrition_plan_revisions")
        .select("id,plan_id,captured_at,prior_updated_at,source,snapshot")
        .eq("client_id", clientId).order("captured_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return (data as NutritionRevision[] ?? []).map((r) => ({
        ...r.snapshot, id: r.id, status: "Archived", revision_of: r.plan_id,
        revision_captured_at: r.captured_at, revision_source: r.source,
      } as PlanRow));
    },
  };
}

export function referenceLabel(plan: PlanRow) {
  if (!plan.revision_captured_at) return planPeriod(plan);
  const at = new Date(plan.revision_captured_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return "Revision before " + at + " · " + planPeriod(plan);
}

/** Latest archived plan or saved in-place revision, whichever was most recently superseded. */
export function orderPlanReferences(archived: PlanRow[], revisions: PlanRow[]) {
  const at = (p: PlanRow) => p.revision_captured_at ?? p.end_date ?? p.start_date ?? "";
  return [...archived, ...revisions].sort((a, b) => String(at(b)).localeCompare(String(at(a))) || a.id.localeCompare(b.id));
}
