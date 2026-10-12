import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SessionActionsSheet, type ActionSession } from "@/components/schedule/session-actions-sheet";
import { placeLabel, useGoogleCalendarStatus, type KindFamily } from "@/lib/calendar-sources";
import { listGoogleEventsRange } from "@/lib/google-cal.functions";
import { addDaysISO, compactTimeRange, deviceTodayISO } from "@/lib/schedule-time";
import {
  AGENDA_ACTION, AGENDA_LINK, AGENDA_ROW, AgendaCard, AgendaEmpty, AgendaFooter, AgendaHeader, AgendaLoading,
  AgendaNext, AgendaNextRow, AgendaRow, FAMILY_ACCENT, hasEnded, NowLine, nowLineIndex, shortDay, startLabel, useNow,
} from "@/components/schedule/agenda";
import { cn } from "@/lib/utils";
import { listenChannel } from "@/lib/realtime-channel";

// Same switch as the Calendar page, so "Coaching | + Google" is one choice everywhere.
const GOOGLE_PREF_KEY = "admin.calendar.includeGoogle";
/** Days ahead the card looks, and how many of those rows it shows. */
const AHEAD_DAYS = 7;
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
function readGooglePref() {
  try {
    return window.localStorage.getItem(GOOGLE_PREF_KEY) === "1";
  } catch {
    return false;
  }
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
  return (a.startsAt ? 1 : 0) - (b.startsAt ? 1 : 0) || (a.startsAt ?? "").localeCompare(b.startsAt ?? "") || a.title.localeCompare(b.title);
}

/**
 * The coach's Home schedule, in the same look as every other Home: today on a
 * time column with a Now line, then the next few bookings, then "Book a
 * session" and "Full calendar". Tap a session to move / mark done / cancel
 * it. Sits at the top of "Today" because it's the one thing on the dashboard
 * that's tied to the clock.
 */
export function DashboardScheduleCard() {
  const qc = useQueryClient();
  const channelId = useId();
  const today = deviceTodayISO();
  const [acting, setActing] = useState<Session | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [withGoogle, setWithGoogle] = useState<boolean>(() => (typeof window === "undefined" ? false : readGooglePref()));
  const { data: gcal } = useGoogleCalendarStatus();
  const googleOn = withGoogle && !!gcal?.connected;
  const nowMs = useNow();

  // Today and the week ahead.
  const lastDay = addDaysISO(today, AHEAD_DAYS);
  const windowStart = new Date(`${today}T00:00:00`).toISOString();
  const windowEnd = new Date(`${addDaysISO(lastDay, 1)}T00:00:00`).toISOString();

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ["dash-schedule-sessions", today],
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pt_sessions")
        .select("id, client_id, title, session_type, session_date, start_time, end_time, timezone, location, status, uses_credit, google_event_id, client:clients(full_name)")
        .gte("session_date", today)
        .lte("session_date", lastDay)
        .neq("status", "Rescheduled")
        .order("session_date")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const { data: appts = [] } = useQuery<any[]>({
    queryKey: ["dash-schedule-appts", today],
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
    queryKey: ["dash-schedule-events", today],
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase.from("events") as any)
        .select("id, name, event_date, start_time, end_time, status")
        .in("status", ["Active", "Draft"])
        .gte("event_date", today)
        .lte("event_date", lastDay);
      return (data ?? []) as any[];
    },
  });

  const { data: googleEvents = [] } = useQuery<any[]>({
    queryKey: ["dash-schedule-google", today],
    placeholderData: (prev) => prev,
    enabled: googleOn,
    staleTime: 5 * 60_000,
    queryFn: () => listGoogleEventsRange({ data: { timeMin: windowStart, timeMax: windowEnd } }) as Promise<any[]>,
  });

  // Nothing booked this week: still say when the next session is.
  const nothingAhead = !isLoading && !sessions.some((s) => s.status === "Scheduled" && s.session_date > today);
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

  const todayRows = useMemo(() => rows.filter((r) => r.date === today).sort(byTime), [rows, today]);
  const nowIndex = useMemo(() => nowLineIndex(todayRows, nowMs), [todayRows, nowMs]);
  // Coming up: the next few live bookings after today (the next one further out when the week is empty).
  const upcoming = useMemo(() => {
    const ahead = rows
      .filter((r) => r.date > today && r.status !== "Cancelled" && r.status !== "Missed")
      .sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
      .slice(0, UPCOMING_ROWS);
    if (!ahead.some((r) => r.open.kind === "session") && nextSession && ahead.length < UPCOMING_ROWS) ahead.push(sessionRow(nextSession));
    return ahead;
  }, [rows, today, nextSession]);

  const toggleGoogle = () => {
    const next = !withGoogle;
    setWithGoogle(next);
    try {
      window.localStorage.setItem(GOOGLE_PREF_KEY, next ? "1" : "0");
    } catch {
      /* keeps working for this visit */
    }
  };

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
        right={
          gcal?.connected ? (
            <button type="button" onClick={toggleGoogle} aria-pressed={withGoogle} className="shrink-0 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
              {withGoogle ? "Hide Google" : "Show Google"}
            </button>
          ) : null
        }
      />

      <div className="mt-1.5">
        {isLoading && !sessions.length ? (
          <AgendaLoading />
        ) : todayRows.length === 0 ? (
          <AgendaEmpty>Nothing booked today.</AgendaEmpty>
        ) : (
          <ol aria-label="Today">
            {todayRows.map((r, i) => (
              <li key={r.key} className="min-w-0">
                {i === nowIndex && <NowLine />}
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
            {nowIndex === todayRows.length && (
              <li aria-hidden>
                <NowLine />
              </li>
            )}
          </ol>
        )}
      </div>

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

      <AgendaFooter>
        <button type="button" onClick={() => setBooking(today)} className={AGENDA_ACTION}>
          <CalendarPlus className="h-4 w-4" /> Book a session
        </button>
        <Link to="/admin/calendar" className={AGENDA_LINK}>
          Full calendar
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
