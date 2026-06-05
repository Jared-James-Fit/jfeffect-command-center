import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BodyweightGoal, GoalType, WeightUnit } from "@/lib/progress-metrics";

export function useBodyweightGoal(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-bodyweight-goal", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<BodyweightGoal | null> => {
      const { data, error } = await supabase
        .from("clients")
        .select("bodyweight_goal_type, bodyweight_goal_value, bodyweight_goal_value_max, bodyweight_goal_unit")
        .eq("id", clientId!)
        .maybeSingle();
      if (error) throw error;
      if (!data?.bodyweight_goal_type || data?.bodyweight_goal_value == null) return null;
      return {
        type: data.bodyweight_goal_type as GoalType,
        value: Number(data.bodyweight_goal_value),
        value_max: data.bodyweight_goal_value_max != null ? Number(data.bodyweight_goal_value_max) : null,
        unit: (data.bodyweight_goal_unit as WeightUnit) ?? "lb",
      };
    },
  });
}
