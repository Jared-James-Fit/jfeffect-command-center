// The 7-day workout strip (Mon-first, the week's dates, a status mark per day, week arrows).
// Shared by the client's Workouts screen and the coach's workout peek in the
// messenger, so both read a client's week the same way.
import { addDays, addWeeks, format, isSameDay, isSameMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { localStartOfToday, toLocalISO } from "@/lib/today";
import type { WorkoutItem } from "@/lib/workout-today";
import { getWorkoutStatus, type WorkoutStatus } from "@/lib/workout-status";
import { CalendarDayCell, type CalendarDnd } from "@/components/workouts/calendar-day-dnd";
import { WorkoutStatusMark, dayMark } from "@/components/workouts/workout-status-mark";

/** A session or appointment with the coach that day: violet, like everywhere else sessions show. */
export function SessionDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-violet-500", className)} />;
}

/** "Nov 2 – 8", or "Oct 26 – Nov 1" across a month: the strip is a calendar, so it says dates. */
export function weekRangeLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  return `${format(weekStart, "MMM d")} – ${format(end, isSameMonth(weekStart, end) ? "d" : "MMM d")}`;
}

export function WeekStrip({
  selectedDate, onSelectDate, byDate, dnd, sessionDays,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  byDate: Map<string, WorkoutItem[]>;
  dnd?: CalendarDnd;
  /** yyyy-mm-dd days with a session or appointment (client view): a violet dot by the workout mark. */
  sessionDays?: Set<string>;
}) {
  // Week the selected date belongs to. Mon-first to match existing schedule UI.
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = localStartOfToday();
  // Dates only: where this week sits in the program (block, week) is the Program card's.
  return (
    <Card className="px-2 pb-2 pt-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onSelectDate(addWeeks(selectedDate, -1))}
          aria-label="Previous week"
          className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1">
          <span className="text-[13px] font-semibold tabular-nums text-foreground">{weekRangeLabel(weekStart)}</span>
          {/* only once you've moved off today */}
          {!isSameDay(selectedDate, today) && (
            <button
              type="button"
              onClick={() => onSelectDate(today)}
              className="-my-2 inline-flex h-10 items-center rounded-lg px-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Today
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onSelectDate(addWeeks(selectedDate, 1))}
          aria-label="Next week"
          className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const iso = toLocalISO(d);
          const list = byDate.get(iso) ?? [];
          const item = list[0];
          const extra = Math.max(0, list.length - 1);
          const status: WorkoutStatus | "none" = item
            ? getWorkoutStatus(item).status
            : "none";
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, selectedDate);
          const hasSession = !!sessionDays?.has(iso);
          return (
            <CalendarDayCell key={iso} iso={iso} item={item} label={format(d, "MMM d")}>
              {(cellDnd) => (
            <button
              type="button"
              ref={cellDnd.setNodeRef as any}
              onClick={() => onSelectDate(d)}
              {...cellDnd.props}
              className={cn(
                cellDnd.className,
                "flex min-h-[64px] flex-col items-center gap-1 rounded-xl px-0.5 py-1.5 text-center transition",
                "hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${format(d, "EEEE MMMM d")}${isToday ? " (today)" : ""}${item ? `, ${getWorkoutStatus(item).label}${extra ? ` (+${extra} more)` : ""}` : ", rest day"}${hasSession ? ", session with your coach" : ""}`}
            >
              <span className={cn("text-[11px] font-medium", isSelected || isToday ? "text-foreground" : "text-muted-foreground")}>
                {format(d, "EEE")}
              </span>
              {/* the day picked is a plain filled circle, today a thin ring: no brand red (that's Start's) */}
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full text-[15px] font-semibold tabular-nums",
                  isSelected ? "bg-foreground text-background" : isToday ? "ring-1 ring-inset ring-foreground/40" : "",
                )}
              >
                {format(d, "d")}
              </span>
              <span className="flex h-2.5 items-center gap-1">
                <WorkoutStatusMark mark={dayMark(list)} />
                {hasSession && <SessionDot />}
              </span>
              {extra > 0 && <span className="text-[9px] font-semibold leading-none text-muted-foreground">+{extra}</span>}
            </button>
              )}
            </CalendarDayCell>
          );

        })}
      </div>
    </Card>
  );
}
