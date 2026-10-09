import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, MapPin, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SessionActionsSheet, type ActionSession } from "@/components/schedule/session-actions-sheet";
import { useGoogleCalendarStatus } from "@/lib/calendar-sources";
import { listGoogleEventsRange } from "@/lib/google-cal.functions";
import { addDaysISO, deviceTodayISO, fmtWallClock } from "@/lib/schedule-time";
import { WeekStrip, nextSevenDays } from "@/components/calendar/week-strip";
import { cn } from "@/lib/utils";

// Same switch as the Calendar page, so "Coaching | + Google" is one choice everywhere.
const GOOGLE_PREF_KEY = "admin.calendar.includeGoogle";

type Session = ActionSession & { client: { full_name: string | null } | null };

type Row =
  | { kind: "session"; key: string; sort: string; s: Session }
  | { kind: "appointment"; key: string; sort: string; title: string; who: string | null; time: string }
  | { kind: "event"; key: string; sort: string; title: string; time: string | null; id: string }
  | { kind: "google"; key: string; sort: string; title: string; time: string | null; link?: string };

function localDateOf(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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

/**
 * The dashboard's schedule: the next 7 days as a strip, the picked day as a
 * time-ordered list. Tap a session to move / mark done / cancel it, tap Book
 * to add one on that day. Sits near the top of "Today" because it's the one
 * thing on the dashboard that's tied to the clock.
 */
export function DashboardScheduleCard() {
  const qc = useQueryClient();
  const channelId = useId();
  const today = deviceTodayISO();
  const [day, setDay] = useState(today);
  const [acting, setActing] = useState<Session | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [withGoogle, setWithGoogle] = useState<boolean>(() => (typeof window === "undefined" ? false : readGooglePref()));
  const { data: gcal } = useGoogleCalendarStatus();
  const googleOn = withGoogle && !!gcal?.connected;

  const days = useMemo(() => nextSevenDays(today), [today]);
  const lastDay = days[days.length - 1];
  const windowStart = new Date(`${today}T00:00:00`).toISOString();
  const windowEnd = new Date(`${addDaysISO(lastDay, 1)}T00:00:00`).toISOString();

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ["dash-schedule-sessions", today],
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
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("appointments")
        .select("id, title, appointment_type, starts_at, external_name, client:clients(full_name)")
        .eq("status", "Scheduled")
        .gte("starts_at", windowStart)
        .lt("starts_at", windowEnd);
      return (data ?? []) as any[];
    },
  });

  const { data: events = [] } = useQuery<any[]>({
    queryKey: ["dash-schedule-events", today],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase.from("events") as any)
        .select("id, name, event_date, start_time, status")
        .in("status", ["Active", "Draft"])
        .gte("event_date", today)
        .lte("event_date", lastDay);
      return (data ?? []) as any[];
    },
  });

  const { data: googleEvents = [] } = useQuery<any[]>({
    queryKey: ["dash-schedule-google", today],
    enabled: googleOn,
    staleTime: 5 * 60_000,
    queryFn: () => listGoogleEventsRange({ data: { timeMin: windowStart, timeMax: windowEnd } }) as Promise<any[]>,
  });

  // When nothing's booked this week, still say when the next session is.
  const { data: nextSession } = useQuery<Session | null>({
    queryKey: ["dash-schedule-next", lastDay],
    enabled: !isLoading && !sessions.some((s) => s.status === "Scheduled"),
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
    const ch = supabase
      .channel(`dash-schedule-${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pt_sessions" }, () => {
        qc.invalidateQueries({ queryKey: ["dash-schedule-sessions"] });
        qc.invalidateQueries({ queryKey: ["dash-schedule-next"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, channelId]);

  const rowsByDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    const push = (d: string, r: Row) => {
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(r);
    };
    for (const s of sessions) push(s.session_date, { kind: "session", key: `s:${s.id}`, sort: s.start_time, s });
    for (const a of appts) {
      push(localDateOf(a.starts_at), {
        kind: "appointment",
        key: `a:${a.id}`,
        sort: new Date(a.starts_at).toTimeString().slice(0, 5),
        title: a.title || a.appointment_type || "Appointment",
        who: a.client?.full_name ?? a.external_name ?? null,
        time: clock(a.starts_at),
      });
    }
    for (const e of events) {
      push(e.event_date, {
        kind: "event",
        key: `e:${e.id}`,
        sort: e.start_time ?? "00:00",
        title: e.name,
        time: e.start_time ? fmtWallClock(e.start_time) : null,
        id: e.id,
      });
    }
    if (googleOn) {
      for (const g of googleEvents) {
        const allDay = !!g.allDay;
        const date = allDay ? String(g.start).slice(0, 10) : localDateOf(g.start);
        push(date, {
          kind: "google",
          key: `g:${g.id}`,
          sort: allDay ? "00:00" : new Date(g.start).toTimeString().slice(0, 5),
          title: g.summary || "Busy",
          time: allDay ? null : clock(g.start),
          link: g.htmlLink,
        });
      }
    }
    for (const list of m.values()) list.sort((a, b) => a.sort.localeCompare(b.sort));
    return m;
  }, [sessions, appts, events, googleEvents, googleOn]);

  const rows = rowsByDay.get(day) ?? [];
  // A dot per thing on that day's list: coaching items first, then Google (when shown).
  const coachingCount = (d: string) =>
    (rowsByDay.get(d) ?? []).filter((r) => (r.kind === "session" ? r.s.status === "Scheduled" : r.kind !== "google")).length;
  const googleCount = (d: string) => (rowsByDay.get(d) ?? []).filter((r) => r.kind === "google").length;
  const dayName = day === today ? "today" : new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });

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
    <Card className="border-border bg-card p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-bold tracking-tight">
          <CalendarDays className="h-4 w-4 text-muted-foreground" /> Schedule
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          <Button size="sm" className="h-7 bg-gradient-primary px-2.5 text-[11px] font-bold" onClick={() => setBooking(day)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Book
          </Button>
          <Link to="/admin/calendar" className="text-[11px] font-semibold text-primary hover:underline">
            Calendar →
          </Link>
        </div>
      </div>

      {/* 7-day strip: violet dots for coaching, sky for Google, today highlighted */}
      <WeekStrip
        days={days}
        today={today}
        selected={day}
        onSelect={setDay}
        count={coachingCount}
        extraCount={googleOn ? googleCount : undefined}
        extraDotClass="bg-sky-400/80"
      />

      <div className="mt-3">
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-secondary/40" />
        ) : rows.length === 0 ? (
          <div className="rounded-lg bg-secondary/30 px-3 py-3 text-sm text-muted-foreground">
            Nothing booked {dayName}.
            {nextSession && day === today && !sessions.some((s) => s.status === "Scheduled") && (
              <button type="button" className="mt-1 block text-left text-xs text-foreground/90" onClick={() => setActing(nextSession)}>
                Next: <span className="font-semibold">{nextSession.client?.full_name ?? "Client"}</span> ·{" "}
                {new Date(`${nextSession.session_date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at {fmtWallClock(nextSession.start_time)}
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.key}>
                {r.kind === "session" ? (
                  <button type="button" onClick={() => setActing(r.s)} className="flex w-full items-center gap-3 py-2.5 text-left">
                    <div className="w-[62px] shrink-0 text-right">
                      <div className="text-xs font-bold tabular-nums">{fmtWallClock(r.s.start_time)}</div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">{fmtWallClock(r.s.end_time)}</div>
                    </div>
                    <span className="h-8 w-1 shrink-0 rounded-full bg-violet-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className={cn("truncate text-sm font-bold", r.s.status === "Cancelled" && "text-muted-foreground line-through")}>
                        {r.s.client?.full_name ?? "Client"}
                      </div>
                      <div className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <span className="truncate">{r.s.title || r.s.session_type || "Session"}</span>
                        {r.s.location && (
                          <>
                            <MapPin className="ml-1 h-3 w-3 shrink-0" />
                            <span className="truncate">{r.s.location.split(",")[0]}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {STATUS_CHIP[r.s.status] && (
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_CHIP[r.s.status].cls)}>
                        {STATUS_CHIP[r.s.status].label}
                      </span>
                    )}
                  </button>
                ) : r.kind === "appointment" ? (
                  <Link to="/admin/calendar" search={{ tab: "upcoming" } as any} className="flex items-center gap-3 py-2.5">
                    <div className="w-[62px] shrink-0 text-right text-xs font-bold tabular-nums">{r.time}</div>
                    <span className="h-8 w-1 shrink-0 rounded-full bg-blue-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{r.who ?? r.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{r.title}</div>
                    </div>
                  </Link>
                ) : r.kind === "event" ? (
                  <Link to="/admin/events/$id" params={{ id: r.id }} className="flex items-center gap-3 py-2.5">
                    <div className="w-[62px] shrink-0 text-right text-xs font-bold tabular-nums">{r.time ?? "All day"}</div>
                    <span className="h-8 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                    <div className="min-w-0 flex-1 truncate text-sm font-bold">{r.title}</div>
                  </Link>
                ) : (
                  <a href={r.link} target="_blank" rel="noreferrer" className="flex items-center gap-3 py-2 opacity-80">
                    <div className="w-[62px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{r.time ?? "All day"}</div>
                    <span className="h-6 w-1 shrink-0 rounded-full bg-sky-400/70" aria-hidden />
                    <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.title}</div>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {gcal?.connected && (
        <button type="button" onClick={toggleGoogle} className="mt-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
          {withGoogle ? "Hide Google events" : "Show Google events too"}
        </button>
      )}

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
    </Card>
  );
}
