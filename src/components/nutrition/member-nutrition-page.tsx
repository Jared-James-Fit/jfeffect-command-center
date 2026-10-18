import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { NutritionDashboard, type NutritionTargets } from "@/components/nutrition/NutritionDashboard";
import { getActiveMemberTargets } from "@/lib/nutrition-targets/member-targets.functions";
import { MemberMealPlanPanel } from "@/components/nutrition/MemberMealPlanPanel";
import { SectionErrorBoundary } from "@/components/section-error-boundary";

/**
 * Nutrition for a JF member (self-serve): suggested targets they calculate
 * themselves, the meal plan and the daily dashboard. Coaching clients see
 * their coach's targets instead (portal Nutrition picks by service tier).
 */
export function MemberNutritionPage() {
  const getTargetsFn = useServerFn(getActiveMemberTargets);
  // Keyed per person: these are saved on the device, and another account
  // signed in on the same phone must never open on this one's numbers.
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { data } = useQuery({
    queryKey: ["m-nutrition-context", uid],
    enabled: !!uid,
    queryFn: async () => {
      try {
        const { data: m } = await (supabase as any)
          .from("app_members")
          .select("goals_tags, goals")
          .eq("user_id", uid!)
          .maybeSingle();
        const goalsTags = Array.isArray(m?.goals_tags) ? (m!.goals_tags as string[]) : [];
        return { userId: uid ?? undefined, goals: goalsTags };
      } catch (e) {
        console.error("[nutrition] context query failed", e);
        return { userId: undefined as string | undefined, goals: [] as string[] };
      }
    },
    retry: false,
  });

  const targetsQ = useQuery({
    queryKey: ["m-nutrition-targets", uid],
    enabled: !!uid,
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
        subtitle="Your daily targets, meals and recipes."
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
    </div>
  );
}
