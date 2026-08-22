import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { CalendarDays, ChevronRight } from "lucide-react";
import { KIND_META, useClientCalendarSources, type CalendarItem } from "@/lib/calendar-sources";
import { isAppointmentItem, selectHomeUpcoming } from "@/lib/home-upcoming";
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
 * Compact Today / Next-up strip for the client Home screen.
 *
 * Home is a summary: at most a few rows covering today's remaining events,
 * or the next scheduled day when today is clear. The full Day / Week / Month
 * calendar stays behind "View calendar".
 */
export function UpcomingScheduleCard({ clientId }: { clientId: string | null | undefined }) {
  const { items } = useClientCalendarSources(clientId);
  const today = isoToday();

  const summary = useMemo(() => selectHomeUpcoming(items ?? [], { today }), [items, today]);

  return (
    <Card className="space-y-2.5 border-border bg-card p-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{summary.mode === "today" ? "Today" : "Next up"}</span>
        </h3>
        <Link
          to="/portal/calendar"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-primary"
        >
          View calendar <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {summary.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing scheduled right now.</p>
      ) : (
        <ul className="space-y-1.5">
          {summary.rows.map((item) => {
            const meta = KIND_META[item.kind];
            const time = timeLabel(item);
            const appointment = isAppointmentItem(item);
            const when = summary.mode === "today" ? time : [dayLabel(item.date, today), time].filter(Boolean).join(" · ");
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
                  <div className="truncate text-[11px] text-muted-foreground">{meta?.label}</div>
                </div>
                {item.href ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
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
      )}

      {summary.moreCount > 0 ? (
        <Link
          to="/portal/calendar"
          className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
        >
          +{summary.moreCount} more
        </Link>
      ) : null}
    </Card>
  );
}
