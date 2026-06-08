import { useMemo, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, Play, ChevronRight, CalendarRange, Crosshair, Lock } from "lucide-react";
import { startOfDay, format } from "date-fns";
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
/**
 * Horizontal week timeline + day list for the selected week.
 *
 * - Weeks render as compact, equal-sized tiles in a single horizontal row.
 *   Desktop fits up to ~8 across; mobile scrolls horizontally.
 * - Selecting a tile updates the day list shown beneath the row.
 * - No accordion / no vertical stacking of weeks.
 */
export function BlockWeekColumns({
  block, weeks, mode,
}: {
  block: any;
  weeks: WeekEntry[];
  mode: Mode;
}) {
  const today = startOfDay(new Date());

  // Pre-compute per-week metadata once.
  const computed = useMemo(() => weeks.map(({ week, entries }) => {
    const range = week ? weekDisplayRange(block, week) : null;
    const now = isCurrentWeek(range);
    const locked = mode === "client" && week ? isWeekLocked(block, week) : false;
    const doneCount = entries.filter((it) => it.completion?.completed_at).length;
    const baseStatus = displayWeekStatus(week?.status);
    const status = locked && doneCount === 0 && baseStatus === "Not Started" ? "Locked" : baseStatus;
    return { week, entries, range, now, locked, doneCount, status };
  }), [weeks, block, mode]);

  // Default selection: current week → first incomplete → first.
  const defaultId = useMemo(() => {
    const cur = computed.find((w) => w.now)?.week?.id;
    if (cur) return cur;
    const incomplete = computed.find((w) => w.doneCount < w.entries.length && !w.locked)?.week?.id;
    return incomplete ?? computed[0]?.week?.id ?? null;
  }, [computed]);

  const [selectedId, setSelectedId] = useState<string | null>(defaultId);
  useEffect(() => { setSelectedId(defaultId); }, [defaultId]);

  const selected = computed.find((w) => w.week?.id === selectedId) ?? computed[0];

  return (
    <div className="space-y-4">
      {/* Horizontal week timeline */}
      <div className="-mx-1 overflow-x-auto pb-2">
        <div className="flex min-w-min items-stretch gap-2 px-1">
          {computed.map(({ week, entries, range, now, status, doneCount }) => {
            const tone = weekStatusTone(status);
            const isSelected = week?.id === selected?.week?.id;
            const total = entries.length;
            const progressLine =
              status === "Locked"
                ? range ? `Starts ${format(range.start, "MMM d")}` : "Locked"
                : total === 0
                  ? "No workouts"
                  : `${doneCount} of ${total} complete`;
            return (
              <button
                key={week?.id ?? Math.random()}
                type="button"
                onClick={() => week?.id && setSelectedId(week.id)}
                className={cn(
                  "group relative flex w-[140px] sm:w-[160px] shrink-0 flex-col items-start gap-1 rounded-md border bg-card p-2.5 text-left transition",
                  "hover:bg-secondary/40",
                  isSelected
                    ? "border-primary ring-2 ring-primary/40 bg-primary/5"
                    : "border-border",
                  status === "Locked" && "opacity-70",
                )}
                aria-pressed={isSelected}
              >
                <div className="flex w-full items-center justify-between gap-1">
                  <span className="text-[11px] font-black uppercase tracking-wider">
                    Week {week?.week_index ?? "—"}
                  </span>
                  {now && (
                    <Badge className="h-4 border-primary/40 bg-primary/15 px-1 text-[9px] font-bold text-primary hover:bg-primary/20">
                      <Crosshair className="mr-0.5 h-2.5 w-2.5" />Now
                    </Badge>
                  )}
                </div>
                {week && (
                  <Badge variant="outline" className={cn("h-4 px-1 text-[9px]", tone)}>
                    {status === "Locked" && <Lock className="mr-0.5 h-2.5 w-2.5" />}
                    {status}
                  </Badge>
                )}
                <div className="text-[10px] text-muted-foreground leading-tight">
                  {progressLine}
                </div>
                {range && status !== "Locked" && (
                  <div className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                    <CalendarRange className="h-2.5 w-2.5" />
                    {formatWeekRange(range.start, range.end)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Day list for the selected week */}
      {selected && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Week {selected.week?.week_index ?? "—"} Workouts
            </div>
            {selected.range && (
              <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <CalendarRange className="h-3 w-3" />
                {formatWeekRange(selected.range.start, selected.range.end)}
              </div>
            )}
          </div>
          {selected.week?.notes && (
            <p className="px-1 text-[11px] text-muted-foreground">{selected.week.notes}</p>
          )}
          <div className="space-y-1.5">
            {selected.entries.map((it) => {
              const done = !!it.completion?.completed_at;
              const started = !!it.completion && !done;
              let dayDate: Date | null = null;
              if (it.day?.scheduled_date) {
                dayDate = startOfDay(new Date(it.day.scheduled_date + "T00:00:00"));
              } else if (selected.range) {
                const idx = Math.max(0, (it.day?.day_index ?? 1) - 1);
                const d = new Date(selected.range.start);
                d.setDate(d.getDate() + Math.min(6, idx));
                dayDate = startOfDay(d);
              }
              const isToday = !!dayDate && dayDate.getTime() === today.getTime();
              const isPast = !!dayDate && dayDate < today;

              const inner = (
                <Card className={cn(
                  "p-2.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-secondary/40 active:bg-secondary/60 transition",
                  isToday && !done && "border-primary ring-2 ring-primary/40",
                )}>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                      {it.day.title || `Day ${it.day.day_index}`}
                      {it.day.focus ? (
                        <span className="text-muted-foreground font-normal text-xs"> — {it.day.focus}</span>
                      ) : null}
                      {isToday && !done && (
                        <Badge className="h-4 border-primary/40 bg-primary/15 px-1 text-[9px] font-bold text-primary hover:bg-primary/20">
                          Today
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {durationRange(it.day.duration_override_min ?? it.day.duration_estimate_min ?? 60)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {done ? (
                      <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10 text-[10px] px-1.5">
                        <CheckCircle2 className="mr-0.5 h-3 w-3" />Completed
                      </Badge>
                    ) : started ? (
                      <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[10px] px-1.5">
                        In Progress
                      </Badge>
                    ) : isPast ? (
                      <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/10 text-[10px] px-1.5">
                        Missed
                      </Badge>
                    ) : (
                      <Play className="h-3.5 w-3.5 text-primary" />
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
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
            {selected.entries.length === 0 && (
              <p className="px-1 text-[11px] text-muted-foreground italic">No workouts in this week.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}