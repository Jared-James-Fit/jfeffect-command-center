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
import { listMyBookingTypes } from "@/lib/booking.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { useServerFn } from "@tanstack/react-start";

/**
 * The client's one Schedule (this replaced separate Calendar, Appointments and
 * Events pages, which showed the same things three ways):
 *   1. Book: the booking types the coach opened to them (no form, signed in).
 *   2. Your sessions: what's booked, where, and "Need to change it?"
 *   3. The calendar: sessions, workouts, cardio, check-ins, events, key dates.
 *   4. One-time phone calendar setup (Google, Apple, Outlook, any app).
 */
export const Route = createFileRoute("/_authenticated/portal/calendar")({
  head: () => ({ meta: [{ title: "Schedule" }] }),
  component: SchedulePage,
});

function SchedulePage() {
  const portalUserId = usePortalUserId();
  const { isImpersonating, client: povClient } = useClientImpersonation();
  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const { items, isLoading } = useClientCalendarSources(client?.id);
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
      <PageHeader title="Schedule" subtitle="Your sessions, training and key dates." />
      <div className="space-y-6 p-4 sm:p-6 md:p-8">
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

        {client?.id && <ClientBookCard />}
        {client?.id && <ClientSessionList clientId={client.id} />}

        <section className="space-y-2">
          <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Calendar</h2>
          <CalendarBoard
            items={items}
            isLoading={isLoading}
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

        {client?.id && <CalendarSyncCard />}
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
