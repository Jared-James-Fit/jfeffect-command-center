import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { NutritionDashboard, type NutritionTargets } from "@/components/nutrition/NutritionDashboard";
import { getActiveMemberTargets } from "@/lib/nutrition-targets/member-targets.functions";
import { MemberMealPlanPanel } from "@/components/nutrition/MemberMealPlanPanel";
import { usePortalUserId } from "@/lib/client-impersonation";

export const Route = createFileRoute("/_authenticated/portal/nutrition-targets")({
  component: PortalNutrition,
});

function PortalNutrition() {
  const portalUserId = usePortalUserId();
  const getTargetsFn = useServerFn(getActiveMemberTargets);

  const ctxQ = useQuery({
    queryKey: ["portal-nutrition-ctx", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clients")
        .select("goals")
        .eq("user_id", portalUserId!)
        .maybeSingle();
      const goals = data?.goals ? [String(data.goals)] : [];
      return { goals };
    },
  });

  const targetsQ = useQuery({
    queryKey: ["portal-nutrition-targets"],
    queryFn: () => getTargetsFn({}),
  });

  const saved = targetsQ.data as any;
  const targets: NutritionTargets | undefined = saved
    ? {
        calories: saved.calories,
        protein: saved.protein_g,
        carbs: saved.carbs_g,
        fats: saved.fat_g,
        water: saved.water_ml ? `${(saved.water_ml / 1000).toFixed(1)}L` : null,
        sleep: "8h",
      }
    : undefined;

  return (
    <>
      <PageHeader title="Nutrition" subtitle="Your plan, targets, and recipes — set by your coach." />
      <MemberMealPlanPanel />
      <NutritionDashboard
        viewer="client"
        userId={portalUserId ?? undefined}
        goals={ctxQ.data?.goals ?? []}
        targets={targets}
      />
    </>
  );
}
