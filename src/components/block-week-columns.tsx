import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, Play, ChevronRight, CalendarRange, Crosshair, Lock } from "lucide-react";
import { startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { durationRange } from "@/lib/pl-programs";
import { weekDisplayRange, formatWeekRange, isCurrentWeek } from "@/lib/block-dates";
import { displayWeekStatus, weekStatusTone, isWeekLocked } from "@/lib/workout-today";

type Mode = "admin" | "client";
type WeekEntry = { week: any; entries: { day: any; week: any; block: any; completion: any }[] };

/**
 * Always-open horizontal week columns. No accordion, no manual completion toggle.
 * Today's workout is auto-highlighted; future weeks render as Locked for the client.
 */
export function BlockWeekColumns({
  block, weeks, mode,
}: {
  block: any;
  weeks: WeekEntry[];
  mode: Mode;
}) {
  const today = startOfDay(new Date());

  return (
    <div className="-mx-2 overflow-x-auto pb-2">
      <div className="flex min-w-min divide-x divide-border px-2">
        {weeks.map(({ week, entries }) => {
          const range = week ? weekDisplayRange(block, week) : null;
          const now = isCurrentWeek(range);
          const locked = mode === "client" && week ? isWeekLocked(block, week) : false;
          const totalMin = entries.reduce(
            (s, it) => s + (it.day.duration_override_min ?? it.day.duration_estimate_min ?? 60),
            0,
          );
          const doneCount = entries.filter((it) => it.completion?.completed_at).length;
          const baseStatus = displayWeekStatus(week?.status);
          const status = locked && doneCount === 0 && baseStatus === "Not Started" ? "Locked" : baseStatus;
          const tone = weekStatusTone(status);
          const remaining = Math.max(0, entries.length - doneCount);

          return (
            <div
              key={week?.id ?? Math.random()}
              className={cn(
                "w-[280px] shrink-0 space-y-2 px-3 sm:w-[320px]",
                now && "bg-primary/5",
                status === "Locked" && "opacity-75",
              )}
            >
              {/* Week header */}
              <div className="space-y-1 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm">Week {week?.week_index ?? "—"}</span>
                  {now && (
                    <Badge className="h-5 border-primary/40 bg-primary/15 px-1.5 text-[10px] font-semibold text-primary hover:bg-primary/20">
                      <Crosshair className="mr-1 h-3 w-3" />Current
                    </Badge>
                  )}
                  {week && (
                    <Badge variant="outline" className={cn("text-[10px]", tone)}>
                      {status === "Locked" && <Lock className="mr-1 h-2.5 w-2.5" />}
                      {status}
                    </Badge>
                  )}
                </div>
                {range && (
                  <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <CalendarRange className="h-3 w-3" />
                    {formatWeekRange(range.start, range.end)}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {entries.length === 0
                    ? "No workouts"
                    : `${doneCount} of ${entries.length} Workouts Complete`}
                  {remaining > 0 && entries.length > 0 ? ` · ${remaining} remaining` : ""}
                  {totalMin ? ` · ~${totalMin} min` : ""}
                </div>
                {week?.training_days?.length > 0 && (
                  <div className="text-[10px] text-muted-foreground truncate">{week.training_days.join(", ")}</div>
                )}
                {week?.notes && <p className="text-[10px] text-muted-foreground line-clamp-2">{week.notes}</p>}
              </div>

              {/* Workouts (always open) */}
              <div className="space-y-1.5 pb-2">
                {entries.map((it) => {
                  const done = !!it.completion?.completed_at;
                  const started = !!it.completion && !done;
                  // Auto-derive a per-day date for today/missed detection.
                  let dayDate: Date | null = null;
                  if (it.day?.scheduled_date) {
                    dayDate = startOfDay(new Date(it.day.scheduled_date + "T00:00:00"));
                  } else if (range) {
                    const idx = Math.max(0, (it.day?.day_index ?? 1) - 1);
                    const d = new Date(range.start);
                    d.setDate(d.getDate() + Math.min(6, idx));
                    dayDate = startOfDay(d);
                  }
                  const isToday = !!dayDate && dayDate.getTime() === today.getTime();
                  const isPast = !!dayDate && dayDate < today;

                  const inner = (
                    <Card
                      className={cn(
                        "p-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-secondary/40 active:bg-secondary/60 transition",
                        isToday && !done && "border-primary ring-2 ring-primary/40",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs truncate flex items-center gap-1">
                          {it.day.title || `Day ${it.day.day_index}`}
                          {it.day.focus ? (
                            <span className="text-muted-foreground font-normal"> — {it.day.focus}</span>
                          ) : null}
                          {isToday && !done && (
                            <Badge className="h-4 border-primary/40 bg-primary/15 px-1 text-[9px] font-bold text-primary hover:bg-primary/20">
                              Today
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {durationRange(it.day.duration_override_min ?? it.day.duration_estimate_min ?? 60)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {done ? (
                          <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10 text-[9px] px-1">
                            <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />Completed
                          </Badge>
                        ) : started ? (
                          <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[9px] px-1">
                            In Progress
                          </Badge>
                        ) : isPast ? (
                          <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/10 text-[9px] px-1">
                            Missed
                          </Badge>
                        ) : (
                          <Play className="h-3 w-3 text-primary" />
                        )}
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </Card>
                  );
                  if (mode === "client") {
                    return (
                      <Link key={it.day.id} to="/portal/workouts/$dayId" params={{ dayId: it.day.id }} className="block">
                        {inner}
                      </Link>
                    );
                  }
                  return (
                    <Link key={it.day.id} to="/admin/blocks/$blockId" params={{ blockId: block?.id }} className="block">
                      {inner}
                    </Link>
                  );
                })}
                {entries.length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic">No workouts in this week.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}