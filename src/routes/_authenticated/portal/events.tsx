import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { EventCard } from "@/components/events/event-card";
import type { EventRow } from "@/lib/events";

export const Route = createFileRoute("/_authenticated/portal/events")({
  component: PortalEventsPage,
});

function PortalEventsPage() {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const { data, isLoading } = useQuery({
    queryKey: ["portal-events"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("events") as any)
        .select("*")
        .in("status", ["Active", "Completed"])
        .order("event_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const { upcoming, past } = useMemo(() => {
    const list = data ?? [];
    return {
      upcoming: list.filter((e) => e.event_date >= todayIso),
      past: list.filter((e) => e.event_date < todayIso),
    };
  }, [data, todayIso]);

  const rows = tab === "upcoming" ? upcoming : past;

  return (
    <div className="space-y-4">
      <PageHeader title="Events" subtitle="Your upcoming meets, shoots, and key dates." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "upcoming" | "past")}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="past">Completed ({past.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0,1,2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {tab === "upcoming" ? "No upcoming events." : "No past events yet."}
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((ev) => (
            <EventCard key={ev.id} ev={ev} to="/portal/events/$id" params={{ id: ev.id }} />
          ))}
        </div>
      )}
    </div>
  );
}
