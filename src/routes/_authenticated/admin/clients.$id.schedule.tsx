import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { ScheduleManagerShell } from "@/components/schedule/ScheduleManagerShell";

export const Route = createFileRoute("/_authenticated/admin/clients/$id/schedule")({
  head: () => ({ meta: [{ title: "Client Schedule" }] }),
  component: ClientSchedulePage,
});

function ClientSchedulePage() {
  const { id } = Route.useParams();
  const { data: client, isLoading } = useQuery({
    queryKey: ["admin-client", id],
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("id", id).maybeSingle()).data,
  });
  if (isLoading) {
    return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  return (
    <div className="space-y-4 px-3 sm:px-6 py-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to="/admin/clients/$id" params={{ id }}><ArrowLeft className="h-4 w-4 mr-1" /> Back to client</Link>
        </Button>
      </div>
      <PageHeader title={`${client?.full_name ?? "Client"} — Schedule`} subtitle="Reschedule workouts, override completed dates, and lock client edits." />
      <ScheduleManagerShell clientId={id} mode="coach" />
    </div>
  );
}
