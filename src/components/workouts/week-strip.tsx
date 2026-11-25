// The 7-day workout strip (Mon-first, the week's dates, a status mark per day, week arrows).
// Shared by the client's Workouts screen and the coach's workout peek in the
// messenger, so both read a client's week the same way. On Workouts it's the
// default way the week reads (the horizontal calendar), with `WeekNav` above it
// holding the arrows, the week's done count and the calendar / list toggle.
import { addDays, format, isSameDay, isSameMonth, startOfWeek } from "date-fns";
import { CalendarRange, ChevronLeft, ChevronRight, List } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { localStartOfToday, toLocalISO } from "@/lib/today";
import { stepWeek, type WeekLayout } from "@/lib/workouts/week-layout";
import type { WorkoutItem } from "@/lib/workout-today";
import { getWorkoutStatus, type WorkoutStatus } from "@/lib/workout-status";
import { CalendarDayCell, type CalendarDnd } from "@/components/workouts/calendar-day-dnd";
import { WorkoutStatusMark, dayMark } from "@/components/workouts/workout-status-mark";

/** A session or appointment with the coach that day: the calendar's own ink, like everywhere else sessions show (calendar-palette.ts). */
export function SessionDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-foreground", className)} />;
}

/** "Nov 2 – 8", or "Oct 26 – Nov 1" across a month: the strip is a calendar, so it says dates. */
export function weekRangeLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  return `${format(weekStart, "MMM d")} – ${format(end, isSameMonth(weekStart, end) ? "d" : "MMM d")}`;
}

const NAV_ARROW =
  "grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-[0.96]";

/**
 * The week's navigation on Workouts, shared by both layouts so it never moves
 * when they switch: ‹ the dates and "2 of 4 done" › on the left, Today (once
 * you've moved off it) and the calendar / list toggle on the right.
 */
export function WeekNav({
  selectedDate,
  onSelectDate,
  progress,
  layout,
  onLayout,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  /** this week's program workouts and how many are done (optional ones never count) */
  progress?: { done: number; planned: number } | null;
  layout?: WeekLayout;
  onLayout?: (l: WeekLayout) => void;
}) {
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const today = localStartOfToday();
  const step = (dir: 1 | -1) => onSelectDate(stepWeek(selectedDate, dir, today));
  return (
    <div className="-mx-2 flex items-center" data-week-nav>
      <button type="button" onClick={() => step(-1)} aria-label="Previous week" className={NAV_ARROW}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="min-w-0 px-0.5 text-center leading-tight" aria-live="polite">
        <div className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-foreground">{weekRangeLabel(weekStart)}</div>
        {progress && progress.planned > 0 && (
          <div className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground" data-week-progress>
            {progress.done} of {progress.planned} done
          </div>
        )}
      </div>
      <button type="button" onClick={() => step(1)} aria-label="Next week" className={NAV_ARROW}>
        <ChevronRight className="h-4 w-4" />
      </button>
      <div className="ml-auto flex items-center gap-1 pr-2">
        {!isSameDay(selectedDate, today) && (
          <button
            type="button"
            onClick={() => onSelectDate(today)}
            className="inline-flex h-9 items-center rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            data-week-today
          >
            Today
          </button>
        )}
        {layout && onLayout && <WeekLayoutToggle value={layout} onChange={onLayout} />}
      </div>
    </div>
  );
}

const LAYOUTS: { value: WeekLayout; label: string; Icon: typeof List }[] = [
  { value: "calendar", label: "Calendar view", Icon: CalendarRange },
  { value: "list", label: "List view", Icon: List },
];

/** Calendar or list: a compact two-way switch, the one in use filled in neutral (never the brand red). */
export function WeekLayoutToggle({ value, onChange }: { value: WeekLayout; onChange: (l: WeekLayout) => void }) {
  return (
    <div role="group" aria-label="Week layout" className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-border p-0.5" data-week-layout-toggle>
      {LAYOUTS.map(({ value: v, label, Icon }) => {
        const on = v === value;
        return (
          <button
            key={v}
            type="button"
            aria-label={label}
            aria-pressed={on}
            title={label}
            onClick={() => {
              if (on) return;
              feedback("tap");
              onChange(v);
            }}
            className={cn(
              "grid h-[30px] w-8 place-items-center rounded-md transition-colors",
              on ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-week-layout={v}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export function WeekStrip({
  selectedDate, onSelectDate, byDate, dnd, sessionDays, flat = false, nav = true,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  byDate: Map<string, WorkoutItem[]>;
  dnd?: CalendarDnd;
  /** yyyy-mm-dd days with a session or appointment (client view): a dot by the workout mark. */
  sessionDays?: Set<string>;
  /** On the page itself, no card around it (Workouts: the calendar picks the day, the day's card is the thing). */
  flat?: boolean;
  /** Its own arrows and dates (the coach's peek); Workouts draws `WeekNav` above it instead. */
  nav?: boolean;
}) {
  // Week the selected date belongs to. Mon-first to match existing schedule UI.
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = localStartOfToday();
  // Dates only: where this week sits in the program (block, week) is the Program card's.
  const Wrap = flat ? "div" : Card;
  return (
    <Wrap className={flat ? "-mx-2" : "px-2 pb-2 pt-1.5"} data-week-strip={flat ? "flat" : "card"}>
      {nav && (
      <div className="mb-0.5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onSelectDate(stepWeek(selectedDate, -1, today))}
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
          onClick={() => onSelectDate(stepWeek(selectedDate, 1, today))}
          aria-label="Next week"
          className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      )}
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
          // A rest day reads quieter (its number muted, no mark), so the training days stand out.
          const rest = list.length === 0;
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
              data-day={iso}
              data-rest={rest || undefined}
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
                  rest && !isSelected && "font-medium text-muted-foreground",
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
    </Wrap>
  );
}
