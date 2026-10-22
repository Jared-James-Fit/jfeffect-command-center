import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { usePortalUserId, useClientImpersonation } from "@/lib/client-impersonation";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { useClientCalendarSources } from "@/lib/calendar-sources";
import { ClientSessionList, RequestChangeSheet } from "@/components/schedule/client-session-list";
import { CalendarSyncCard } from "@/components/schedule/calendar-sync-card";
import { ClientBookCard } from "@/components/schedule/client-book-card";
import { MySessionRequests } from "@/components/schedule/request-session-sheet";
import { listMyBookingTypes } from "@/lib/booking.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { useServerFn } from "@tanstack/react-start";

/**
 * The client's one Calendar (this replaced separate Calendar, Appointments,
 * Events and Schedule pages, which showed the same things several ways). It
 * opens on the calendar itself, so nobody has to scroll to find it:
 *   1. The calendar: workouts, sessions, cardio, check-ins, events, key dates
 *      (?date=yyyy-mm-dd opens on that day: a day tapped on Home).
 *   2. Sessions: "Request a session" (the coach approves it in chat), the
 *      booking types the coach opened to them, what's pending and booked, and
 *      "Need to change it?".
 *   3. One-time phone calendar setup (Google, Apple, Outlook, any app).
 */
export const Route = createFileRoute("/_authenticated/portal/calendar")({
  validateSearch: (s: Record<string, unknown>): { sync?: 1; date?: string } => ({
    ...(s.sync === 1 || s.sync === "1" ? { sync: 1 as const } : {}),
    ...(typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? { date: s.date } : {}),
  }),
  head: () => ({ meta: [{ title: "Calendar" }] }),
  component: CalendarPage,
});

function CalendarPage() {
  const portalUserId = usePortalUserId();
  const { sync, date } = Route.useSearch();
  const { isImpersonating, client: povClient } = useClientImpersonation();
  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  // Days on screen, so their Google events load for the month they're looking at.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const { items, isLoading } = useClientCalendarSources(client?.id, { googleRange: range });
  const [changing, setChanging] = useState<any>(null);
  // In-app booking replaces the old per-client external booking link when it's set up.
  const pov = usePovArgs();
  const typesFn = usePovFn(useServerFn(listMyBookingTypes));
  const { data: bookable = [] } = useQuery({
    queryKey: ["my-booking-types", pov.viewAsClientId ?? null],
    enabled: !!client?.id,
    queryFn: () => typesFn({ data: {} }),
    staleTime: 5 * 60_000,
  });

  return (
    <>
      <PageHeader title="Calendar" subtitle="Your workouts, sessions and key dates." />
      <div className="space-y-5 p-4 sm:p-6 md:p-8">
        {isImpersonating && (
          <Card className="border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
            <div className="flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-bold uppercase tracking-widest">Admin POV — {povClient?.full_name ?? "Client"}</div>
                <div className="mt-0.5 text-amber-200/80">Showing exactly what this client sees. Change requests are disabled in preview.</div>
              </div>
            </div>
          </Card>
        )}

        {/* The calendar first: it's what people come here for. */}
        <section aria-label="Calendar">
          <CalendarBoard
            key={date ?? "today"}
            items={items}
            isLoading={isLoading}
            initialDate={date ?? null}
            onRangeChange={(r) => setRange({ from: r.from, to: r.to })}
            views={["month", "week", "upcoming"]}
            emptyHint="Workouts, sessions, check-ins and coach events show up here as they're scheduled."
            renderItemActions={(item, close) =>
              item.kind === "pt_session" && item.status === "Scheduled" ? (
                <Button
                  variant="outline"
                  className="h-11 w-full"
                  onClick={() => {
                    close();
                    setChanging(item.raw);
                  }}
                >
                  Need to change it?
                </Button>
              ) : null
            }
          />
        </section>

        {/* Sessions: request (always), book (when the coach opened booking), what's pending and booked. */}
        {client?.id && (
          <MySessionRequests clientId={client.id} isPov={isImpersonating}>
            <ClientBookCard />
          </MySessionRequests>
        )}
        {client?.id && <ClientSessionList clientId={client.id} />}

        {client?.id && <CalendarSyncCard autoOpen={sync === 1 && !isImpersonating} />}
        {client?.id && (
          <RequestChangeSheet clientId={client.id} session={changing} onClose={() => setChanging(null)} isPov={isImpersonating} />
        )}

        {client?.calendar_link && bookable.length === 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-border bg-card p-4">
            <div>
              <h2 className="text-sm font-bold">Book a call</h2>
              <p className="text-xs text-muted-foreground">Pick a time that works for you.</p>
            </div>
            <a href={client.calendar_link} target="_blank" rel="noreferrer">
              <Button className="bg-gradient-primary font-bold uppercase">Open booking <ExternalLink className="ml-2 h-4 w-4" /></Button>
            </a>
          </Card>
        )}
      </div>
    </>
  );
}
