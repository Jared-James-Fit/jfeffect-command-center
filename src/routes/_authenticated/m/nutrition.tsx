import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { NutritionDashboard } from "@/components/nutrition/NutritionDashboard";
import { getLatestBodyweightKg } from "@/lib/bodyweight";
import { computeMemberTargets, inferGoalKind } from "@/lib/member-targets";

export const Route = createFileRoute("/_authenticated/m/nutrition")({
  component: MemberNutrition,
});

function MemberNutrition() {
  const { data } = useQuery({
    queryKey: ["m-nutrition-context"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return { userId: undefined as string | undefined, goals: [] as string[], targets: undefined };
      const { data: m } = await (supabase as any)
        .from("app_members")
        .select("goals_tags, goals")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      const goalsTags = (m?.goals_tags ?? []) as string[];
      const bwKg = await getLatestBodyweightKg(auth.user.id);
      const targets = computeMemberTargets(bwKg, inferGoalKind(goalsTags, m?.goals));
      return {
        userId: auth.user.id,
        goals: goalsTags,
        targets,
      };
    },
  });

  return (
    <>
      <PageHeader
        title="Nutrition"
        subtitle="Targets, recipes, and recovery — all in one place."
      />
      <NutritionDashboard
        viewer="member"
        userId={data?.userId}
        goals={data?.goals}
        targets={data?.targets}
      />
    </>
  );
}
