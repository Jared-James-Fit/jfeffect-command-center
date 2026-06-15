import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, ArrowRight } from "lucide-react";
import { computeCountdown, formatEventWhen, importanceBadgeClass, type EventRow } from "@/lib/events";
import { todayLocalISO } from "@/lib/today";

export function UpcomingEventsPanel({
  audience, max = 5,
}: { audience: "admin" | "client"; max?: number }) {
  const { data } = useQuery({
    queryKey: ["upcoming-events", audience, max],
    queryFn: async () => {
      const today = todayLocalISO();
      let q = (supabase.from("events") as any).select("*").gte("event_date", today).order("event_date").limit(max);
      if (audience === "admin") q = q.in("status", ["Active", "Draft"]);
      else q = q.eq("status", "Active");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  if (!data || data.length === 0) return null;

  const toBase = audience === "admin" ? "/admin/events/$id" : "/portal/events/$id";
  const listLink = audience === "admin" ? "/admin/events" : "/portal/events";

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm font-semibold">
          <Calendar className="h-4 w-4" />Upcoming Events
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to={listLink}>View all<ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {data.map((ev) => {
          const c = computeCountdown(ev.event_date);
          return (
            <Link key={ev.id} to={toBase} params={{ id: ev.id }}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3 transition-colors hover:bg-secondary">
              <div className="min-w-0">
                <div className="truncate font-semibold">{ev.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">{ev.event_type}</Badge>
                  <Badge className={`text-[10px] ${importanceBadgeClass(ev.importance)}`}>{ev.importance}</Badge>
                  <span>{formatEventWhen(ev)}</span>
                </div>
              </div>
              <Badge variant="secondary">{c.label}</Badge>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
