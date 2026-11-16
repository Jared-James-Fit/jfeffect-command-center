import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { usePortalUserId, useClientImpersonation } from "@/lib/client-impersonation";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronRight, Dumbbell, ExternalLink } from "lucide-react";
import { CalendarBoard, type ViewMode } from "@/components/calendar/calendar-board";
import { scheduleTitle, useClientCalendarSources, type CalendarItem } from "@/lib/calendar-sources";
import { toLocalISO } from "@/lib/today";
import { ClientSessionList } from "@/components/schedule/client-session-list";
import { ClientSessionSheet } from "@/components/schedule/client-session-sheet";
import { CalendarSyncCard } from "@/components/schedule/calendar-sync-card";
import { ClientBookCard } from "@/components/schedule/client-book-card";
import { MySessionRequests, RequestSessionSheet } from "@/components/schedule/request-session-sheet";
import { useEntitlement } from "@/lib/service-tier";
import { useCalendarPrefs } from "@/lib/calendar-prefs";
import { listMyBookingTypes } from "@/lib/booking.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { useServerFn } from "@tanstack/react-start";

/**
 * The client's one Calendar (this replaced separate Calendar, Appointments,
 * Events and Schedule pages, which showed the same things several ways): it's
 * for appointments and organizing the week. The workout schedule day by day
 * is the Workouts tab's; here it's one way in (today's workout). It opens on
 * the calendar itself, so nobody has to scroll to find it:
 *   0. Today's workout (or Workouts on a rest day): the way in to training.
 *   1. The calendar: sessions, appointments, check-ins, coach events, key
 *      dates, Google, read like the coach's (Day and Week timelines, a month
 *      of what's on each day, List: what's coming), the view remembered on
 *      their account (?date=yyyy-mm-dd opens Day on that day). Tapping a
 *      session opens its quick view (ClientSessionSheet): details, Change
 *      time (a new time + why, for the coach to approve), Can't make it. A
 *      coaching client's tap on empty time on a day ahead asks for a session
 *      then.
 *   2. Sessions: "Request a session" (the coach approves it in chat), the
 *      booking types the coach opened to them, what's pending and booked
 *      (Change time / Can't make it on each).
 *   3. One-time phone calendar setup (Google, Apple, Outlook, any app).
 */
/** A client's calendar is sparse (a few sessions a week at most), so it opens on List, what's coming, until they pick. */
const CLIENT_VIEWS: ViewMode[] = ["day", "week", "month", "upcoming"];
const CLIENT_DEFAULT_VIEW: ViewMode = "upcoming";

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
  const canRequest = useEntitlement("pt_sessions");
  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  // Days on screen, so their Google events load for the month they're looking at.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const { items, isLoading } = useClientCalendarSources(client?.id, { googleRange: range });
  // Appointments and dates only: workouts (and the cardio riding with them) are the Workouts schedule's.
  const calendarItems = useMemo(() => items.filter((i) => i.kind !== "workout" && i.kind !== "cardio"), [items]);
  const today = toLocalISO(new Date());
  const todaysWorkout = useMemo(() => items.find((i) => i.kind === "workout" && i.date === today) ?? null, [items, today]);
  // Tapping a session opens its quick view (details, Change time, Can't make it).
  const [openSession, setOpenSession] = useState<any>(null);
  // Their view, remembered on their account (a coach previewing keeps his picks to the visit);
  // a day tapped on Home opens Day on it for this visit.
  const { prefs, setPrefs } = useCalendarPrefs({ local: isImpersonating });
  const [dayOverride, setDayOverride] = useState<boolean>(!!date);
  const view: ViewMode = dayOverride ? "day" : prefs.boardView ?? CLIENT_DEFAULT_VIEW;
  const chooseView = (v: ViewMode) => {
    setDayOverride(false);
    setPrefs({ boardView: v });
  };
  // A tap on empty time on a day ahead asks for a session then (the coach approves it in chat).
  const [asking, setAsking] = useState<{ date: string; time?: string } | null>(null);
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
      <PageHeader title="Calendar" subtitle="Your sessions, appointments and key dates." />
      <div className="space-y-5 p-4 sm:p-6 md:p-8">
        {isImpersonating && (
          <Card className="border-warning/40 p-3">
            <div className="flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <div className="text-sm font-semibold">Viewing as {povClient?.full_name ?? "the client"}</div>
                <div className="mt-0.5 text-muted-foreground">Showing exactly what this client sees. Change requests are disabled in preview.</div>
              </div>
            </div>
          </Card>
        )}

        {/* The way in to training; the schedule itself is on Workouts. */}
        {client?.id && !isLoading && <TodayWorkoutLink item={todaysWorkout} />}

        {/* The calendar first: it's what people come here for. */}
        <section aria-label="Calendar">
          <CalendarBoard
            key={date ?? "today"}
            timeline
            items={calendarItems}
            isLoading={isLoading}
            initialDate={date ?? null}
            onRangeChange={(r) => setRange({ from: r.from, to: r.to })}
            views={CLIENT_VIEWS}
            view={view}
            onViewChange={chooseView}
            onCreate={canRequest && client?.id ? (d, time) => setAsking({ date: d, time }) : undefined}
            createButton={false}
            canCreateOn={(d) => d > today}
            slotVerb="Request a session"
            emptyHint="Sessions, appointments, check-ins and coach events show up here as they're booked."
            onItemSelect={(item) => {
              if (item.kind !== "pt_session" || !item.raw) return false;
              setOpenSession(item.raw);
              return true;
            }}
          />
        </section>

        {/* Sessions: request (coaching clients), book (when the coach opened booking), what's pending and booked.
            A JF member only books: a request's answer goes to the coach chat they don't have. */}
        {client?.id && (canRequest ? (
          <MySessionRequests clientId={client.id} isPov={isImpersonating}>
            <ClientBookCard />
          </MySessionRequests>
        ) : <ClientBookCard />)}
        {client?.id && <ClientSessionList clientId={client.id} />}

        {client?.id && <CalendarSyncCard autoOpen={sync === 1 && !isImpersonating} />}
        {client?.id && (
          <ClientSessionSheet clientId={client.id} session={openSession} onClose={() => setOpenSession(null)} />
        )}
        {client?.id && canRequest && (
          <RequestSessionSheet
            open={!!asking}
            onOpenChange={(o) => {
              if (!o) setAsking(null);
            }}
            isPov={isImpersonating}
            initialDate={asking?.date ?? null}
            initialTime={asking?.time ?? null}
            clientId={client.id}
          />
        )}

        {client?.calendar_link && bookable.length === 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-border bg-card p-4">
            <div>
              <h2 className="text-base font-semibold">Book a call</h2>
              <p className="text-xs text-muted-foreground">Pick a time that works for you.</p>
            </div>
            <a href={client.calendar_link} target="_blank" rel="noreferrer">
              <Button className="h-10 font-semibold">Open booking <ExternalLink className="ml-2 h-4 w-4" /></Button>
            </a>
          </Card>
        )}
      </div>
    </>
  );
}

/** Today's workout (Open / View), or on a rest day the Workouts tab: one row, never the schedule. */
function TodayWorkoutLink({ item }: { item: CalendarItem | null }) {
  const href = item?.href ?? null;
  const done = item?.status === "Completed";
  return (
    <Link
      to={(href?.to ?? "/portal/workouts") as any}
      params={href?.params as any}
      search={href?.search as any}
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 transition active:bg-secondary/40"
    >
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
        <Dumbbell className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">
          {item ? "Today's workout" : "Workouts"}
        </span>
        <span className="block truncate text-sm font-semibold">{item ? scheduleTitle(item) : "Your training schedule, day by day"}</span>
      </span>
      <span className="inline-flex shrink-0 items-center text-xs font-semibold text-muted-foreground">
        {item ? (done ? "View" : "Open") : "Open"} <ChevronRight className="h-4 w-4" />
      </span>
    </Link>
  );
}
