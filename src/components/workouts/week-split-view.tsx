/**
 * The week as a split (Nov 25 2026, week-split.ts): Monday to Sunday, one row
 * a day, "✓ Deadlift & Squat · Completed · 1h 42m", "Rest Day", "Squat & Bench
 * · Suggested 12:30 PM · Est. 1h 35m". The Workouts page's default view
 * (remembered on the phone); a row picks its day, whose card shows under it.
 *
 * Suggested times are dashed and say "Suggested": the picked day's row offers
 * Confirm (writes `pl_scheduled_workouts.scheduled_time`, never the date, the
 * prescription or the order), Change and Dismiss; a confirmed time is plain.
 */
import { useState } from "react";
import { addWeeks, format, isSameDay } from "date-fns";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { localStartOfToday } from "@/lib/today";
import { weekRangeLabel } from "@/components/workouts/week-strip";
import type { SplitEntry, SplitWeek } from "@/lib/workouts/week-split";
import { clockLabel, parseTimeValue, timeValue } from "@/lib/workouts/workout-time-suggest";
import type { WorkoutItem } from "@/lib/workout-today";

export type WeekView = "split" | "day";
export const WEEK_VIEW_KEY = "jf.workouts.week-view";

export function readWeekView(): WeekView {
  try {
    return localStorage.getItem(WEEK_VIEW_KEY) === "day" ? "day" : "split";
  } catch {
    return "split";
  }
}
export function saveWeekView(v: WeekView) {
  try {
    localStorage.setItem(WEEK_VIEW_KEY, v);
  } catch {
    /* private mode: this visit only */
  }
}

export function WeekSplitView({
  week,
  weekStart,
  selectedDate,
  onSelectDate,
  onStart,
  timeActions,
}: {
  week: SplitWeek;
  weekStart: Date;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  /** today's Start (shown on today's row when another day is picked, so there's never two) */
  onStart?: (item: WorkoutItem) => void;
  /** confirm / change / dismiss a time; absent = read-only (a coach's view) */
  timeActions?: {
    confirm: (entry: SplitEntry, time: string | null) => Promise<void> | void;
    dismiss: (entry: SplitEntry) => void;
    pending?: boolean;
  };
}) {
  const today = localStartOfToday();
  return (
    <div data-week-split>
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onSelectDate(addWeeks(selectedDate, -1))}
          aria-label="Previous week"
          className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold tabular-nums text-foreground">{weekRangeLabel(weekStart)}</span>
          {week.planned > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground" data-split-progress>
              {week.done} of {week.planned} done
            </span>
          )}
          {!isSameDay(selectedDate, today) && (
            <button
              type="button"
              onClick={() => onSelectDate(today)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
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
      <ol className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
        {week.rows.map((row) => {
          const picked = isSameDay(row.date, selectedDate);
          return (
            <li key={row.iso} data-split-day={row.iso} data-today={row.isToday || undefined}>
              <div className={cn("flex items-start transition-colors", picked ? "bg-muted/60" : "hover:bg-muted/30")}>
              <button
                type="button"
                onClick={() => {
                  feedback("tap");
                  onSelectDate(row.date);
                }}
                aria-current={picked ? "date" : undefined}
                className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left"
              >
                <div className="w-9 shrink-0 pt-0.5 text-center">
                  <div className={cn("text-[11px] font-medium", row.isToday ? "text-foreground" : "text-muted-foreground")}>
                    {format(row.date, "EEE")}
                  </div>
                  <div
                    className={cn(
                      "mx-auto mt-0.5 grid h-6 w-6 place-items-center rounded-full text-xs font-semibold tabular-nums",
                      row.isToday ? "bg-foreground text-background" : "text-foreground",
                    )}
                  >
                    {format(row.date, "d")}
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                  {row.entries.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Rest Day</div>
                  ) : (
                    row.entries.map((e) => (
                      <div key={e.key} className="min-w-0" data-split-status={e.status}>
                        <div className={cn("flex items-center gap-1.5 text-sm font-semibold", e.done && "text-muted-foreground line-through decoration-muted-foreground/60")}>
                          {e.done && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 no-underline dark:text-emerald-400" strokeWidth={3} aria-label="Done" />}
                          <span className="truncate">{e.title}</span>
                        </div>
                        <div
                          className={cn(
                            "mt-0.5 truncate text-xs tabular-nums",
                            e.status === "missed" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
                          )}
                        >
                          {e.time?.kind === "suggested" ? (
                            // unconfirmed: dashed, and it says so
                            <span className="rounded border border-dashed border-muted-foreground/50 px-1" data-suggested-time>
                              {e.line}
                            </span>
                          ) : (
                            e.line
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </button>
                {row.isToday && !picked && onStart && row.entries.some((e) => !e.done && e.status !== "missed") && (
                  <button
                    type="button"
                    onClick={() => {
                      const e = row.entries.find((x) => !x.done && x.status !== "missed");
                      if (e) onStart(e.item);
                    }}
                    className="mr-3 mt-3 shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                    data-split-start
                  >
                    Start
                  </button>
                )}
              </div>
              {picked && timeActions && row.entries.map((e) =>
                e.time && e.time.kind !== "none" && e.item.scheduledWorkoutId ? (
                  <TimeActions key={e.key} entry={e} actions={timeActions} />
                ) : null,
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TimeActions({
  entry,
  actions,
}: {
  entry: SplitEntry;
  actions: NonNullable<Parameters<typeof WeekSplitView>[0]["timeActions"]>;
}) {
  const t = entry.time!;
  const startMin = t.kind === "none" ? null : t.startMin;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(startMin != null ? timeValue(startMin) : "");
  const busy = !!actions.pending;
  if (editing) {
    return (
      <div className="flex items-center gap-2 px-3 pb-2.5 pl-[60px]" data-time-edit>
        <input
          type="time"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
          aria-label={`Time for ${entry.title}`}
        />
        <button
          type="button"
          disabled={busy || parseTimeValue(value) == null}
          onClick={async () => {
            await actions.confirm(entry, value);
            setEditing(false);
          }}
          className="h-8 rounded-md bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="h-8 px-2 text-xs text-muted-foreground">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pl-[60px]" data-time-actions={t.kind}>
      {t.kind === "suggested" ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => actions.confirm(entry, timeValue(t.startMin))}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50"
            data-confirm-time
          >
            <Check className="h-3.5 w-3.5" /> Confirm {clockLabel(t.startMin)}
          </button>
          <button type="button" onClick={() => setEditing(true)} className="h-8 rounded-full border border-border px-3 text-xs font-medium">
            Change
          </button>
          <button
            type="button"
            onClick={() => actions.dismiss(entry)}
            aria-label="Dismiss suggested time"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => setEditing(true)} className="h-8 rounded-full border border-border px-3 text-xs font-medium">
            Change time
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => actions.confirm(entry, null)}
            className="h-8 px-2 text-xs text-muted-foreground disabled:opacity-50"
          >
            Remove time
          </button>
        </>
      )}
    </div>
  );
}
