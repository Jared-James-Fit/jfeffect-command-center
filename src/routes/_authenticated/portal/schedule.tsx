import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { usePortalUserId } from "@/lib/client-impersonation";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { ScheduleManagerShell } from "@/components/schedule/ScheduleManagerShell";
import { MissedWorkoutCard } from "@/components/schedule/MissedWorkoutCard";

export const Route = createFileRoute("/_authenticated/portal/schedule")({
  head: () => ({ meta: [{ title: "Training Schedule" }] }),
  component: SchedulePage,
});

function SchedulePage() {
  const portalUserId = usePortalUserId();
  const { data: client, isLoading } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  if (isLoading || !client) {
    return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  return (
    <div className="space-y-4 px-3 sm:px-6 py-4 max-w-6xl mx-auto">
      <PageHeader title="Training Schedule" subtitle="Move, drag, or bulk reschedule your workouts. Your program & logs are never modified." />
      <MissedWorkoutCard clientId={client.id} />
      <ScheduleManagerShell clientId={client.id} mode="client" />
    </div>
  );
}
