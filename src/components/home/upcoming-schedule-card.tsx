import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Check, ChevronRight, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { listMyBookingTypes } from "@/lib/booking.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { KIND_FAMILY, KIND_META, placeLabel, useClientCalendarSources, type CalendarItem, type KindFamily } from "@/lib/calendar-sources";
import { buildHomeAgenda } from "@/lib/home-upcoming";
import { getWorkoutStatus } from "@/lib/workout-status";
import { compactTimeRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import { RequestSessionSheet } from "@/components/schedule/request-session-sheet";

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(date: string, today: string): string {
  const diff = Math.round(
    (new Date(date + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000,
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeLabel(item: CalendarItem): string | null {
  if (!item.startsAt) return null;
  return compactTimeRange(item.startsAt, item.endsAt);
}

/** A hairline in the item's colour family: the only colour on a row. */
const FAMILY_ACCENT: Record<KindFamily, string> = {
  training: "bg-cyan-500",
  people: "bg-violet-500",
  coach: "bg-amber-500",
  google: "bg-slate-400/70",
};

/** "7 AM", "12:30 PM": the time column (start only; the range is in the subline). */
function startLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}

/** Ended (timed items only): earlier today, shown quieter so the day reads as moving forward. */
function hasEnded(item: CalendarItem, nowMs: number): boolean {
  if (!item.startsAt) return false;
  const end = Date.parse(item.endsAt ?? "") || Date.parse(item.startsAt) + 60 * 60 * 1000;
  return end < nowMs;
}

/** "Week 2 of 5 · Block 1 — Volume 5s/7s" for a workout row (same blocks as the Workouts page). */
function workoutContext(raw: any): string | null {
  const block = (raw?.block?.name ?? "").trim();
  const wk = raw?.week?.week_index;
  const of = raw?.block?.weeks;
  const week = wk ? `Week ${wk}${of ? ` of ${of}` : ""}` : null;
  return [week, block || null].filter(Boolean).join(" · ") || null;
}

/** "Monday — Primary Squat" → "Primary Squat": the agenda already says which day it is. */
function agendaTitle(item: CalendarItem): string {
  if (item.kind !== "workout") return item.title;
  const t = item.title.replace(/^(mon|tues|wednes|thurs|fri|satur|sun)day\s*[—–-]\s*/i, "").trim();
  return t || item.title;
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
 * Client Home: today as a short agenda, then what's next.
 *
 * A time column on the left and one line of colour per item (training,
 * sessions, coach events, Google), nothing else competing: no week strip, no
 * icon tiles, no tinted cards. Today reads top to bottom (all-day items, then
 * by time, with earlier items quieter and a "Now" line), so it's obvious
 * what's done and what's next. Today's workout says its week and block and
 * offers Start / Continue / Done; titles wrap rather than cut off. "Coming up"
 * shows the next 7 days under small date markers. Weeks, months and blocks
 * stay on the Workouts calendar; everything at once is on the Schedule page.
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
  const agenda = useMemo(() => buildHomeAgenda(items, { today }), [items, today]);
  const nowMs = useNow();
  const todayDate = new Date(`${today}T00:00:00`);
  const weekday = todayDate.toLocaleDateString(undefined, { weekday: "long" });
  const dayMonth = todayDate.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  // Where "Now" falls: before the first timed item that hasn't ended, when something comes before it.
  const nowIndex = useMemo(() => {
    const i = agenda.today.findIndex((it) => !!it.startsAt && !hasEnded(it, nowMs));
    if (i > 0) return i;
    if (i === -1 && agenda.today.some((it) => it.startsAt)) return agenda.today.length;
    return -1;
  }, [agenda.today, nowMs]);

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Today</h3>
          <div className="mt-0.5 truncate text-lg font-black leading-tight">
            {weekday} <span className="font-semibold text-muted-foreground">{dayMonth}</span>
          </div>
        </div>
        {links && <div className="-mr-1.5 flex shrink-0 items-center">
          {/* one "+" for Book and Request */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Book or request a session" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:text-foreground active:bg-muted">
                <Plus className="h-[18px] w-[18px]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {bookable.length > 0 && !pov.viewAsClientId && (
                <DropdownMenuItem asChild className="min-h-11">
                  {bookable.length === 1 ? (
                    <Link
                      to="/book/$slug"
                      params={{ slug: bookable[0].slug }}
                      search={{ name: "", email: "", phone: "", application_id: "", i: "" }}
                    >
                      Book a session
                    </Link>
                  ) : (
                    <Link to="/portal/calendar">Book a session</Link>
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="min-h-11" onSelect={() => setRequesting(true)}>
                Request a time
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link
            to="/portal/calendar"
            aria-label="Open your full schedule"
            className="inline-flex min-h-9 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
          >
            Schedule <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>}
      </div>

      {/* Today */}
      <div className="mt-3">
        {isLoading && !items?.length ? (
          <div className="space-y-2" aria-hidden>
            <div className="h-10 animate-pulse rounded-lg bg-secondary/40" />
            <div className="h-10 animate-pulse rounded-lg bg-secondary/30" />
          </div>
        ) : agenda.today.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">Nothing scheduled today. A good day to recover.</p>
        ) : (
          <ol className="space-y-0.5" aria-label="Today">
            {agenda.today.map((item, i) => (
              <li key={item.id} className="min-w-0">
                {i === nowIndex && <NowLine />}
                <TodayRow item={item} links={links} past={hasEnded(item, nowMs)} />
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

      {/* Coming up */}
      {agenda.upcoming.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Coming up</div>
          <ol className="space-y-2" aria-label="Coming up">
            {agenda.upcoming.map((day) => (
              <li key={day.date} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2">
                <DateMarker date={day.date} today={today} />
                <ul className="min-w-0 space-y-0.5">
                  {day.items.map((item) => (
                    <li key={item.id} className="min-w-0">
                      <UpcomingRow item={item} links={links} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {agenda.moreUpcoming > 0 &&
            (links ? (
              <Link to="/portal/calendar" className="mt-1.5 block pl-[3.75rem] text-xs font-semibold text-muted-foreground hover:text-foreground">
                +{agenda.moreUpcoming} more this week
              </Link>
            ) : (
              <p className="mt-1.5 pl-[3.75rem] text-xs font-semibold text-muted-foreground">+{agenda.moreUpcoming} more this week</p>
            ))}
        </div>
      )}

      {links && (
        <RequestSessionSheet open={requesting} onOpenChange={setRequesting} isPov={!!pov.viewAsClientId} initialDate={today} />
      )}
    </Card>
  );
}

/** Minute-accurate "now", so earlier items fade and the Now line moves through the day. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function NowLine() {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-2 py-0.5" aria-label="Now">
      <span className="text-right text-[10px] font-black uppercase tracking-wider text-primary">Now</span>
      <span className="flex items-center">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="h-px flex-1 bg-primary/50" />
      </span>
    </div>
  );
}

/** "TUE / 13" (or "Tomorrow" above the number): where the coming days start. */
function DateMarker({ date, today }: { date: string; today: string }) {
  const d = new Date(`${date}T00:00:00`);
  const tomorrow = dayLabel(date, today) === "Tomorrow";
  return (
    <div className="pt-1 text-right leading-none">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {tomorrow ? "Tmrw" : d.toLocaleDateString(undefined, { weekday: "short" })}
      </div>
      <div className="mt-0.5 text-base font-black tabular-nums">{d.getDate()}</div>
    </div>
  );
}

function Accent({ item, className }: { item: CalendarItem; className?: string }) {
  return <span aria-hidden className={cn("w-[3px] shrink-0 self-stretch rounded-full", FAMILY_ACCENT[KIND_FAMILY[item.kind]], className)} />;
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
  const trailing = action ? (
    action.done ? (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-500">
        <Check className="h-3.5 w-3.5" strokeWidth={3} /> Done
      </span>
    ) : links ? (
      <span className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full border border-primary/40 pl-2.5 pr-1.5 text-xs font-bold text-primary">
        {action.label} <ChevronRight className="h-3.5 w-3.5" />
      </span>
    ) : null
  ) : null;
  return (
    <RowLink
      item={item}
      links={links}
      className={cn("rounded-lg py-1.5 transition active:bg-secondary/40", past && "opacity-55")}
    >
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-stretch gap-x-2">
        <div className={cn("pt-0.5 text-right text-xs font-semibold tabular-nums", item.startsAt ? "text-foreground/80" : "text-muted-foreground")}>
          {item.startsAt ? startLabel(item.startsAt) : item.kind === "workout" ? "Anytime" : "All day"}
        </div>
        <div className="flex min-w-0 gap-2.5">
          <Accent item={item} />
          <div className="min-w-0 flex-1 py-px">
            <div className="flex items-start gap-2">
              <div className={cn("min-w-0 flex-1 line-clamp-2 text-[15px] leading-snug", google ? "font-medium text-foreground/75" : "font-bold")}>
                {agendaTitle(item)}
              </div>
              {!action && itemLink(item, links) && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />}
            </div>
            {(sub || trailing) && (
              <div className="mt-1 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{sub}</div>
                {trailing}
              </div>
            )}
          </div>
        </div>
      </div>
    </RowLink>
  );
}

function UpcomingRow({ item, links }: { item: CalendarItem; links: boolean }) {
  const google = item.kind === "google_event";
  const done = item.kind === "workout" && item.status === "Completed";
  return (
    <RowLink item={item} links={links} className="rounded-md py-1 transition active:bg-secondary/40">
      <div className="flex min-w-0 gap-2.5">
        <Accent item={item} />
        <div className={cn("min-w-0 line-clamp-2 text-sm leading-snug", google ? "text-foreground/70" : "font-semibold")}>
          {item.startsAt && <span className="font-normal tabular-nums text-muted-foreground">{startLabel(item.startsAt)} </span>}
          {agendaTitle(item)}
          {done && <span className="font-normal text-emerald-500"> · Done</span>}
        </div>
      </div>
    </RowLink>
  );
}
