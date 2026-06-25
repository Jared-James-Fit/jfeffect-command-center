import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkoutsExperience } from "@/components/workouts/WorkoutsExperience";
import { WorkoutArchiveSection } from "@/components/workout-archive-section";


export const Route = createFileRoute("/_authenticated/portal/workouts/")({
  component: WorkoutsPage,
});

function WorkoutsPage() {
  const portalUserId = usePortalUserId();
  // Resolve the client row first (fast single-row lookup) and render the
  // workouts shell as soon as it's known. The heavier workout-schedule
  // queries fire in parallel from <WorkoutsExperience />, so the page no
  // longer blocks on the full ~6-query getClientWorkouts() chain before
  // showing anything. This is the difference between an instant paint and
  // a multi-second blank/loading state on mobile.
  const { data: client, isLoading } = useQuery({
    queryKey: ["portal-workouts-client", portalUserId],
    enabled: !!portalUserId,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await supabase
          .from("clients")
          .select("id, full_name")
          .eq("user_id", portalUserId!)
          .maybeSingle()
      ).data,
  });

  if (isLoading || !client) {
    return (
      <div className="space-y-4 p-4 md:p-6" aria-busy="true" aria-live="polite">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-20 w-full" />
            </Card>
          ))}
        </div>
        <span className="sr-only">Loading workouts…</span>
      </div>
    );
  }

  return (
    <>
      <WorkoutsExperience clientId={client.id} mode="self" />
      <div className="px-4 pb-24 md:px-6">
        <WorkoutArchiveSection clientId={client.id} mode="client" />
      </div>
    </>
  );
}