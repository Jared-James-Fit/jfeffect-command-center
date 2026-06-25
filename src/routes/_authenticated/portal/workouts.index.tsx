import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
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
      <div className="p-6">
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workouts…
        </Card>
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