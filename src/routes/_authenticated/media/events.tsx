import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/media/events")({
  component: EventsPage,
});

function EventsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events").select("id, name, event_date, review_status, status").order("event_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-black">Events</h1>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      <div className="space-y-2">
        {(data ?? []).map((e: any) => (
          <Card key={e.id} className="p-3 flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-medium truncate">{e.name}</div>
              <div className="text-xs text-muted-foreground">{e.event_date}</div>
            </div>
            <Badge variant="outline">{e.review_status}</Badge>
          </Card>
        ))}
        {!isLoading && (data ?? []).length === 0 && <div className="text-sm text-muted-foreground">No events yet.</div>}
      </div>
    </div>
  );
}