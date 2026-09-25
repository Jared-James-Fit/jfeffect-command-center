import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { NutritionDashboard, type NutritionTargets } from "@/components/nutrition/NutritionDashboard";
import { getActiveMemberTargets } from "@/lib/nutrition-targets/member-targets.functions";
import { MemberMealPlanPanel } from "@/components/nutrition/MemberMealPlanPanel";
import { SectionErrorBoundary } from "@/components/section-error-boundary";

export const Route = createFileRoute("/_authenticated/m/nutrition/")({
  component: MemberNutrition,
});

function MemberNutrition() {
  const getTargetsFn = useServerFn(getActiveMemberTargets);
  const { data } = useQuery({
    queryKey: ["m-nutrition-context"],
    queryFn: async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user) return { userId: undefined as string | undefined, goals: [] as string[] };
        const { data: m } = await (supabase as any)
          .from("app_members")
          .select("goals_tags, goals")
          .eq("user_id", auth.user.id)
          .maybeSingle();
        const goalsTags = Array.isArray(m?.goals_tags) ? (m!.goals_tags as string[]) : [];
        return { userId: auth.user.id, goals: goalsTags };
      } catch (e) {
        console.error("[nutrition] context query failed", e);
        return { userId: undefined as string | undefined, goals: [] as string[] };
      }
    },
    retry: false,
  });

  const targetsQ = useQuery({
    queryKey: ["m-nutrition-targets"],
    queryFn: () => getTargetsFn({}),
    retry: false,
  });

  const saved = targetsQ.data ?? null;
  const targets: NutritionTargets | undefined = saved
    ? {
        calories: (saved as any).calories ?? null,
        protein: (saved as any).protein_g ?? null,
        carbs: (saved as any).carbs_g ?? null,
        fats: (saved as any).fat_g ?? null,
        water: (saved as any).water_ml
          ? `${(Number((saved as any).water_ml) / 1000).toFixed(1)}L`
          : null,
        sleep: "8h",
      }
    : undefined;

  return (
    <div className="mx-auto w-full max-w-5xl pb-safe-bottom">
      <PageHeader
        title="Nutrition"
        subtitle="Suggested targets, recipes, and recovery — all in one place."
      />
      <SectionErrorBoundary label="Meal plan">
        <MemberMealPlanPanel />
      </SectionErrorBoundary>
      <SectionErrorBoundary label="Nutrition dashboard" className="mx-4 md:mx-6">
        <NutritionDashboard
          viewer="member"
          userId={data?.userId}
          goals={data?.goals}
          targets={targets}
          hasCoachApprovedTargets={(saved as any)?.source === "coach"}
        />
      </SectionErrorBoundary>
      {saved && (
        <div className="px-4 md:px-6 -mt-2 mb-4 text-xs text-muted-foreground flex items-center gap-2">
          <span className="rounded-full bg-secondary px-2 py-0.5 uppercase tracking-wide text-[10px] font-semibold">
            {(saved as any).source === "coach" ? "Set by coach" : "Suggested"}
          </span>
          <span>
            {(saved as any).source === "coach"
              ? "Coach-set targets are shown above."
              : "Use Recalculate in Suggested Nutrition Targets whenever you want a fresh estimate."}
          </span>
        </div>
      )}
    </div>
  );
}
