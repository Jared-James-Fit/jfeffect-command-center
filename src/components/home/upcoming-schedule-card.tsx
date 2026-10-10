import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { CalendarDays, ChevronRight, Plus } from "lucide-react";
import { listMyBookingTypes } from "@/lib/booking.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { KIND_META, useClientCalendarSources, type CalendarItem } from "@/lib/calendar-sources";
import { isAppointmentItem, selectHomeUpcoming } from "@/lib/home-upcoming";
import { WeekStrip, nextSevenDays } from "@/components/calendar/week-strip";
import { compactTimeRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";

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
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeLabel(item: CalendarItem): string | null {
  if (!item.startsAt) return null;
  return compactTimeRange(item.startsAt, item.endsAt);
}

/** Cardio rides on training days; counting it would double every dot. */
function countsOnStrip(item: CalendarItem): boolean {
  return item.kind !== "cardio" && item.status !== "Cancelled";
}

const MAX_DAY_ROWS = 4;

/**
 * Client Home schedule: a 7-day strip on top of a short list.
 *
 * Today keeps the summary behaviour (today's remaining items, or the next day
 * with something on it when today is clear). Tapping another day shows that
 * day. The full Day / Week / Month calendar stays behind "View calendar".
 */
export function UpcomingScheduleCard({ clientId, links = true }: {
  clientId: string | null | undefined;
  /** False on a staff home (the person's own client account): no Book, no portal links. */
  links?: boolean;
}) {
  const { items } = useClientCalendarSources(clientId);
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
  const [selected, setSelected] = useState(today);
  const days = useMemo(() => nextSevenDays(today), [today]);

  const summary = useMemo(() => selectHomeUpcoming(items ?? [], { today }), [items, today]);
  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items ?? []) if (countsOnStrip(it)) m.set(it.date, (m.get(it.date) ?? 0) + 1);
    return m;
  }, [items]);

  const isToday = selected === today;
  const dayItems = useMemo(
    () =>
      (items ?? [])
        .filter((i) => i.date === selected && i.status !== "Cancelled")
        .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? "")),
    [items, selected],
  );
  const rows = isToday ? summary.rows : dayItems.slice(0, MAX_DAY_ROWS);
  const moreCount = isToday ? summary.moreCount : Math.max(0, dayItems.length - MAX_DAY_ROWS);
  const mode = isToday ? summary.mode : "day";
  const heading = mode === "next" ? "Next up" : isToday ? "Today" : dayLabel(selected, today);

  return (
    <Card className="space-y-2.5 border-border bg-card p-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{heading}</span>
        </h3>
        {links && <div className="flex shrink-0 items-center gap-3">
          {bookable.length > 0 && !pov.viewAsClientId && (
            bookable.length === 1 ? (
              <Link
                to="/book/$slug"
                params={{ slug: bookable[0].slug }}
                search={{ name: "", email: "", phone: "", application_id: "", i: "" }}
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-primary"
              >
                <Plus className="h-3.5 w-3.5" /> Book
              </Link>
            ) : (
              <Link to="/portal/calendar" className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-primary">
                <Plus className="h-3.5 w-3.5" /> Book
              </Link>
            )
          )}
          <Link
            to="/portal/calendar"
            className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-primary"
          >
            View calendar <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>}
      </div>

      <WeekStrip
        days={days}
        today={today}
        selected={selected}
        onSelect={setSelected}
        count={(d) => countByDay.get(d) ?? 0}
        dotClass="bg-cyan-400"
      />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isToday ? "Nothing scheduled right now." : `Nothing on ${dayLabel(selected, today)}.`}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((item) => {
            const meta = KIND_META[item.kind];
            const time = timeLabel(item);
            const appointment = isAppointmentItem(item);
            const when = mode === "next" ? [dayLabel(item.date, today), time].filter(Boolean).join(" · ") : time;
            // Sessions open the Schedule, where "Need to change it?" lives.
            const href = !links ? null : item.href ?? (item.kind === "pt_session" ? { to: "/portal/calendar" } : null);
            const row = (
              <div
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-3 py-2",
                  appointment ? "border-primary/40 bg-primary/10" : "border-border bg-secondary/20",
                )}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", meta?.dot ?? "bg-primary")} />
                <div className="min-w-0">
                  <div className={cn("truncate text-sm", appointment ? "font-black" : "font-semibold")}>
                    {when ? <span className="tabular-nums">{when} · </span> : null}
                    {item.title}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {meta?.label}
                    {item.status === "Completed" ? " · Done" : ""}
                  </div>
                </div>
                {href ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
              </div>
            );
            return (
              <li key={item.id} className="min-w-0">
                {href ? (
                  <Link
                    to={href.to as any}
                    params={(href as any).params as any}
                    search={(href as any).search as any}
                    className="block"
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}

      {moreCount > 0 ? (
        links ? (
          <Link
            to="/portal/calendar"
            className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
          >
            +{moreCount} more
          </Link>
        ) : (
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">+{moreCount} more</p>
        )
      ) : null}
    </Card>
  );
}
