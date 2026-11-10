import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listSavedPlans, savePlanForLater, unsavePlan } from "@/lib/membership-library.functions";

export type SavedPlan = {
  id: string;
  name: string;
  public_title: string | null;
  description: string | null;
  weeks: number | null;
  days_per_week: number | null;
  difficulty: string | null;
  goal: string | null;
  training_style: string | null;
  est_minutes_per_workout: number | null;
  allow_full_program: boolean | null;
};

const SAVED_KEY = ["m-saved-plans"] as const;

/**
 * JF Effect plans a member saved (member_plan_saved): their ids for the
 * library's Save buttons, the plans themselves for My programs, and one
 * toggle. Members only (a coaching client's coach writes their program).
 */
export function useSavedPlans(enabled = true) {
  const qc = useQueryClient();
  const fetchSaved = useServerFn(listSavedPlans);
  const saveFn = useServerFn(savePlanForLater);
  const unsaveFn = useServerFn(unsavePlan);

  const ids = useQuery({
    queryKey: SAVED_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async () => (await fetchSaved()).ids as string[],
  });
  const idList = ids.data ?? [];

  const plans = useQuery({
    queryKey: ["m-saved-plan-cards", [...idList].sort().join(",")],
    enabled: enabled && idList.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<SavedPlan[]> => {
      const { data, error } = await supabase
        .from("member_plans")
        .select(
          "id, name, public_title, description, weeks, days_per_week, difficulty, goal, training_style, est_minutes_per_workout, allow_full_program",
        )
        .in("id", idList)
        .eq("status", "Published");
      if (error) throw error;
      // in the saved list's order; a plan that's no longer published drops out
      const byId = new Map(((data ?? []) as SavedPlan[]).map((p) => [p.id, p]));
      return idList.map((id) => byId.get(id)).filter((p): p is SavedPlan => !!p);
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ planId, save }: { planId: string; save: boolean }) => {
      if (save) await saveFn({ data: { planId } });
      else await unsaveFn({ data: { planId } });
      return save;
    },
    onMutate: async ({ planId, save }) => {
      await qc.cancelQueries({ queryKey: SAVED_KEY });
      const before = qc.getQueryData<string[]>(SAVED_KEY);
      qc.setQueryData<string[]>(SAVED_KEY, (cur = []) =>
        save ? (cur.includes(planId) ? cur : [planId, ...cur]) : cur.filter((x) => x !== planId),
      );
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(SAVED_KEY, ctx.before);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: SAVED_KEY });
    },
  });

  return {
    ids: idList,
    isSaved: (planId: string) => idList.includes(planId),
    plans: idList.length ? (plans.data ?? []) : [],
    loading: ids.isLoading || (idList.length > 0 && plans.isLoading),
    toggle,
  };
}
