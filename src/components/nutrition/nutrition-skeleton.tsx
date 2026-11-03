import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Nutrition page's two plan cards while the plan loads, in the spots and at
 * about the sizes they open into, so the meal plan never drops in above the
 * targets and pushes the page down.
 */
export function MealPlanCardSkeleton() {
  return (
    <Card className="space-y-4 p-4 md:p-5" role="status" aria-label="Loading your meal plan">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-14 rounded-full" />
        ))}
      </div>
      <div className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-3.5 w-full" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-40 max-w-[60%]" />
            <Skeleton className="h-3.5 w-12" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TargetsCardSkeleton() {
  return (
    <Card className="space-y-4 p-4 md:p-5" role="status" aria-label="Loading your targets">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-8 w-28" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      ))}
    </Card>
  );
}
