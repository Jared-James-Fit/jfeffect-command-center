import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Workouts schedule while it loads, at its real sizes (the week strip's card
 * with its 40px header and 64px days, then the day's workout card), so the page
 * doesn't jump when the program arrives.
 */
export function ScheduleSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading your schedule">
      <Card className="p-2">
        <div className="mb-1 flex h-10 items-center justify-between px-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-4 w-4 rounded" />
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </Card>
      <WorkoutCardSkeleton />
    </div>
  );
}

/** One workout card: the day, how long, and its button. */
export function WorkoutCardSkeleton() {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-44 max-w-[60%]" />
        <Skeleton className="h-4 w-14" />
      </div>
      <Skeleton className="h-3.5 w-28" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
    </Card>
  );
}

/** The Program card under the schedule: name, bar, this block. */
export function ProgramCardSkeleton() {
  return (
    <Card className="space-y-3 p-4">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-3.5 w-56 max-w-[80%]" />
      <Skeleton className="h-3.5 w-48 max-w-[70%]" />
    </Card>
  );
}

/** The whole page under its title while the account is looked up: the same shape it opens into. */
export function WorkoutsBodySkeleton() {
  return (
    <div className="space-y-4 p-4 pb-32 md:p-6" aria-busy="true">
      <Skeleton className="h-10 w-full rounded-lg sm:w-72" />
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-44 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
      <ScheduleSkeleton />
      <ProgramCardSkeleton />
      <span className="sr-only">Loading workouts…</span>
    </div>
  );
}
