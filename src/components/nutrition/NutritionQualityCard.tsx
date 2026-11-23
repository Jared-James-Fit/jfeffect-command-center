/**
 * Nutrition plan quality on the coach's Nutrition tab (Nov 23 2026): the
 * current plan scored against this client's goal, results, training and food
 * on file (nutrition-targets/plan-quality.ts), with Optimize with Cleo opening
 * the docked panel with the weak spots as the ask. Hidden with no plan.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getNutritionQualityFn } from "@/lib/cardio/cardio.functions";
import { QualityScoreCard } from "@/components/plan-quality/quality-card";
import { openNutritionCleo } from "@/components/nutrition/nutrition-cleo-dock";
import { useCleoAccess } from "@/hooks/use-cleo-access";

export const nutritionQualityKey = (clientId: string) => ["nutrition-quality", clientId] as const;

export function NutritionQualityCard({ clientId, className }: { clientId: string; className?: string }) {
  const read = useServerFn(getNutritionQualityFn);
  const cleo = useCleoAccess();
  const q = useQuery({
    queryKey: nutritionQualityKey(clientId),
    queryFn: () => read({ data: { clientId } }),
    staleTime: 60_000,
  });
  if (!q.data?.quality) return null;
  return (
    <QualityScoreCard
      title="Nutrition plan quality"
      quality={q.data.quality}
      className={className}
      optimizeLabel={cleo ? "Optimize with Cleo" : "Optimize the plan"}
      onOptimize={(ask) => openNutritionCleo(clientId, ask)}
    />
  );
}
