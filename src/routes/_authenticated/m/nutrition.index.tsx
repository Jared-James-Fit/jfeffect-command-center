import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calculator } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { NutritionDashboard, type NutritionTargets } from "@/components/nutrition/NutritionDashboard";
import { getActiveMemberTargets } from "@/lib/nutrition-targets/member-targets.functions";
import { DailyNutritionPanel } from "@/components/nutrition/DailyNutritionPanel";
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

  const showSetupCta = !targetsQ.isLoading && !targetsQ.isError && !saved;

  return (
    <>
      <PageHeader
        title="Nutrition"
        subtitle="Targets, recipes, and recovery — all in one place."
      />
      <SectionErrorBoundary label="Meal plan">
        <MemberMealPlanPanel />
      </SectionErrorBoundary>
      <SectionErrorBoundary label="Daily nutrition">
        <DailyNutritionPanel />
      </SectionErrorBoundary>
      {showSetupCta && (
        <div className="p-4 md:p-6 pb-0">
          <Card className="flex flex-col items-start gap-3 border-primary/40 bg-gradient-to-br from-primary/10 to-card p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                <Calculator className="h-5 w-5" />
              </div>
              <div>
                <div className="font-bold">Set up your nutrition targets</div>
                <div className="text-xs text-muted-foreground">
                  A few quick taps — we'll use what we already know about you.
                </div>
              </div>
            </div>
            <Button asChild className="w-full sm:w-auto">
              <Link to="/m/nutrition/targets-setup">Calculate My Targets</Link>
            </Button>
          </Card>
        </div>
      )}
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
            {(saved as any).source === "coach"
              ? "Set by coach"
              : (saved as any).source === "manual"
              ? "Manual"
              : "Calculated"}
          </span>
          <Link to="/m/nutrition/targets-manage" className="underline hover:text-foreground">
            Manage targets
          </Link>
        </div>
      )}
    </>
  );
}
