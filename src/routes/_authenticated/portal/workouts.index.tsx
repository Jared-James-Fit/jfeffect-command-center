import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
import { WorkoutsExperience } from "@/components/workouts/WorkoutsExperience";
import { WorkoutArchiveSection } from "@/components/workout-archive-section";
import { getClientWorkouts } from "@/lib/pl-programs";
import type { WorkoutItem } from "@/lib/workout-today";

export const Route = createFileRoute("/_authenticated/portal/workouts/")({
  component: WorkoutsPage,
});

function WorkoutsPage() {
  const portalUserId = usePortalUserId();
  const queryClient = useQueryClient();
  // Fetch the client record AND their workout schedule together, then prime
  // the React Query cache for ["my-workouts", clientId] so the child
  // <WorkoutsExperience /> renders with data already present — no second
  // "Loading your schedule…" flash after the page paints.
  const { data, isLoading } = useQuery({
    queryKey: ["my-workouts-page", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const client = (
        await supabase
          .from("clients")
          .select("id, full_name")
          .eq("user_id", portalUserId!)
          .maybeSingle()
      ).data;
      if (!client) return { client: null as null, items: [] as WorkoutItem[] };
      const items = (await getClientWorkouts(client.id)) as WorkoutItem[];
      queryClient.setQueryData(["my-workouts", client.id], items);
      return { client, items };
    },
  });
  const client = data?.client ?? null;

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