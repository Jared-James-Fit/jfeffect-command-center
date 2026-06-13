import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = ["calendar", "events"] as const;
type Tab = typeof TABS[number];

export const Route = createFileRoute("/_authenticated/media/calendar")({
  validateSearch: (s) => z.object({ tab: z.enum(TABS).optional() }).parse(s),
  component: CalendarWorkspace,
});

function CalendarWorkspace() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const active: Tab = tab ?? "calendar";
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground">Content schedule and upcoming events.</p>
      </header>
      <Tabs value={active} onValueChange={(v) => navigate({ to: "/media/calendar", search: { tab: v as Tab }, replace: true })}>
        <TabsList>
          <TabsTrigger value="calendar">Content Calendar</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>
        <TabsContent value="calendar" className="mt-4">
          <Card className="p-4 text-sm text-muted-foreground">
            Plan content shoots, posts, and campaigns. Calendar connects to scheduled events and broadcast drafts.
          </Card>
        </TabsContent>
        <TabsContent value="events" className="mt-4"><EventsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function EventsTab() {
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
    <div className="space-y-2">
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
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
  );
}