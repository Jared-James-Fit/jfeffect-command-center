import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SessionActionsSheet, type ActionSession } from "@/components/schedule/session-actions-sheet";
import { placeLabel, useGoogleCalendarStatus, type KindFamily } from "@/lib/calendar-sources";
import { listGoogleEventsRange } from "@/lib/google-cal.functions";
import { addDaysISO, compactTimeRange, compareInstants, deviceTodayISO } from "@/lib/schedule-time";
import {
  AGENDA_ACTION, AGENDA_LINK, AGENDA_ROW, AgendaCard, AgendaEmpty, AgendaFooter, AgendaHeader, AgendaLoading, AgendaToday, AgendaWeek,
  AgendaNext, AgendaNextRow, AgendaRow, FAMILY_ACCENT, hasEnded, NowLine, nowLineIndex, shortDay, startLabel, useNow,
} from "@/components/schedule/agenda";
import { cn } from "@/lib/utils";
import { listenChannel } from "@/lib/realtime-channel";
import { useCalendarPrefs, type HomeView } from "@/lib/calendar-prefs";
import { dayTag, homeRange, isCurrentPeriod, monthGridDays, monthStart, periodLabel, shiftAnchor } from "@/lib/home-calendar";

/** How many "Coming up" rows the Day view shows. */
const UPCOMING_ROWS = 4;
const VIEWS: Array<{ id: HomeView; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

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

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  Completed: { label: "Done", cls: "bg-emerald-500/15 text-emerald-500" },
  Missed: { label: "No-show", cls: "bg-destructive/15 text-destructive" },
  Cancelled: { label: "Cancelled", cls: "bg-secondary text-muted-foreground" },
};

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
    status: s.status,
    open: { kind: "session", s },
  };
}

/** All day first, then by time. */
function byTime(a: Row, b: Row) {
  return (a.startsAt ? 1 : 0) - (b.startsAt ? 1 : 0) || compareInstants(a.startsAt, b.startsAt) || a.title.localeCompare(b.title);
}

/**
 * The coach's Home calendar card, in the same look as every other Home, with
 * three views (the choice remembered on their account, with Coaching /
 * + Google, `useCalendarPrefs`):
 *   Day: this week's days (each opens the Calendar there), today on a time
 *     column with a Now line, then the next few bookings.
 *   Week: the week's strip, then every booking that week, a line each:
 *     day, time and who ("10 AM Nicolas Galli · 1:1 Training").
 *   Month: the month's days with a dot per booking; tap a day for its list.
 * Week and Month step back and forward. Then "Book a session" and "Open
 * calendar". Tap a session to move / mark done / cancel it.
 */
export function DashboardScheduleCard() {
  const qc = useQueryClient();
  const channelId = useId();
  const today = deviceTodayISO();
  const [acting, setActing] = useState<Session | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const { prefs, setPrefs } = useCalendarPrefs();
  const view: HomeView = prefs.homeView ?? "day";
  const withGoogle = prefs.includeGoogle ?? false;
  // A day in the week / month on screen, and the month view's tapped day.
  const [anchor, setAnchor] = useState<string>(today);
  const [picked, setPicked] = useState<string>(today);
  const { data: gcal } = useGoogleCalendarStatus();
  const googleOn = withGoogle && !!gcal?.connected;
  const nowMs = useNow();

  // What the view needs: Day = this Monday (its strip) to a week ahead (Coming up).
  const range = useMemo(() => homeRange(view, anchor, today), [view, anchor, today]);
  const windowStart = new Date(`${range.from}T00:00:00`).toISOString();
  const windowEnd = new Date(`${addDaysISO(range.to, 1)}T00:00:00`).toISOString();
  const lastDay = range.to;

  const chooseView = (v: HomeView) => {
    setPrefs({ homeView: v });
    setAnchor(today);
    setPicked(today);
  };
  const step = (dir: -1 | 1) => {
    const next = shiftAnchor(view, anchor, dir);
    setAnchor(next);
    if (view === "month") setPicked(next.slice(0, 7) === today.slice(0, 7) ? today : monthStart(next));
  };
  const backToToday = () => {
    setAnchor(today);
    setPicked(today);
  };

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

  // Nothing booked this week: still say when the next session is (Day view).
  const nothingAhead = view === "day" && !isLoading && !sessions.some((s) => s.status === "Scheduled" && s.session_date > today);
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

  const todayRows = useMemo(() => rows.filter((r) => r.date === today).sort(byTime), [rows, today]);
  const nowIndex = useMemo(() => nowLineIndex(todayRows, nowMs), [todayRows, nowMs]);
  const pickedRows = useMemo(() => rows.filter((r) => r.date === picked).sort(byTime), [rows, picked]);
  // Week view: the week's bookings in order (Cancelled stays, crossed out).
  const weekRows = useMemo(
    () => (view === "week" ? rows.filter((r) => r.date >= range.from && r.date <= range.to).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b)) : []),
    [rows, view, range.from, range.to],
  );
  // Coming up: the next few live bookings after today (the next one further out when the week is empty).
  const upcoming = useMemo(() => {
    const ahead = rows
      .filter((r) => r.date > today && r.status !== "Cancelled" && r.status !== "Missed")
      .sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
      .slice(0, UPCOMING_ROWS);
    if (!ahead.some((r) => r.open.kind === "session") && nextSession && ahead.length < UPCOMING_ROWS) ahead.push(sessionRow(nextSession));
    return ahead;
  }, [rows, today, nextSession]);

  const toggleGoogle = () => setPrefs({ includeGoogle: !withGoogle });

  /** A day's bookings on the time column (Day: today with the Now line; Month: the tapped day). */
  const dayList = (list: Row[], withNow: boolean, empty: string) =>
    isLoading && !sessions.length ? (
      <AgendaLoading />
    ) : list.length === 0 ? (
      <AgendaEmpty>{empty}</AgendaEmpty>
    ) : (
      <ol aria-label={withNow ? "Today" : dayTag(picked, today)}>
        {list.map((r, i) => (
          <li key={r.key} className="min-w-0">
            {withNow && i === nowIndex && <NowLine />}
            <RowOpen row={r} onSession={setActing} className={cn(AGENDA_ROW, hasEnded(r.startsAt, r.endsAt, nowMs) && "opacity-55")}>
              <AgendaRow
                time={r.startsAt ? startLabel(r.startsAt) : "All day"}
                timed={!!r.startsAt}
                accent={FAMILY_ACCENT[r.family]}
                title={r.title}
                quiet={r.family === "google"}
                struck={r.status === "Cancelled"}
                sub={joinDetail(r.startsAt ? compactTimeRange(r.startsAt, r.endsAt) : null, r.detail)}
                trailing={
                  r.status && STATUS_CHIP[r.status] ? (
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_CHIP[r.status].cls)}>{STATUS_CHIP[r.status].label}</span>
                  ) : null
                }
                chevron
              />
            </RowOpen>
          </li>
        ))}
        {withNow && nowIndex === list.length && (
          <li aria-hidden>
            <NowLine />
          </li>
        )}
      </ol>
    );

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
      <ViewBar
        view={view}
        onView={chooseView}
        label={view === "day" ? null : periodLabel(view, anchor, today)}
        onStep={step}
        onToday={isCurrentPeriod(view, anchor, today) ? null : backToToday}
      />

      {view === "day" && (
        <>
          <AgendaWeek
            today={today}
            dots={(d) => dotsByDay.get(d) ?? []}
            link={(d) => ({ to: "/admin/calendar", search: { tab: "board", date: d } })}
          />
          <AgendaToday>{dayList(todayRows, true, "Nothing booked today.")}</AgendaToday>
          <AgendaNext show={upcoming.length > 0}>
            {upcoming.map((r, i) => (
              <li key={r.key} className="min-w-0">
                <RowOpen row={r} onSession={setActing} className={AGENDA_ROW}>
                  <AgendaNextRow
                    dayText={i === 0 || upcoming[i - 1].date !== r.date ? shortDay(r.date, today) : ""}
                    accent={FAMILY_ACCENT[r.family]}
                    time={r.startsAt ? startLabel(r.startsAt) : null}
                    title={r.title}
                    quiet={r.family === "google"}
                  />
                </RowOpen>
              </li>
            ))}
          </AgendaNext>
        </>
      )}

      {view === "week" && (
        <>
          <AgendaWeek
            today={today}
            anchor={anchor}
            dots={(d) => dotsByDay.get(d) ?? []}
            link={(d) => ({ to: "/admin/calendar", search: { tab: "board", date: d } })}
          />
          <AgendaToday>
            {isLoading && !sessions.length ? (
              <AgendaLoading />
            ) : weekRows.length === 0 ? (
              <AgendaEmpty>Nothing booked this week.</AgendaEmpty>
            ) : (
              <ol aria-label="This week">
                {weekRows.map((r, i) => {
                  const firstOfDay = i === 0 || weekRows[i - 1].date !== r.date;
                  return (
                    <li key={r.key} className={cn("min-w-0", firstOfDay && i > 0 && "mt-1 border-t border-border/40 pt-1")}>
                      <RowOpen row={r} onSession={setActing} className={cn(AGENDA_ROW, hasEnded(r.startsAt, r.endsAt, nowMs) && "opacity-55")}>
                        <AgendaNextRow
                          dayText={firstOfDay ? dayTag(r.date, today) : ""}
                          accent={FAMILY_ACCENT[r.family]}
                          time={r.startsAt ? startLabel(r.startsAt) : "All day"}
                          title={<span className={cn(r.status === "Cancelled" && "text-muted-foreground line-through")}>{r.title}</span>}
                          quiet={r.family === "google"}
                          suffix={whatOf(r) ? <span className="font-normal text-muted-foreground"> · {whatOf(r)}</span> : null}
                        />
                      </RowOpen>
                    </li>
                  );
                })}
              </ol>
            )}
          </AgendaToday>
        </>
      )}

      {view === "month" && (
        <>
          <MiniMonth anchor={anchor} today={today} picked={picked} onPick={setPicked} dots={(d) => dotsByDay.get(d) ?? []} />
          <AgendaToday>
            <p className="px-0.5 pb-0.5 text-[11px] font-semibold text-muted-foreground">
              {picked === today ? "Today" : new Date(`${picked}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </p>
            {dayList(pickedRows, picked === today, "Nothing booked.")}
          </AgendaToday>
        </>
      )}

      <AgendaFooter>
        <button type="button" onClick={() => setBooking(view === "month" && picked >= today ? picked : today)} className={AGENDA_ACTION}>
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
        initialDate={booking}
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

/** What a booking is, for the Week view's one line ("1:1 Training"): the detail's first part. */
function whatOf(r: Row): string | null {
  if (r.family === "google") return null;
  return r.detail ? r.detail.split(" · ")[0] : null;
}

/**
 * Day · Week · Month (neutral, like every in-card switch: red is the card's
 * one action), and for Week / Month the period with ‹ › and Today.
 */
function ViewBar({
  view, onView, label, onStep, onToday,
}: {
  view: HomeView;
  onView: (v: HomeView) => void;
  label: string | null;
  onStep: (dir: -1 | 1) => void;
  onToday: (() => void) | null;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="inline-flex h-8 shrink-0 rounded-full border border-border bg-background/60 p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Calendar view">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            onClick={() => onView(v.id)}
            className={cn("rounded-full px-3", view === v.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {v.label}
          </button>
        ))}
      </div>
      {label && (
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          {onToday && (
            <button type="button" onClick={onToday} className="mr-1 shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
              Today
            </button>
          )}
          <button type="button" onClick={() => onStep(-1)} aria-label="Previous" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-0 truncate text-center text-xs font-semibold tabular-nums">{label}</span>
          <button type="button" onClick={() => onStep(1)} aria-label="Next" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/** The month as whole weeks: the date, today filled, the tapped day ringed, a dot per booking (up to 3). */
function MiniMonth({
  anchor, today, picked, onPick, dots,
}: {
  anchor: string;
  today: string;
  picked: string;
  onPick: (d: string) => void;
  dots: (d: string) => string[];
}) {
  const days = monthGridDays(anchor);
  const month = anchor.slice(0, 7);
  return (
    <div className="mt-2.5" role="group" aria-label="Month">
      <div className="grid grid-cols-7 pb-0.5 text-center text-[11px] font-medium text-muted-foreground" aria-hidden>
        {days.slice(0, 7).map((d) => (
          <span key={d}>{new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const isToday = d === today;
          const isPicked = d === picked;
          const marks = dots(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-pressed={isPicked}
              aria-label={`${new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${isToday ? " (today)" : ""}${marks.length ? `, ${marks.length} booked` : ""}`}
              className={cn("flex min-h-[44px] flex-col items-center justify-start gap-0.5 rounded-lg pt-0.5 transition active:bg-secondary/50", !inMonth && "opacity-40")}
            >
              <span
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold tabular-nums",
                  isToday ? "bg-foreground text-background" : isPicked ? "ring-1 ring-foreground/60" : d < today ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {Number(d.slice(8))}
              </span>
              <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                {marks.slice(0, 3).map((cls, i) => (
                  <span key={i} className={cn("h-1.5 w-1.5 rounded-full", cls, d < today && "opacity-50")} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
