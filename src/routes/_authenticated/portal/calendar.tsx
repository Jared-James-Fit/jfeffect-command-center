import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { usePortalUserId } from "@/lib/client-impersonation";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalIcon, ExternalLink, MapPin, Clock } from "lucide-react";
import { statusTone, fmtTimeRange } from "@/lib/pt-sessions";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { useClientCalendarSources } from "@/lib/calendar-sources";

export const Route = createFileRoute("/_authenticated/portal/calendar")({ component: CalendarPage });

function CalendarPage() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const { items, isLoading } = useClientCalendarSources(client?.id);

  const { data: sessions = [] } = useQuery({
    queryKey: ["my-sessions", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("pt_sessions")
        .select("*")
        .eq("client_id", client!.id)
        .order("session_date", { ascending: true })
        .order("start_time", { ascending: true });
      return data ?? [];
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sessions.filter((s: any) => s.session_date >= today && s.status === "Scheduled");
  const past = sessions.filter((s: any) => s.session_date < today || s.status !== "Scheduled");

  return (
    <>
      <PageHeader title="Calendar" subtitle="Your upcoming training sessions." />
      <div className="p-6 md:p-8 space-y-6">
        <CalendarBoard
          items={items}
          isLoading={isLoading}
          emptyHint="Workouts, events, check-ins, and sessions will appear here as your coach schedules them."
        />

        {client?.calendar_link && (
          <Card className="border-border bg-card p-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Book a call</h2>
              <p className="text-xs text-muted-foreground">Set up a call with Coach Jared.</p>
            </div>
            <a href={client.calendar_link} target="_blank" rel="noreferrer">
              <Button className="bg-gradient-primary font-bold uppercase">Open Booking <ExternalLink className="ml-2 h-4 w-4" /></Button>
            </a>
          </Card>
        )}

        <Card className="border-border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <CalIcon className="h-4 w-4" /> Upcoming Sessions
          </h2>
          {upcoming.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No upcoming sessions.</div>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((s: any) => <SessionRow key={s.id} s={s} />)}
            </ul>
          )}
        </Card>

        {past.length > 0 && (
          <Card className="border-border bg-card p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-muted-foreground">Past Sessions</h2>
            <ul className="space-y-2">
              {past.slice(0, 20).map((s: any) => <SessionRow key={s.id} s={s} compact />)}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function SessionRow({ s, compact }: { s: any; compact?: boolean }) {
  return (
    <li className={`rounded-md border border-border bg-secondary/20 p-3 ${compact ? "" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusTone(s.status)}>{s.status}</Badge>
          <span className="text-sm font-semibold">{s.title}</span>
          <span className="text-xs text-muted-foreground">· {s.session_type}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(s.session_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtTimeRange(s.start_time, s.end_time)}</span>
        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {s.location}</span>
      </div>
      {s.client_visible_notes && s.notes && <p className="mt-2 text-xs text-foreground/80">{s.notes}</p>}
    </li>
  );
}