/**
 * Nutrition plan quality at the top of the coach's Nutrition tab (Nov 23 2026;
 * the shared strip Nov 24 2026): the current plan's design scored against this
 * client's goal, results, training, cardio and food on file
 * (nutrition-targets/plan-quality.ts), how it's being followed beside it, and
 * Optimize with Cleo opening the docked panel with the ranked brief. Hidden with
 * no plan.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getNutritionQualityFn } from "@/lib/cardio/cardio.functions";
import { PlanIntelligence } from "@/components/plan-quality/plan-intelligence";
import { openNutritionCleo, optimizeNutritionCleo } from "@/components/nutrition/nutrition-cleo-dock";
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
  if (!q.isLoading && !q.error && !q.data?.quality) return null;
  return (
    <PlanIntelligence
      domain="nutrition"
      clientKey={clientId}
      quality={q.data?.quality ?? null}
      loading={q.isLoading}
      error={q.error ? String((q.error as any)?.message ?? q.error) : null}
      onRetry={() => void q.refetch()}
      cleo={cleo}
      className={className}
      onOptimize={(quality) => optimizeNutritionCleo(clientId, quality)}
      onAskCleo={() => openNutritionCleo(clientId)}
    />
  );
}
