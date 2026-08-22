import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, ChevronRight } from "lucide-react";
import { KIND_META, ctaLabel, useClientCalendarSources, type CalendarItem } from "@/lib/calendar-sources";
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
  return new Date(item.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Compact Today / Upcoming schedule for the client Home screen.
 *
 * Reads the same calendar sources as the full calendar so nothing can drift,
 * shows only the next few days, and links out to the full calendar for
 * day / week / month views.
 */
export function UpcomingScheduleCard({
  clientId,
  daysAhead = 7,
  maxItems = 5,
}: {
  clientId: string | null | undefined;
  daysAhead?: number;
  maxItems?: number;
}) {
  const { items } = useClientCalendarSources(clientId);
  const today = isoToday();

  const horizon = useMemo(() => {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() + daysAhead);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [today, daysAhead]);

  const upcoming = useMemo(
    () =>
      (items ?? [])
        .filter((i) => i.date >= today && i.date <= horizon && i.status !== "Cancelled")
        .sort((a, b) => (a.date + (a.startsAt ?? "")).localeCompare(b.date + (b.startsAt ?? "")))
        .slice(0, maxItems),
    [items, today, horizon, maxItems],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const i of upcoming) {
      const list = map.get(i.date) ?? [];
      list.push(i);
      map.set(i.date, list);
    }
    return [...map.entries()];
  }, [upcoming]);

  return (
    <Card className="space-y-3 border-border bg-card p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">Today &amp; Upcoming</span>
        </h3>
        <Link
          to="/portal/calendar"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-primary"
        >
          Full calendar <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing scheduled in the next {daysAhead} days.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, dayItems]) => (
            <div key={date} className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {dayLabel(date, today)}
              </div>
              <ul className="space-y-1.5">
                {dayItems.map((item) => {
                  const meta = KIND_META[item.kind];
                  const time = timeLabel(item);
                  const row = (
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", meta?.dot ?? "bg-primary")} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{item.title}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {[time, item.subtitle].filter(Boolean).join(" · ") || meta?.label}
                        </div>
                      </div>
                      {item.href ? (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-primary">
                          {ctaLabel(item)}
                        </span>
                      ) : (
                        <Badge variant="outline" className="shrink-0 text-[10px]">{meta?.label}</Badge>
                      )}
                    </div>
                  );
                  return (
                    <li key={item.id} className="min-w-0">
                      {item.href ? (
                        <Link
                          to={item.href.to as any}
                          params={item.href.params as any}
                          search={item.href.search as any}
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
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
