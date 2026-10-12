import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { CalendarDays, Check, ChevronRight, Dumbbell, Flag, Plus, UserRound } from "lucide-react";
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

type IconType = typeof Dumbbell;
const FAMILY_ICON: Record<KindFamily, IconType> = {
  training: Dumbbell,
  people: UserRound,
  coach: Flag,
  google: CalendarDays,
};
const FAMILY_TINT: Record<KindFamily, string> = {
  training: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  people: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  coach: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  google: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
};

/** "Block 1 — Volume 5s/7s · Week 2 of 5" for a workout row (same blocks as the Workouts page). */
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
 * Client Home: the day at a glance.
 *
 * Today in full (today's workout leads, with its block and week and a Start /
 * Continue / Done action; then sessions, appointments, coach events and
 * Google events by time), then the next few days in brief. No week strip and
 * no dots: browsing weeks and months is the Workouts calendar's job, and the
 * Schedule page shows everything at once. Each row carries a small icon in
 * its colour family (training, sessions, coach, Google), the same families as
 * every calendar.
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
  const dateLine = new Date(`${today}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  return (
    <Card className="space-y-3 border-border bg-card p-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">Today</h3>
          <div className="truncate text-sm font-bold">{dateLine}</div>
        </div>
        {links && <div className="flex shrink-0 items-center gap-1">
          {/* one "+" for Book and Request */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Book or request a session" className="grid h-9 w-9 place-items-center rounded-full text-primary active:bg-muted">
                <Plus className="h-4 w-4" />
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
            className="inline-flex min-h-9 shrink-0 items-center gap-0.5 text-[11px] font-bold uppercase tracking-widest text-primary"
          >
            Schedule <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>}
      </div>

      {/* Today */}
      {isLoading && !items?.length ? (
        <div className="h-14 animate-pulse rounded-xl bg-secondary/40" />
      ) : agenda.today.length === 0 ? (
        <p className="rounded-xl bg-secondary/30 px-3 py-3 text-sm text-muted-foreground">Nothing scheduled today. Recover well.</p>
      ) : (
        <ul className="space-y-1.5">
          {agenda.today.map((item) => (
            <li key={item.id} className="min-w-0">
              <TodayRow item={item} links={links} />
            </li>
          ))}
        </ul>
      )}

      {/* Coming up */}
      {agenda.upcoming.length > 0 && (
        <div className="space-y-2 border-t border-border/60 pt-2.5">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Coming up</div>
          {agenda.upcoming.map((day) => (
            <div key={day.date} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
              <div className="pt-1 text-[11px] font-bold text-muted-foreground">{dayLabel(day.date, today)}</div>
              <ul className="min-w-0 space-y-1">
                {day.items.map((item) => (
                  <li key={item.id} className="min-w-0">
                    <UpcomingRow item={item} links={links} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {agenda.moreUpcoming > 0 &&
            (links ? (
              <Link to="/portal/calendar" className="block pl-[5rem] text-[11px] font-bold text-muted-foreground">
                +{agenda.moreUpcoming} more this week
              </Link>
            ) : (
              <p className="pl-[5rem] text-[11px] font-bold text-muted-foreground">+{agenda.moreUpcoming} more this week</p>
            ))}
        </div>
      )}

      {links && (
        <RequestSessionSheet open={requesting} onOpenChange={setRequesting} isPov={!!pov.viewAsClientId} initialDate={today} />
      )}
    </Card>
  );
}

function FamilyIcon({ item, size = "md" }: { item: CalendarItem; size?: "md" | "sm" }) {
  const family = KIND_FAMILY[item.kind];
  const Icon = FAMILY_ICON[family];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg",
        FAMILY_TINT[family],
        size === "md" ? "h-9 w-9" : "h-6 w-6 rounded-md",
      )}
      aria-hidden
    >
      <Icon className={size === "md" ? "h-4 w-4" : "h-3 w-3"} />
    </span>
  );
}

function TodayRow({ item, links }: { item: CalendarItem; links: boolean }) {
  const time = timeLabel(item);
  const google = item.kind === "google_event";
  const isWorkout = item.kind === "workout" && !!item.raw;
  const action = isWorkout ? workoutAction(item.raw) : null;
  const sub = isWorkout
    ? workoutContext(item.raw)
    : [KIND_META[item.kind]?.label, placeLabel(item.location)].filter(Boolean).join(" · ");
  return (
    <RowLink
      item={item}
      links={links}
      className={cn(
        "rounded-xl border px-2.5 py-2 transition active:bg-secondary/40",
        isWorkout ? "border-cyan-500/30 bg-cyan-500/5" : "border-border bg-secondary/20",
        google && "border-transparent bg-transparent",
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
        <FamilyIcon item={item} />
        <div className="min-w-0">
          <div className={cn("truncate text-sm", google ? "font-medium text-foreground/80" : "font-bold")}>
            {time && <span className="tabular-nums text-muted-foreground">{time} · </span>}
            {agendaTitle(item)}
          </div>
          {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
        </div>
        {action ? (
          action.done ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-500">
              <Check className="h-3.5 w-3.5" strokeWidth={3} /> Done
            </span>
          ) : links ? (
            <span className="rounded-full bg-primary px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-primary-foreground">
              {action.label}
            </span>
          ) : null
        ) : itemLink(item, links) ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : null}
      </div>
    </RowLink>
  );
}

function UpcomingRow({ item, links }: { item: CalendarItem; links: boolean }) {
  const time = timeLabel(item);
  const google = item.kind === "google_event";
  const done = item.kind === "workout" && item.status === "Completed";
  return (
    <RowLink item={item} links={links} className="rounded-lg px-1 py-0.5 transition active:bg-secondary/40">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <FamilyIcon item={item} size="sm" />
        <div className={cn("truncate text-[13px]", google ? "text-foreground/70" : "font-semibold")}>
          {time && <span className="tabular-nums text-muted-foreground">{time} · </span>}
          {agendaTitle(item)}
          {done && <span className="text-emerald-500"> · Done</span>}
        </div>
      </div>
    </RowLink>
  );
}
