import { useMemo, useState, type ReactNode } from "react";
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
import {
  ActionPill, AGENDA_ACTION, AGENDA_LINK, AGENDA_ROW, AgendaCard, AgendaEmpty, AgendaFooter, AgendaHeader, AgendaLoading,
  AgendaNext, AgendaNextRow, AgendaRow, FAMILY_ACCENT, hasEnded, NowLine, nowLineIndex, shortDay, startLabel, useNow,
} from "@/components/schedule/agenda";
/** Rows in "next up" on Home; the rest is on the Schedule page. */
const HOME_UPCOMING_ROWS = 3;

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
  // Sessions open the Schedule, where "Need to change it?" lives.
  return item.href ?? (item.kind === "pt_session" || item.kind === "appointment" ? { to: "/portal/calendar" } : null);
}

/** A row that links in-app, opens Google in a new tab, or is plain text. */
function RowLink({ item, links, className, children }: { item: CalendarItem; links: boolean; className?: string; children: ReactNode }) {
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
 * Client Home: today as a short agenda, then what's next, in the Home look
 * every account shares (schedule/agenda.tsx). Today's workout says its week
 * and offers Start / Continue / Done; the next few things follow one line
 * each; then "Request a session" (or Book) and "Full schedule". Weeks, months
 * and blocks stay on the Workouts calendar; everything at once is on the
 * Schedule page.
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
  // A dashboard, not a calendar: today, then only the next few things.
  const agenda = useMemo(() => buildHomeAgenda(items, { today, maxUpcoming: HOME_UPCOMING_ROWS }), [items, today]);
  const nowMs = useNow();
  const nowIndex = useMemo(() => nowLineIndex(agenda.today, nowMs), [agenda.today, nowMs]);
  const singleBook = bookable.length === 1 && !pov.viewAsClientId ? bookable[0] : null;

  const dateLine = todayDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const singleBook = bookable.length === 1 && !pov.viewAsClientId ? bookable[0] : null;

  return (
    <AgendaCard>
      <AgendaHeader today={today} />

      <div className="mt-1.5">
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
      </div>

      {/* Next: the next few things only; the full schedule is one tap away. */}
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
            Full schedule
            <ChevronRight className="h-4 w-4" />
          </Link>
        </AgendaFooter>
      )}

      {links && (
        <RequestSessionSheet open={requesting} onOpenChange={setRequesting} isPov={!!pov.viewAsClientId} initialDate={today} />
      )}
    </AgendaCard>
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
