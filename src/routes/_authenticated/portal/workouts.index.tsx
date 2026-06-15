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
  const { data: client, isLoading } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () =>
      (await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle()).data,
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