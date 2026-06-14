import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { usePortalUserId, useClientImpersonation } from "@/lib/client-impersonation";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalIcon, ExternalLink, MapPin, Clock, AlertTriangle, ChevronDown } from "lucide-react";
import { statusTone, fmtTimeRange } from "@/lib/pt-sessions";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { useClientCalendarSources } from "@/lib/calendar-sources";
import { ClientTodayPanel } from "@/components/calendar/today-panel";

export const Route = createFileRoute("/_authenticated/portal/calendar")({ component: CalendarPage });

function CalendarPage() {
  const portalUserId = usePortalUserId();
  const { isImpersonating, client: povClient } = useClientImpersonation();
  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const { items, isLoading } = useClientCalendarSources(client?.id);

  const { data: nutritionUpdated } = useQuery({
    queryKey: ["my-nutrition-updated", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await (supabase.from("nutrition_targets") as any)
        .select("updated_at")
        .eq("client_id", client!.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.updated_at as string | null;
    },
  });

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
      <PageHeader title="Calendar" subtitle="Your day at a glance — workouts, check-ins, sessions, and key dates." />
      <div className="p-6 md:p-8 space-y-6">
        {isImpersonating && (
          <Card className="border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
            <div className="flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-bold uppercase tracking-widest">Admin POV — {povClient?.full_name ?? "Client"}</div>
                <div className="mt-0.5 text-amber-200/80">
                  Viewing this client's calendar as admin. All sources (events, check-ins, PT sessions, appointments,
                  workouts, key dates) are explicitly scoped to this client's id — but the underlying queries still run
                  under your admin JWT, so any row your admin role cannot read at all (e.g. a future RLS lockdown) would
                  also be hidden here.
                </div>
              </div>
            </div>
          </Card>
        )}

        <ClientTodayPanel items={items} nutritionUpdatedAt={nutritionUpdated ?? null} />

        <CalendarBoard
          items={items}
          isLoading={isLoading}
          emptyHint="Workouts, check-ins, appointments, PT sessions, and coach events will appear here as they're scheduled."
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

        {(upcoming.length > 0 || past.length > 0) && (
          <details className="group rounded-md border border-border bg-card/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
              <span className="flex items-center gap-2">
                <CalIcon className="h-3.5 w-3.5" /> PT Session Details
                <Badge variant="outline" className="text-[10px]">{upcoming.length} upcoming</Badge>
                {past.length > 0 && <Badge variant="outline" className="text-[10px]">{past.length} past</Badge>}
              </span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t border-border p-4">
              {upcoming.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Upcoming</div>
                  <ul className="space-y-2">
                    {upcoming.map((s: any) => <SessionRow key={s.id} s={s} />)}
                  </ul>
                </div>
              )}
              {past.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Past</div>
                  <ul className="space-y-2">
                    {past.slice(0, 20).map((s: any) => <SessionRow key={s.id} s={s} compact />)}
                  </ul>
                </div>
              )}
            </div>
          </details>
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