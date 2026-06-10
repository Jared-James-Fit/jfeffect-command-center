import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { getEvent } from "@/lib/events";
import { ClientEventDetail } from "@/components/events/client-event-detail";

export const Route = createFileRoute("/_authenticated/portal/events/$id")({
  component: ClientEventDetailPage,
});

function ClientEventDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["portal-event", id],
    queryFn: () => getEvent(id),
  });
  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!data?.event) return <div className="p-6 text-sm text-muted-foreground">Event not found.</div>;
  return (
    <div className="space-y-4">
      <PageHeader title="Event" backTo="/portal/events" backLabel="Events" />
      <ClientEventDetail
        event={data.event}
        links={data.links}
        deadlines={data.deadlines}
        reminders={data.reminders}
      />
    </div>
  );
}
