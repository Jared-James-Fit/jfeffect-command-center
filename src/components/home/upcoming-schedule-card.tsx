import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, ChevronRight } from "lucide-react";
import { listMyBookingTypes } from "@/lib/booking.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { KIND_FAMILY, KIND_META, placeLabel, scheduleTitle, useClientCalendarSources, type CalendarItem } from "@/lib/calendar-sources";
import { buildHomeAgenda } from "@/lib/home-upcoming";
import { getWorkoutStatus } from "@/lib/workout-status";
import { compactTimeRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import { RequestSessionSheet } from "@/components/schedule/request-session-sheet";
import { ClientSessionSheet, type ClientSession } from "@/components/schedule/client-session-sheet";
import {
  ActionPill, AGENDA_ACTION, AGENDA_LINK, AGENDA_ROW, AgendaCard, AgendaEmpty, AgendaFooter, AgendaHeader, AgendaLoading, AgendaToday, AgendaWeek,
  AgendaNext, AgendaNextRow, AgendaRow, FAMILY_ACCENT, hasEnded, NowLine, nowLineIndex, shortDay, startLabel, useNow,
} from "@/components/schedule/agenda";
/** Rows in "coming up" on Home; the rest is on the Calendar page. */
const HOME_UPCOMING_ROWS = 3;
/** How far ahead "coming up" looks: appointments are sparse, so a month. */
const HOME_CALENDAR_DAYS = 30;

/**
 * What the calendar is for: appointments, sessions, check-ins, coach events,
 * key dates and Google. Workouts (and the cardio that rides with them) are
 * the Workouts schedule's; the calendar only offers today's as a way in.
 */
function isCalendarItem(item: CalendarItem): boolean {
  return item.kind !== "workout" && item.kind !== "cardio";
}

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


function timeLabel(item: CalendarItem): string | null {
  if (!item.startsAt) return null;
  return compactTimeRange(item.startsAt, item.endsAt);
}

/** "Week 2 of 5" for a workout row; the block itself lives on the Workouts page. */
function workoutContext(raw: any): string | null {
  const wk = raw?.week?.week_index;
  const of = raw?.block?.weeks;
  return wk ? `Week ${wk}${of ? ` of ${of}` : ""}` : null;
}

/** What today's workout asks for: Start / Continue / done. */
function workoutAction(raw: any): { label: string; done: boolean } {
  const { status } = getWorkoutStatus(raw);
  if (["completed_today", "completed_on_scheduled", "completed_different_day"].includes(status)) return { label: "Done", done: true };
  if (status === "review_pending") return { label: "Review", done: false };
  if (status === "in_progress" || status === "incomplete") return { label: "Continue", done: false };
  return { label: "Start", done: false };
}

function itemLink(item: CalendarItem, links: boolean): { to: string; params?: any; search?: any } | null {
  if (!links) return null;
  // Sessions open their quick view (OpenSession); appointments the Calendar.
  return item.href ?? (item.kind === "pt_session" || item.kind === "appointment" ? { to: "/portal/calendar" } : null);
}

/** Opens a session's quick view (details, Change time, Can't make it) right here. */
const OpenSession = createContext<((session: ClientSession) => void) | null>(null);

/** A row that opens a session's quick view, links in-app, opens Google in a new tab, or is plain text. */
function RowLink({ item, links, className, children }: { item: CalendarItem; links: boolean; className?: string; children: ReactNode }) {
  const openSession = useContext(OpenSession);
  if (links && openSession && item.kind === "pt_session" && item.raw) {
    return (
      <button type="button" onClick={() => openSession(item.raw as ClientSession)} className={cn("block", className)}>
        {children}
      </button>
    );
  }
  const href = itemLink(item, links);
  if (href) {
    return (
      <Link to={href.to as any} params={href.params as any} search={href.search as any} className={cn("block", className)}>
        {children}
      </Link>
    );
  }
  const external = links && item.kind === "google_event" ? (item.raw?.external_url as string | undefined) : undefined;
  if (external) {
    return (
      <a href={external} target="_blank" rel="noreferrer" className={cn("block", className)}>
        {children}
      </a>
    );
  }
  return <div className={className}>{children}</div>;
}

/**
 * Client Home: their calendar card, in the look every account shares
 * (schedule/agenda.tsx). The calendar is for appointments and organizing the
 * week, plus the way in to today's workout: a date tile and "Calendar", this
 * week's days with a dot per appointment (each opens the Calendar page
 * there), today as a short agenda (today's workout says its week and offers
 * Start / Continue / Done), the next few appointments one line each, then
 * "Request a session" (or Book) and "Open calendar". The workout schedule
 * day by day is on Workouts.
 */
export function UpcomingScheduleCard({ clientId, links = true }: {
  clientId: string | null | undefined;
  /** False on a staff home (the person's own client account): no Book, no portal links. */
  links?: boolean;
}) {
  const { items, isLoading } = useClientCalendarSources(clientId);
  // "Book" shows when the coach has opened booking types to this client.
  const pov = usePovArgs();
  const typesFn = usePovFn(useServerFn(listMyBookingTypes));
  const { data: bookable = [] } = useQuery({
    queryKey: ["my-booking-types", pov.viewAsClientId ?? null],
    enabled: !!clientId && links,
    queryFn: () => typesFn({ data: {} }),
    staleTime: 5 * 60_000,
  });
  const today = isoToday();
  const [requesting, setRequesting] = useState(false);
  const [openSession, setOpenSession] = useState<ClientSession | null>(null);
  // Today in full (today's workout is the way in to it), then the next few
  // appointments and dates: the workout schedule itself lives on Workouts.
  const agenda = useMemo(
    () => buildHomeAgenda(items, { today, days: HOME_CALENDAR_DAYS, maxUpcoming: HOME_UPCOMING_ROWS, upcoming: isCalendarItem }),
    [items, today],
  );
  const nowMs = useNow();
  const nowIndex = useMemo(() => nowLineIndex(agenda.today, nowMs), [agenda.today, nowMs]);
  const singleBook = bookable.length === 1 && !pov.viewAsClientId ? bookable[0] : null;
  // A dot per appointment / date on each day of the week strip (not workouts).
  const dotsByDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items ?? []) {
      if (!it || !isCalendarItem(it) || it.status === "Cancelled") continue;
      m.set(it.date, [...(m.get(it.date) ?? []), it]);
    }
    const out = new Map<string, string[]>();
    for (const [d, list] of m) out.set(d, list.map((it) => FAMILY_ACCENT[KIND_FAMILY[it.kind]]));
    return out;
  }, [items]);

  return (
    <OpenSession.Provider value={setOpenSession}>
      <AgendaCard>
        <AgendaHeader today={today} link={links ? { to: "/portal/calendar" } : null} />
        <AgendaWeek
          today={today}
          dots={(d) => dotsByDay.get(d) ?? []}
          link={links ? (d) => ({ to: "/portal/calendar", search: { date: d } }) : null}
        />

        <AgendaToday>
          {isLoading && !items?.length ? (
            <AgendaLoading />
          ) : agenda.today.length === 0 ? (
            <AgendaEmpty>Nothing scheduled today. A good day to recover.</AgendaEmpty>
          ) : (
            <ol aria-label="Today">
              {agenda.today.map((item, i) => (
                <li key={item.id} className="min-w-0">
                  {i === nowIndex && <NowLine />}
                  <TodayRow item={item} links={links} past={hasEnded(item.startsAt, item.endsAt, nowMs)} />
                </li>
              ))}
              {nowIndex === agenda.today.length && (
                <li aria-hidden>
                  <NowLine />
                </li>
              )}
            </ol>
          )}
        </AgendaToday>

        {/* Next: the next few things only; the full calendar is one tap away. */}
        <AgendaNext show={agenda.upcoming.length > 0}>
          {agenda.upcoming.flatMap((day) =>
            day.items.map((item, i) => (
              <li key={item.id} className="min-w-0">
                <RowLink item={item} links={links} className={AGENDA_ROW}>
                  <AgendaNextRow
                    dayText={i === 0 ? shortDay(day.date, today) : ""}
                    accent={FAMILY_ACCENT[KIND_FAMILY[item.kind]]}
                    time={item.startsAt ? startLabel(item.startsAt) : null}
                    title={scheduleTitle(item)}
                    quiet={item.kind === "google_event"}
                    suffix={item.kind === "workout" && item.status === "Completed" ? <span className="font-normal text-emerald-500"> · Done</span> : null}
                  />
                </RowLink>
              </li>
            )),
          )}
        </AgendaNext>
        {!isLoading && agenda.upcoming.length === 0 && (
          <div className="mt-1.5 border-t border-border/60 pt-1">
            <AgendaEmpty>No appointments coming up.</AgendaEmpty>
          </div>
        )}

        {/* Actions, in words: ask for a session, or see everything. */}
        {links && (
          <AgendaFooter>
            {singleBook ? (
              <Link
                to="/book/$slug"
                params={{ slug: singleBook.slug }}
                search={{ name: "", email: "", phone: "", application_id: "", i: "" }}
                className={AGENDA_ACTION}
              >
                <CalendarPlus className="h-4 w-4" /> Book a session
              </Link>
            ) : bookable.length > 1 && !pov.viewAsClientId ? (
              <Link to="/portal/calendar" className={AGENDA_ACTION}>
                <CalendarPlus className="h-4 w-4" /> Book a session
              </Link>
            ) : (
              <button type="button" onClick={() => setRequesting(true)} className={AGENDA_ACTION}>
                <CalendarPlus className="h-4 w-4" /> Request a session
              </button>
            )}
            <Link to="/portal/calendar" className={AGENDA_LINK}>
              Open calendar
              <ChevronRight className="h-4 w-4" />
            </Link>
          </AgendaFooter>
        )}

        {links && (
          <RequestSessionSheet open={requesting} onOpenChange={setRequesting} isPov={!!pov.viewAsClientId} initialDate={today} clientId={clientId} />
        )}
        {links && clientId && (
          <ClientSessionSheet clientId={clientId} session={openSession} onClose={() => setOpenSession(null)} />
        )}
      </AgendaCard>
    </OpenSession.Provider>
  );
}

function TodayRow({ item, links, past }: { item: CalendarItem; links: boolean; past: boolean }) {
  const google = item.kind === "google_event";
  const isWorkout = item.kind === "workout" && !!item.raw;
  const action = isWorkout ? workoutAction(item.raw) : null;
  const range = timeLabel(item);
  const sub = isWorkout
    ? workoutContext(item.raw)
    : [range && range !== (item.startsAt ? startLabel(item.startsAt) : null) ? range : null, google ? "Google" : KIND_META[item.kind]?.label, placeLabel(item.location)]
        .filter(Boolean)
        .join(" · ");
  // Workouts put their action on the second line, so the title gets the full width.
  const trailing = action && (action.done || links) ? <ActionPill label={action.label} done={action.done} /> : null;
  return (
    <RowLink item={item} links={links} className={cn(AGENDA_ROW, past && "opacity-55")}>
      <AgendaRow
        time={item.startsAt ? startLabel(item.startsAt) : item.kind === "workout" ? "Anytime" : "All day"}
        timed={!!item.startsAt}
        accent={FAMILY_ACCENT[KIND_FAMILY[item.kind]]}
        title={scheduleTitle(item)}
        quiet={google}
        sub={sub}
        trailing={trailing}
        chevron={!action && !!itemLink(item, links)}
      />
    </RowLink>
  );
}
