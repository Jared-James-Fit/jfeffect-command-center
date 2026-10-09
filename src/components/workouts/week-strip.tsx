// The 7-day workout strip (Mon-first, status dot per day, week arrows).
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

export function statusDotClass(status: WorkoutStatus | "none"): string {
  switch (status) {
    case "completed_today":
    case "completed_on_scheduled":
    case "completed_different_day":
      return "bg-emerald-500";
    case "today": return "bg-primary";
    case "in_progress":
    case "review_pending":
    case "incomplete":
      return "bg-amber-500";
    case "missed": return "bg-rose-500";
    case "upcoming": return "bg-muted-foreground/60";
    case "available":
    case "not_started":
      return "bg-muted-foreground/40";
    default: return "bg-transparent";
  }
}

export function WeekStrip({
  selectedDate, onSelectDate, byDate, dnd,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  byDate: Map<string, WorkoutItem[]>;
  dnd?: CalendarDnd;
}) {
  // Week the selected date belongs to. Mon-first to match existing schedule UI.
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = localStartOfToday();
  return (
    <Card className="p-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => onSelectDate(addWeeks(selectedDate, -1))}
          aria-label="Previous week"
          className="rounded p-1 hover:bg-secondary"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-xs font-semibold text-muted-foreground">
          {format(weekStart, isSameMonth(weekStart, days[6]) ? "MMMM yyyy" : "MMM d")}
          {!isSameMonth(weekStart, days[6]) && ` – ${format(days[6], "MMM d")}`}
        </div>
        <button
          type="button"
          onClick={() => onSelectDate(addWeeks(selectedDate, 1))}
          aria-label="Next week"
          className="rounded p-1 hover:bg-secondary"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
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
                "flex flex-col items-center justify-between rounded-lg px-1 py-2 text-center transition",
                "min-h-[64px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : isToday
                    ? "border border-primary/60 bg-primary/10"
                    : "hover:bg-secondary",
              )}
              aria-pressed={isSelected}
              aria-label={`${format(d, "EEEE MMMM d")}${item ? `, ${getWorkoutStatus(item).label}${extra ? ` (+${extra} more)` : ""}` : ", rest day"}`}
            >
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-wider",
                isSelected ? "text-primary-foreground/80" : "text-muted-foreground",
              )}>
                {format(d, "EEE")}
              </span>
              <span className={cn(
                "text-base font-black",
                isSelected ? "" : isToday ? "text-primary" : "",
              )}>
                {format(d, "d")}
              </span>
              <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", statusDotClass(status))} />
              {extra > 0 && (
                <span className={cn(
                  "text-[9px] font-bold leading-none",
                  isSelected ? "text-primary-foreground/80" : "text-muted-foreground",
                )}>+{extra}</span>
              )}
            </button>
              )}
            </CalendarDayCell>
          );

        })}
      </div>
    </Card>
  );
}
