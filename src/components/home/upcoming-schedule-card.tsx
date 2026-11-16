import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus } from "lucide-react";
import { listMyBookingTypes } from "@/lib/booking.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { KIND_FAMILY, KIND_META, placeLabel, scheduleTitle, useClientCalendarSources, type CalendarItem } from "@/lib/calendar-sources";
import { buildHomeAgenda } from "@/lib/home-upcoming";
import { getWorkoutStatus } from "@/lib/workout-status";
import { blockNameParts } from "@/lib/training-roadmap";
import { compactTimeRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import { useEntitlement } from "@/lib/service-tier";
import { useCalendarPrefs, type HomeView } from "@/lib/calendar-prefs";
import { homeRange, isCurrentPeriod, periodLabel, shiftAnchor } from "@/lib/home-calendar";
import { blockLabels, callLabel } from "@/lib/calendar-labels";
import { monthChipOrder } from "@/lib/calendar-timeline";
import { weekDays } from "@/components/calendar/week-strip";
import { TimeGrid, type TimeGridEntry } from "@/components/calendar/time-grid";
import { byDayThenTime, HomeMonth, HomeViewBar, HomeWeekList, type HomeEntry } from "@/components/schedule/home-calendar-views";
import { RequestSessionSheet } from "@/components/schedule/request-session-sheet";
import { ClientSessionSheet, type ClientSession } from "@/components/schedule/client-session-sheet";
import {
  ActionPill, AGENDA_ACTION, AGENDA_ROW, AgendaCard, AgendaEmpty, AgendaFooter, AgendaHeader, AgendaLoading, AgendaToday, AgendaWeek,
  AgendaNext, AgendaNextRow, AgendaRow, FAMILY_ACCENT, hasEnded, shortDay, startLabel, useNow,
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

/**
 * "Block 2 · Week 1 of 5" for a workout row: a bare "Week 1 of 5" didn't say
 * of what. The block's own name and the program live on the Workouts page.
 */
function workoutContext(raw: any): string | null {
  const wk = raw?.week?.week_index;
  const of = raw?.block?.weeks;
  const week = wk ? `Week ${wk}${of ? ` of ${of}` : ""}` : null;
  const tag = blockNameParts(raw?.block?.name)?.tag ?? null;
  return [tag, week].filter(Boolean).join(" · ") || null;
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
 * One calendar item as the shared Home pieces read it: what it is in bold, how
 * a call happens after it (never the gym's address on every line), and its
 * start time where a phone's month cell has no room for the title.
 */
function entryOf(item: CalendarItem): HomeEntry {
  const labels = blockLabels(item, false);
  return {
    key: item.id,
    date: item.date,
    startsAt: item.startsAt ?? null,
    endsAt: item.endsAt ?? null,
    family: KIND_FAMILY[item.kind],
    title: labels.title,
    short: labels.short,
    tiny: labels.tiny,
    what: callLabel(item.location),
    status: item.status ?? null,
  };
}

/**
 * Client Home: their calendar card, in the look every account shares
 * (schedule/agenda.tsx) and with the same four views as the coach's
 * (home-calendar-views.tsx), their choice remembered on their account:
 *   Day (the default): the week's days with a dot per appointment (tap one
 *     to show it here), that day's workout as the way in (today's says its
 *     week and offers Start / Continue / Done) and anything all day, its
 *     bookings on a timeline when it has any (a day with nothing at a time
 *     shows no empty hours), then the next few appointments after it.
 *   Week: the week's bookings on a timeline (tap a day's name for it).
 *   Month: what's on each day; a day opens it.
 *   List: the week's strip, then its bookings one line each, by day.
 * The calendar is for appointments and organizing the week: workouts are the
 * Workouts schedule's, so only the day's own workout shows (on Day). A tap on
 * empty time on a day ahead asks for a session there (coaching clients), a
 * session opens its quick view, and the footer asks for (or books) one. The
 * full calendar is the header's one link.
 */
export function UpcomingScheduleCard({ clientId, links = true }: {
  clientId: string | null | undefined;
  /** False on a staff home (the person's own client account): no Book, no portal links. */
  links?: boolean;
}) {
  const pov = usePovArgs();
  const previewing = !!pov.viewAsClientId;
  // Their own view, remembered on their account; a coach previewing keeps his picks to the visit.
  const { prefs, setPrefs } = useCalendarPrefs({ local: previewing });
  const savedView: HomeView = prefs.homeView ?? "day";
  // A day tapped in Week, Month or List opens on its own for this visit; the tabs are what's remembered.
  const [dayFocus, setDayFocus] = useState(false);
  const view: HomeView = dayFocus ? "day" : savedView;
  const today = isoToday();
  // The day shown (Day), or a day in the week / month on screen.
  const [anchor, setAnchor] = useState<string>(today);
  // "Today" scrolls the timeline back to now even when the day didn't change.
  const [jump, setJump] = useState(0);
  const range = useMemo(() => homeRange(view, anchor, today), [view, anchor, today]);
  const { items, isLoading } = useClientCalendarSources(clientId, { googleRange: range });
  // "Book" shows when the coach has opened booking types to this client.
  const typesFn = usePovFn(useServerFn(listMyBookingTypes));
  const { data: bookable = [] } = useQuery({
    queryKey: ["my-booking-types", pov.viewAsClientId ?? null],
    enabled: !!clientId && links,
    queryFn: () => typesFn({ data: {} }),
    staleTime: 5 * 60_000,
  });
  // Asking for a PT session is the coaching layer: the answer lands in the
  // coach chat, which a JF member doesn't have. Members book instead.
  const canRequest = useEntitlement("pt_sessions");
  const [requesting, setRequesting] = useState<{ date: string; time?: string } | null>(null);
  const [openSession, setOpenSession] = useState<ClientSession | null>(null);
  const navigate = useNavigate();
  const nowMs = useNow();

  const chooseView = (v: HomeView) => {
    setDayFocus(false);
    setPrefs({ homeView: v });
    setAnchor(today);
  };
  const step = (dir: -1 | 1) => setAnchor((a) => shiftAnchor(view, a, dir));
  const backToToday = () => {
    setAnchor(today);
    setJump((j) => j + 1);
  };
  const openDay = (d: string) => {
    setAnchor(d);
    if (savedView !== "day") setDayFocus(true);
  };

  // The day on screen in full (its workout is the way in to it), then the next
  // few appointments and dates after it: the workout schedule lives on Workouts.
  const agenda = useMemo(
    () => buildHomeAgenda(items, { today, day: anchor, nowMs, days: HOME_CALENDAR_DAYS, maxUpcoming: HOME_UPCOMING_ROWS, upcoming: isCalendarItem }),
    [items, today, anchor, nowMs],
  );
  // Day: rows for what has no time (the workout, anything all day), a timeline for what does.
  const dayRows = useMemo(() => agenda.today.filter((i) => i.kind === "workout" || !i.startsAt), [agenda.today]);
  const calendarItems = useMemo(() => (items ?? []).filter((i) => !!i && isCalendarItem(i)), [items]);
  const entries = useMemo<TimeGridEntry<CalendarItem>[]>(
    () =>
      calendarItems.map((it) => ({
        key: it.id,
        date: it.date,
        startsAt: it.startsAt ?? null,
        endsAt: it.endsAt ?? null,
        ...blockLabels(it, false),
        family: KIND_FAMILY[it.kind],
        status: it.status ?? null,
        ref: it,
      })),
    [calendarItems],
  );
  const dayTimed = useMemo(() => entries.filter((e) => e.date === anchor && !!e.startsAt), [entries, anchor]);
  const itemById = useMemo(() => new Map(calendarItems.map((i) => [i.id, i])), [calendarItems]);
  const homeEntries = useMemo(() => calendarItems.map(entryOf), [calendarItems]);
  // Month: what's on each day, sessions first then in time order (cancelled ones left out).
  const namesByDay = useMemo(() => {
    const m = new Map<string, HomeEntry[]>();
    for (const e of homeEntries) {
      if (e.status === "Cancelled") continue;
      m.set(e.date, [...(m.get(e.date) ?? []), e]);
    }
    for (const list of m.values()) list.sort(monthChipOrder);
    return m;
  }, [homeEntries]);
  const listRows = useMemo(
    () => (view === "list" ? homeEntries.filter((e) => e.date >= range.from && e.date <= range.to).sort(byDayThenTime) : []),
    [homeEntries, view, range.from, range.to],
  );
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

  /** A block opens what it is: the session's quick view, its page, or Google. */
  const openItem = (item: CalendarItem) => {
    if (!links) return;
    if (item.kind === "pt_session" && item.raw) return setOpenSession(item.raw as ClientSession);
    const href = itemLink(item, links);
    if (href) return void navigate({ to: href.to as any, params: href.params as any, search: href.search as any });
    const external = item.kind === "google_event" ? (item.raw?.external_url as string | undefined) : undefined;
    if (external) window.open(external, "_blank", "noopener,noreferrer");
  };
  // A tap on empty time on a day ahead asks for a session then (the coach approves it in chat).
  const requestAt = links && canRequest ? (date: string, time: string) => setRequesting({ date, time }) : undefined;
  const canAsk = (d: string) => d > today;
  const loading = isLoading && !items?.length;
  const dayLabel = periodLabel("day", anchor, today);

  return (
    <OpenSession.Provider value={setOpenSession}>
      <AgendaCard>
        <AgendaHeader today={today} link={links ? { to: "/portal/calendar" } : null} />
        <HomeViewBar
          view={view}
          onView={chooseView}
          label={periodLabel(view, anchor, today)}
          onStep={step}
          onToday={isCurrentPeriod(view, anchor, today) ? null : backToToday}
        />

        {view === "day" && (
          <>
            <AgendaWeek today={today} anchor={anchor} selected={anchor} onSelect={setAnchor} dots={(d) => dotsByDay.get(d) ?? []} />
            {loading ? (
              <AgendaToday>
                <AgendaLoading />
              </AgendaToday>
            ) : (
              <>
                {dayRows.length > 0 && (
                  <AgendaToday>
                    <ol aria-label={dayLabel}>
                      {dayRows.map((item) => (
                        <li key={item.id} className="min-w-0">
                          <TodayRow item={item} links={links} today={today} past={hasEnded(item.startsAt, item.endsAt, nowMs)} />
                        </li>
                      ))}
                    </ol>
                  </AgendaToday>
                )}
                {dayTimed.length > 0 && (
                  <div className="mt-1">
                    <TimeGrid
                      days={[anchor]}
                      entries={dayTimed}
                      today={today}
                      nowMs={nowMs}
                      onOpen={openItem}
                      onSlot={requestAt}
                      canSlot={canAsk}
                      slotVerb="Request a session"
                      compact
                      hourHeight={44}
                      heightClass="h-[min(20rem,46svh)] md:h-[min(30rem,56svh)]"
                      scrollKey={`day:${jump}`}
                      label={dayLabel}
                    />
                  </div>
                )}
                {dayRows.length === 0 && dayTimed.length === 0 && (
                  <AgendaToday>
                    <AgendaEmpty>{anchor === today ? "Nothing scheduled today. A good day to recover." : "Nothing scheduled."}</AgendaEmpty>
                  </AgendaToday>
                )}
              </>
            )}

            {/* Next: the next few things after the day shown; the full calendar is one tap away. */}
            <AgendaNext show={agenda.upcoming.length > 0}>
              {agenda.upcoming.flatMap((day) =>
                day.items.map((item, i) => (
                  <li key={item.id} className="min-w-0">
                    <RowLink item={item} links={links} className={AGENDA_ROW}>
                      <AgendaNextRow
                        dayText={i === 0 ? (day.date === today ? "Today" : shortDay(day.date, today)) : ""}
                        accent={FAMILY_ACCENT[KIND_FAMILY[item.kind]]}
                        time={item.startsAt ? startLabel(item.startsAt) : null}
                        title={scheduleTitle(item)}
                        quiet={item.kind === "google_event"}
                      />
                    </RowLink>
                  </li>
                )),
              )}
            </AgendaNext>
            {/* Nothing coming up says nothing: no row of its own (the week's dots and the Calendar say it). */}
          </>
        )}

        {view === "week" && (
          <div className="mt-2.5">
            <TimeGrid
              days={weekDays(anchor)}
              entries={entries}
              today={today}
              nowMs={nowMs}
              onOpen={openItem}
              onSlot={requestAt}
              canSlot={canAsk}
              slotVerb="Request a session"
              onDay={openDay}
              compact
              hourHeight={44}
              heightClass="h-[min(26rem,58svh)] md:h-[min(36rem,60svh)]"
              scrollKey={`week:${jump}`}
              label={periodLabel("week", anchor, today)}
            />
          </div>
        )}

        {view === "month" && (
          <HomeMonth anchor={anchor} today={today} onPick={openDay} names={(d) => namesByDay.get(d) ?? []} />
        )}

        {view === "list" && (
          <>
            <AgendaWeek today={today} anchor={anchor} onSelect={openDay} dots={(d) => dotsByDay.get(d) ?? []} />
            <HomeWeekList
              rows={listRows}
              today={today}
              nowMs={nowMs}
              loading={loading}
              emptyText={isCurrentPeriod("list", anchor, today) ? "Nothing booked this week." : "Nothing booked that week."}
              label={periodLabel("list", anchor, today)}
              wrap={(e, className, line) => (
                <RowLink item={itemById.get(e.key)!} links={links} className={className}>
                  {line}
                </RowLink>
              )}
            />
          </>
        )}

        {/* The action, in words: ask for (or book) a session. Seeing everything is the header's link. */}
        {links && (singleBook || (bookable.length > 1 && !pov.viewAsClientId) || canRequest) && (
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
              <button type="button" onClick={() => setRequesting({ date: view === "day" && anchor > today ? anchor : today })} className={AGENDA_ACTION}>
                <CalendarPlus className="h-4 w-4" /> Request a session
              </button>
            )}
          </AgendaFooter>
        )}

        {links && canRequest && (
          <RequestSessionSheet
            open={!!requesting}
            onOpenChange={(o) => {
              if (!o) setRequesting(null);
            }}
            isPov={previewing}
            initialDate={requesting?.date ?? today}
            initialTime={requesting?.time ?? null}
            clientId={clientId}
          />
        )}
        {links && clientId && (
          <ClientSessionSheet clientId={clientId} session={openSession} onClose={() => setOpenSession(null)} />
        )}
      </AgendaCard>
    </OpenSession.Provider>
  );
}

function TodayRow({ item, links, today, past }: { item: CalendarItem; links: boolean; today: string; past: boolean }) {
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
  // Start / Continue is today's (another day's workout opens to its preview); Done shows on any day.
  const trailing = action && (action.done || (links && item.date === today)) ? <ActionPill label={action.label} done={action.done} /> : null;
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
        chevron={!trailing && !!itemLink(item, links)}
      />
    </RowLink>
  );
}
