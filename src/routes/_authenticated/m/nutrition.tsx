import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { NutritionDashboard } from "@/components/nutrition/NutritionDashboard";

export const Route = createFileRoute("/_authenticated/m/nutrition")({
  component: MemberNutrition,
});

function MemberNutrition() {
  const { data } = useQuery({
    queryKey: ["m-nutrition-context"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return { userId: undefined as string | undefined, goals: [] as string[] };
      const { data: m } = await (supabase as any)
        .from("app_members")
        .select("goals_tags")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      return {
        userId: auth.user.id,
        goals: (m?.goals_tags ?? []) as string[],
      };
    },
  });

  return (
    <>
      <PageHeader
        title="Nutrition"
        subtitle="Targets, recipes, and recovery — all in one place."
      />
      <NutritionDashboard viewer="member" userId={data?.userId} goals={data?.goals} />
    </>
  );
}
