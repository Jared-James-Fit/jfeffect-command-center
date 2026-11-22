import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MemberPlanStudio } from "@/components/nutrition-studio/member-plan-studio";
import { NutritionStudioStart } from "@/components/nutrition-studio/studio-start";

// A member's own meal plan: build it, import one (?start=import) or have Cleo draft one (?start=cleo).
export const Route = createFileRoute("/_authenticated/portal/nutrition-studio")({
  validateSearch: z.object({ start: z.enum(["import", "cleo"]).optional() }),
  component: function NutritionStudioPage() {
    const { start } = Route.useSearch();
    if (start) return <NutritionStudioStart mode={start} />;
    return <MemberPlanStudio />;
  },
});
