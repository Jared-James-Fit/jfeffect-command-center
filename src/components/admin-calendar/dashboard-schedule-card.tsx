import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SessionActionsSheet, type ActionSession } from "@/components/schedule/session-actions-sheet";
import { placeLabel, useGoogleCalendarStatus, type KindFamily } from "@/lib/calendar-sources";
import { callLabel } from "@/lib/calendar-labels";
import { listGoogleEventsRange } from "@/lib/google-cal.functions";
import { addDaysISO, compactTimeRange, compareInstants, deviceTodayISO } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import {
  AGENDA_ACTION, AGENDA_LINK, AGENDA_ROW, AgendaCard, AgendaEmpty, AgendaFooter, AgendaHeader, AgendaLoading, AgendaToday, AgendaWeek,
  AgendaNext, AgendaNextRow, AgendaRow, FAMILY_ACCENT, hasEnded, NowLine, nowLineIndex, shortDay, startLabel, useNow,
} from "@/components/schedule/agenda";
import { byDayThenTime, HomeMonth, HomeViewBar, HomeWeekList, STRUCK_STATUSES, type HomeEntry } from "@/components/schedule/home-calendar-views";
import { TimeGrid, type TimeGridEntry } from "@/components/calendar/time-grid";
import { monthChipOrder } from "@/lib/calendar-timeline";
import { listenChannel } from "@/lib/realtime-channel";
import { useCalendarPrefs, type HomeView } from "@/lib/calendar-prefs";
import { comingUpFrom, homeRange, isCurrentPeriod, listPeriod, periodLabel, shiftAnchor } from "@/lib/home-calendar";
import { weekDays } from "@/components/calendar/week-strip";

/** How many "Coming up" rows the Day view shows. */
const UPCOMING_ROWS = 4;

type Session = ActionSession & { client: { full_name: string | null } | null };

/** One thing on the schedule, whatever it came from. */
type Row = {
  key: string;
  date: string;
  /** Null = all day. */
  startsAt: string | null;
  endsAt: string | null;
  family: KindFamily;
  title: string;
  /** What it is and where, after the time range. */
  detail: string | null;
  /** How a call happens ("Google Meet"), when it's one: the List's day leaves the gym's address out. */
  call: string | null;
  status?: string;
  open:
    | { kind: "session"; s: Session }
    | { kind: "link"; to: string; params?: Record<string, string>; search?: Record<string, string> }
    | { kind: "external"; href?: string };
};

function localDateOf(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** A wall-clock date + "HH:MM" as an instant on this device. */
function wallToIso(date: string, time: string | null | undefined): string | null {
  if (!time) return null;
  const d = new Date(`${date}T${time.slice(0, 5)}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function placeOf(location: string | null | undefined, meetLink?: string | null): string | null {
  return placeLabel(location) ?? (meetLink ? "Google Meet" : null);
}
function joinDetail(...parts: Array<string | null | undefined | false>): string | null {
  const s = parts.filter(Boolean).join(" · ");
  return s || null;
}

function sessionRow(s: Session): Row {
  const startsAt = wallToIso(s.session_date, s.start_time);
  return {
    key: `s:${s.id}`,
    date: s.session_date,
    startsAt,
    endsAt: wallToIso(s.session_date, s.end_time),
    family: "people",
    title: s.client?.full_name ?? "Client",
    detail: joinDetail(s.title || s.session_type || "Session", placeOf(s.location)),
    call: callLabel(s.location),
    status: s.status,
    open: { kind: "session", s },
  };
}

/** All day first, then by time. */
function byTime(a: Row, b: Row) {
  return (a.startsAt ? 1 : 0) - (b.startsAt ? 1 : 0) || compareInstants(a.startsAt, b.startsAt) || a.title.localeCompare(b.title);
}

/** What a booking is, for the List's one line ("1:1 Training"): the detail's first part. */
function whatOf(r: Row): string | null {
  if (r.family === "google") return null;
  return r.detail ? r.detail.split(" · ")[0] : null;
}

/**
 * The coach's Home calendar card, in the same look as every other Home, read
 * the way Google Calendar reads: bookings are blocks on a timeline, so when
 * each one starts and ends and where the free time is shows at a glance.
 * Four views (the choice remembered on their account, with Coaching /
 * + Google, `useCalendarPrefs`):
 *   Day: the day's week (tap a day to show it), the day as a timeline opening
 *     near now, with a Now line, then the next few bookings after it.
 *   Week: the week as a timeline, a column per day (tap a day's name for it).
 *   Month: who's booked on each day (first names); tap a day for its timeline.
 *   List: the week's strip with a Week spot after Sunday. A day (today to
 *     start) lists its bookings one under another, a Now line through today,
 *     then the next few after it; Week lists the whole week's, one line each
 *     by day (time, who, what): compact, for a quick look at who's in when.
 *     Tapping a day goes back to that day. Day or Week is remembered.
 * Each view steps back and forward with Today to come back. A tap on empty
 * time books there; a tap on a session moves / marks done / cancels it. Then
 * "Book a session" and "Open calendar".
 */
export function DashboardScheduleCard() {
  const qc = useQueryClient();
  const channelId = useId();
  const today = deviceTodayISO();
  const [acting, setActing] = useState<Session | null>(null);
  const [booking, setBooking] = useState<{ date: string; time?: string } | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const navigate = useNavigate();
  const { prefs, setPrefs } = useCalendarPrefs();
  const savedView: HomeView = prefs.homeView ?? "day";
  // A day tapped in Week or Month opens on its own for this visit; the tabs are what's remembered.
  const [dayFocus, setDayFocus] = useState(false);
  const view: HomeView = dayFocus ? "day" : savedView;
  const withGoogle = prefs.includeGoogle ?? false;
  // List: one day at a time (the default), or the whole week.
  const listWeek = view === "list" && prefs.listScope === "week";
  // What the period label, ‹ › and Today follow: List by its day, or by its week.
  const period: HomeView = listPeriod(view, prefs.listScope);
  // Day, and List showing a day, list what's coming up after the day on screen.
  const showsComingUp = period === "day";
  // The day shown (Day), or a day in the week / month on screen.
  const [anchor, setAnchor] = useState<string>(today);
  // "Today" scrolls the timeline back to now even when the day didn't change.
  const [jump, setJump] = useState(0);
  const { data: gcal } = useGoogleCalendarStatus();
  const googleOn = withGoogle && !!gcal?.connected;
  const nowMs = useNow();

  // What the view needs: Day = this Monday (its strip) to a week past the day shown (Coming up).
  const range = useMemo(() => homeRange(view, anchor, today), [view, anchor, today]);
  // Coming up starts after the day the timeline shows, so it never repeats it.
  const aheadFrom = comingUpFrom(anchor, today);
  const windowStart = new Date(`${range.from}T00:00:00`).toISOString();
  const windowEnd = new Date(`${addDaysISO(range.to, 1)}T00:00:00`).toISOString();
  const lastDay = range.to;

  const chooseView = (v: HomeView) => {
    setDayFocus(false);
    setPrefs({ homeView: v });
    setAnchor(today);
  };
  const step = (dir: -1 | 1) => setAnchor((a) => shiftAnchor(period, a, dir));
  const backToToday = () => {
    setAnchor(today);
    setJump((j) => j + 1);
  };
  const openDay = (d: string) => {
    setAnchor(d);
    if (savedView !== "day") setDayFocus(true);
  };
  // List: a day in the strip shows that day; the Week spot the whole week.
  const showListDay = (d: string) => {
    setAnchor(d);
    if (listWeek) setPrefs({ listScope: "day" });
  };
  const showListWeek = () => setPrefs({ listScope: "week" });

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ["dash-schedule-sessions", range.from, range.to],
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pt_sessions")
        .select("id, client_id, title, session_type, session_date, start_time, end_time, timezone, location, status, uses_credit, google_event_id, client:clients(full_name)")
        .gte("session_date", range.from)
        .lte("session_date", range.to)
        .neq("status", "Rescheduled")
        .order("session_date")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const { data: appts = [] } = useQuery<any[]>({
    queryKey: ["dash-schedule-appts", range.from, range.to],
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("appointments")
        .select("id, title, appointment_type, starts_at, ends_at, location, meet_link, external_name, client:clients(full_name)")
        .eq("status", "Scheduled")
        .gte("starts_at", windowStart)
        .lt("starts_at", windowEnd);
      return (data ?? []) as any[];
    },
  });

  const { data: events = [] } = useQuery<any[]>({
    queryKey: ["dash-schedule-events", range.from, range.to],
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase.from("events") as any)
        .select("id, name, event_date, start_time, end_time, status")
        .in("status", ["Active", "Draft"])
        .gte("event_date", range.from)
        .lte("event_date", range.to);
      return (data ?? []) as any[];
    },
  });

  const { data: googleEvents = [] } = useQuery<any[]>({
    queryKey: ["dash-schedule-google", range.from, range.to],
    placeholderData: (prev) => prev,
    enabled: googleOn,
    staleTime: 5 * 60_000,
    queryFn: () => listGoogleEventsRange({ data: { timeMin: windowStart, timeMax: windowEnd } }) as Promise<any[]>,
  });

  // Nothing booked in the week ahead: still say when the next session is (Day view).
  const nothingAhead = showsComingUp && !isLoading && !sessions.some((s) => s.status === "Scheduled" && s.session_date >= aheadFrom);
  const { data: nextSession } = useQuery<Session | null>({
    queryKey: ["dash-schedule-next", lastDay],
    enabled: nothingAhead,
    queryFn: async () => {
      const { data } = await supabase
        .from("pt_sessions")
        .select("id, client_id, title, session_type, session_date, start_time, end_time, timezone, location, status, uses_credit, google_event_id, client:clients(full_name)")
        .eq("status", "Scheduled")
        .gt("session_date", lastDay)
        .order("session_date")
        .order("start_time")
        .limit(1)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });

  // Live: a session booked, moved or closed anywhere updates the dashboard.
  useEffect(() => {
    const ch = listenChannel(`dash-schedule-${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pt_sessions" }, () => {
        qc.invalidateQueries({ queryKey: ["dash-schedule-sessions"] });
        qc.invalidateQueries({ queryKey: ["dash-schedule-next"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, channelId]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = sessions.map(sessionRow);
    for (const a of appts) {
      const who = a.client?.full_name ?? a.external_name ?? null;
      const what = a.title || a.appointment_type || "Appointment";
      out.push({
        key: `a:${a.id}`,
        date: localDateOf(a.starts_at),
        startsAt: a.starts_at,
        endsAt: a.ends_at ?? null,
        family: "people",
        title: who ?? what,
        detail: joinDetail(who ? what : null, placeOf(a.location, a.meet_link)),
        call: callLabel(a.location) ?? (a.meet_link ? "Google Meet" : null),
        open: { kind: "link", to: "/admin/calendar", search: { tab: "upcoming" } },
      });
    }
    for (const e of events) {
      out.push({
        key: `e:${e.id}`,
        date: e.event_date,
        startsAt: wallToIso(e.event_date, e.start_time),
        endsAt: wallToIso(e.event_date, e.end_time),
        family: "coach",
        title: e.name,
        detail: "Event",
        call: null,
        open: { kind: "link", to: "/admin/events/$id", params: { id: e.id } },
      });
    }
    if (googleOn) {
      for (const g of googleEvents) {
        const allDay = !!g.allDay;
        out.push({
          key: `g:${g.id}`,
          date: allDay ? String(g.start).slice(0, 10) : localDateOf(g.start),
          startsAt: allDay ? null : g.start,
          endsAt: allDay ? null : g.end ?? null,
          family: "google",
          title: g.summary || "Busy",
          detail: joinDetail("Google", placeOf(g.location, g.hangoutLink)),
          call: callLabel(g.location) ?? (g.hangoutLink ? "Google Meet" : null),
          open: { kind: "external", href: g.htmlLink },
        });
      }
    }
    return out;
  }, [sessions, appts, events, googleEvents, googleOn]);

  // A dot per booking on each day of the week strip.
  const dotsByDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      if (r.status === "Cancelled") continue;
      m.set(r.date, [...(m.get(r.date) ?? []), r]);
    }
    const out = new Map<string, string[]>();
    for (const [d, list] of m) out.set(d, list.sort(byTime).map((r) => FAMILY_ACCENT[r.family]));
    return out;
  }, [rows]);

  // The timeline's blocks: who in bold, then what and where.
  const entries = useMemo<TimeGridEntry<Row>[]>(
    () =>
      rows.map((r) => ({
        key: r.key,
        date: r.date,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        title: r.title,
        short: r.family === "people" ? r.title.split(/\s+/)[0] : r.title,
        detail: r.detail,
        family: r.family,
        status: r.status ?? null,
        ref: r,
      })),
    [rows],
  );
  // Month and List read the shared Home pieces: who in bold, what after it.
  const homeEntries = useMemo<HomeEntry[]>(
    () =>
      rows.map((r) => ({
        key: r.key,
        date: r.date,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        family: r.family,
        title: r.title,
        short: r.family === "people" ? r.title.split(/\s+/)[0] : r.title,
        what: whatOf(r),
        status: r.status ?? null,
      })),
    [rows],
  );
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  // Month: who's booked each day, sessions first then in time order (cancelled ones left out).
  const namesByDay = useMemo(() => {
    const m = new Map<string, HomeEntry[]>();
    for (const r of homeEntries) {
      if (r.status === "Cancelled") continue;
      m.set(r.date, [...(m.get(r.date) ?? []), r]);
    }
    for (const list of m.values()) list.sort(monthChipOrder);
    return m;
  }, [homeEntries]);
  /** A block opens what it is: the session sheet, its page, or Google. */
  const openRow = (r: Row) => {
    const o = r.open;
    if (o.kind === "session") setActing(o.s);
    else if (o.kind === "link") void navigate({ to: o.to as any, params: o.params as any, search: o.search as any });
    else if (o.href) window.open(o.href, "_blank", "noopener,noreferrer");
  };
  const bookAt = (date: string, time?: string) => setBooking({ date, time });
  // Coming up: the next few live bookings after the day shown (the next session further out when there are none).
  const upcoming = useMemo(() => {
    const ahead = rows
      .filter((r) => r.date >= aheadFrom && !STRUCK_STATUSES.has(r.status ?? "") && !hasEnded(r.startsAt, r.endsAt, nowMs))
      .sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
      .slice(0, UPCOMING_ROWS);
    if (!ahead.some((r) => r.open.kind === "session") && nextSession && ahead.length < UPCOMING_ROWS) ahead.push(sessionRow(nextSession));
    return ahead;
  }, [rows, aheadFrom, nowMs, nextSession]);
  // List's week: its bookings by day, in time order (cancelled ones stay, crossed out).
  const listRows = useMemo(() => {
    if (!listWeek) return [];
    const days = weekDays(anchor);
    return homeEntries.filter((r) => r.date >= days[0] && r.date <= days[6]).sort(byDayThenTime);
  }, [homeEntries, listWeek, anchor]);
  // List's day: its bookings one under another (cancelled ones stay, crossed out), a Now line through today.
  const dayList = useMemo(() => (view === "list" && !listWeek ? rows.filter((r) => r.date === anchor).sort(byTime) : []), [rows, view, listWeek, anchor]);
  const nowIndex = useMemo(() => (anchor === today ? nowLineIndex(dayList, nowMs) : -1), [dayList, anchor, today, nowMs]);
  const dayLabel = anchor === today ? "Today" : periodLabel("day", anchor, today);
  // Coming up: the next few after the day on screen (Day, and List's day).
  const comingUp = (
    <AgendaNext show={upcoming.length > 0}>
      {upcoming.map((r, i) => (
        <li key={r.key} className="min-w-0">
          <RowOpen row={r} onSession={setActing} className={AGENDA_ROW}>
            <AgendaNextRow
              dayText={i === 0 || upcoming[i - 1].date !== r.date ? (r.date === today ? "Today" : shortDay(r.date, today)) : ""}
              accent={FAMILY_ACCENT[r.family]}
              time={r.startsAt ? startLabel(r.startsAt) : null}
              title={r.title}
              quiet={r.family === "google"}
            />
          </RowOpen>
        </li>
      ))}
    </AgendaNext>
  );

  const toggleGoogle = () => setPrefs({ includeGoogle: !withGoogle });

  const { data: bookingClients = [] } = useQuery({
    queryKey: ["clients-min"],
    enabled: !!booking || !!editing,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, timezone, default_session_location, package_tracking_enabled, sessions_purchased, sessions_used")
        .eq("archived", false)
        .order("full_name");
      return data ?? [];
    },
  });

  return (
    <AgendaCard>
      <AgendaHeader
        today={today}
        link={{ to: "/admin/calendar", search: { tab: "board" } }}
        right={
          gcal?.connected ? (
            <button type="button" onClick={toggleGoogle} aria-pressed={withGoogle} className="shrink-0 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
              {withGoogle ? "Hide Google" : "Show Google"}
            </button>
          ) : null
        }
      />
      <HomeViewBar
        view={view}
        onView={chooseView}
        label={periodLabel(period, anchor, today)}
        onStep={step}
        onToday={isCurrentPeriod(period, anchor, today) ? null : backToToday}
      />

      {view === "day" && (
        <>
          <AgendaWeek today={today} anchor={anchor} selected={anchor} onSelect={setAnchor} dots={(d) => dotsByDay.get(d) ?? []} />
          <div className="mt-1">
            <TimeGrid
              days={[anchor]}
              entries={entries}
              today={today}
              nowMs={nowMs}
              onOpen={openRow}
              onSlot={bookAt}
              compact
              hourHeight={44}
              heightClass="h-[min(24rem,52svh)] md:h-[min(34rem,58svh)]"
              scrollKey={`day:${jump}`}
              label={dayLabel}
            />
          </div>
          {comingUp}
        </>
      )}

      {view === "week" && (
        <div className="mt-2.5">
          <TimeGrid
            days={weekDays(anchor)}
            entries={entries}
            today={today}
            nowMs={nowMs}
            onOpen={openRow}
            onSlot={bookAt}
            onDay={openDay}
            compact
            hourHeight={44}
            heightClass="h-[min(28rem,60svh)] md:h-[min(38rem,62svh)]"
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
          <AgendaWeek
            today={today}
            anchor={anchor}
            selected={listWeek ? undefined : anchor}
            onSelect={showListDay}
            weekSelected={listWeek}
            onSelectWeek={showListWeek}
            dots={(d) => dotsByDay.get(d) ?? []}
          />
          {listWeek ? (
            <HomeWeekList
              rows={listRows}
              today={today}
              nowMs={nowMs}
              loading={isLoading && !sessions.length}
              emptyText={isCurrentPeriod("week", anchor, today) ? "Nothing booked this week." : "Nothing booked that week."}
              label={periodLabel("week", anchor, today)}
              wrap={(e, className, line) => (
                <RowOpen row={rowByKey.get(e.key)!} onSession={setActing} className={className}>
                  {line}
                </RowOpen>
              )}
            />
          ) : (
            <>
              <AgendaToday>
                {isLoading && !sessions.length ? (
                  <AgendaLoading />
                ) : dayList.length === 0 ? (
                  <AgendaEmpty>{anchor === today ? "Nothing booked today." : "Nothing booked."}</AgendaEmpty>
                ) : (
                  <ol aria-label={dayLabel} data-home-day-list>
                    {dayList.map((r, i) => (
                      <li key={r.key} className="min-w-0">
                        {i === nowIndex && <NowLine />}
                        <RowOpen row={r} onSession={setActing} className={cn(AGENDA_ROW, hasEnded(r.startsAt, r.endsAt, nowMs) && "opacity-55")}>
                          <AgendaRow
                            time={r.startsAt ? startLabel(r.startsAt) : "All day"}
                            timed={!!r.startsAt}
                            accent={FAMILY_ACCENT[r.family]}
                            title={r.title}
                            quiet={r.family === "google"}
                            struck={STRUCK_STATUSES.has(r.status ?? "")}
                            sub={joinDetail(
                              r.status === "Cancelled" ? "Cancelled" : r.status === "Missed" ? "No-show" : null,
                              r.startsAt ? compactTimeRange(r.startsAt, r.endsAt) : null,
                              r.family === "google" ? "Google" : whatOf(r),
                              r.call,
                            )}
                            chevron
                          />
                        </RowOpen>
                      </li>
                    ))}
                    {nowIndex === dayList.length && (
                      <li aria-hidden>
                        <NowLine />
                      </li>
                    )}
                  </ol>
                )}
              </AgendaToday>
              {comingUp}
            </>
          )}
        </>
      )}

      <AgendaFooter>
        <button type="button" onClick={() => bookAt(period === "day" && anchor >= today ? anchor : today)} className={AGENDA_ACTION}>
          <CalendarPlus className="h-4 w-4" /> Book a session
        </button>
        <Link to="/admin/calendar" search={{ tab: "board" } as any} className={AGENDA_LINK}>
          Open calendar
          <ChevronRight className="h-4 w-4" />
        </Link>
      </AgendaFooter>

      <SessionActionsSheet
        session={acting}
        clientName={acting?.client?.full_name}
        open={!!acting}
        onOpenChange={(o) => {
          if (!o) setActing(null);
        }}
        onEdit={async (s) => {
          const { data } = await supabase.from("pt_sessions").select("*").eq("id", s.id).maybeSingle();
          setEditing(data ?? s);
        }}
      />
      <PtSessionDialog
        open={!!booking || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setBooking(null);
            setEditing(null);
          }
        }}
        clients={bookingClients as any}
        initial={editing ?? undefined}
        clientId={editing?.client_id}
        initialDate={booking?.date ?? null}
        initialTime={booking?.time ?? null}
      />
    </AgendaCard>
  );
}

/** A row opens what it is: the session sheet, its page, or Google. */
function RowOpen({ row, onSession, className, children }: { row: Row; onSession: (s: Session) => void; className?: string; children: ReactNode }) {
  const o = row.open;
  if (o.kind === "session") {
    return (
      <button type="button" onClick={() => onSession(o.s)} className={className}>
        {children}
      </button>
    );
  }
  if (o.kind === "link") {
    return (
      <Link to={o.to as any} params={o.params as any} search={o.search as any} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={o.href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}
