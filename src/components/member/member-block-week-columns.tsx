import { parseLocalDate } from "@/lib/today";
import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Calendar } from "@/components/ui/calendar";
import {
  Clock, CheckCircle2, Play, ChevronRight, Crosshair, CalendarRange,
  CalendarClock, ArrowLeftRight, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, startOfDay } from "date-fns";
import { rescheduleDay, swapDays, resetDaySchedule } from "@/lib/member-plans.functions";
import { toast } from "sonner";

type ScheduleEntry = { week: number; day: number; date: string; isOverride: boolean };

export function MemberBlockWeekColumns({
  enrollmentId,
  plan,
  schedule,
  doneSet,
}: {
  enrollmentId: string;
  plan: any;
  schedule: ScheduleEntry[];
  doneSet: Set<string>;
}) {
  const qc = useQueryClient();
  const reschedule = useServerFn(rescheduleDay);
  const swap = useServerFn(swapDays);
  const reset = useServerFn(resetDaySchedule);
  const today = startOfDay(new Date());

  const weeks = (plan?.published_payload?.weeks_data ?? []) as any[];
  const dateFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of schedule) m.set(`${s.week}:${s.day}`, s.date);
    return m;
  }, [schedule]);

  const weekRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const scrollToWeek = (w: number) => weekRefs.current[w]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });

  const [editing, setEditing] = useState<{ week: number; day: number; title: string; date: string } | null>(null);
  const [pickerDate, setPickerDate] = useState<Date | undefined>();
  const [swapping, setSwapping] = useState<{ week: number; day: number } | null>(null);

  const computed = weeks.map((w) => {
    const days = (w.days ?? []) as any[];
    const dates = days.map((d) => dateFor.get(`${w.week_index}:${d.day_index}`)).filter(Boolean) as string[];
    const min = dates.length ? parseLocalDate(dates.reduce((a, b) => (a < b ? a : b))) : null;
    const max = dates.length ? parseLocalDate(dates.reduce((a, b) => (a > b ? a : b))) : null;
    const isNow = !!min && !!max && today >= min && today <= max;
    const doneCount = days.filter((d) => doneSet.has(`${w.week_index}:${d.day_index}`)).length;
    return { week: w, days, min, max, isNow, doneCount };
  });

  const handleReschedule = async () => {
    if (!editing || !pickerDate) return;
    try {
      await reschedule({ data: { enrollmentId, weekIndex: editing.week, dayIndex: editing.day, scheduledDate: format(pickerDate, "yyyy-MM-dd") } });
      toast.success("Workout moved");
      qc.invalidateQueries({ queryKey: ["m-schedule", enrollmentId] });
      setEditing(null);
    } catch (e: any) { toast.error(e?.message ?? "Could not move workout"); }
  };

  const handleSwap = async (target: { week: number; day: number }) => {
    if (!swapping) return;
    try {
      await swap({ data: { enrollmentId, a: { weekIndex: swapping.week, dayIndex: swapping.day }, b: { weekIndex: target.week, dayIndex: target.day } } });
      toast.success("Workouts swapped");
      qc.invalidateQueries({ queryKey: ["m-schedule", enrollmentId] });
      setSwapping(null);
    } catch (e: any) { toast.error(e?.message ?? "Could not swap"); }
  };

  const handleReset = async () => {
    if (!confirm("Reset all workout dates to the default schedule?")) return;
    try {
      await reset({ data: { enrollmentId } });
      toast.success("Schedule reset");
      qc.invalidateQueries({ queryKey: ["m-schedule", enrollmentId] });
    } catch (e: any) { toast.error(e?.message ?? "Could not reset"); }
  };

  if (swapping) {
    return (
      <div className="space-y-3">
        <Card className="border-primary/40 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              <div className="font-semibold">Pick a workout to swap with</div>
              <div className="text-xs text-muted-foreground">Tap any other day to switch dates.</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSwapping(null)}>Cancel</Button>
          </div>
        </Card>
        {weeks.map((w) => (
          <Card key={w.week_index} className="p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Week {w.week_index}</div>
            <div className="grid gap-2">
              {(w.days ?? []).map((d: any) => {
                const isSelf = swapping.week === w.week_index && swapping.day === d.day_index;
                const date = dateFor.get(`${w.week_index}:${d.day_index}`);
                return (
                  <button
                    key={d.day_index}
                    disabled={isSelf}
                    onClick={() => handleSwap({ week: w.week_index, day: d.day_index })}
                    className={cn(
                      "flex min-h-12 items-center justify-between rounded-md border bg-card p-3 text-left transition active:scale-[0.99]",
                      isSelf ? "opacity-40" : "hover:bg-primary/10",
                    )}
                  >
                    <div>
                      <div className="text-sm font-semibold">{d.title || `Day ${d.day_index}`}</div>
                      <div className="text-xs text-muted-foreground">{date ? format(parseLocalDate(date)!, "EEE, MMM d") : "—"}</div>
                    </div>
                    {!isSelf && <ArrowLeftRight className="h-4 w-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {/* week strip nav */}
      <div className="-mx-3 overflow-x-auto px-3 pb-2 sm:-mx-1 sm:px-1">
        <div className="flex min-w-max items-stretch gap-2">
          {computed.map(({ week, days, min, max, isNow, doneCount }) => (
            <button
              key={week.week_index}
              type="button"
              onClick={() => scrollToWeek(week.week_index)}
              className={cn(
                "flex w-[140px] shrink-0 flex-col items-start gap-1 rounded-md border bg-card p-2.5 text-left transition active:scale-[0.99] sm:w-[160px]",
                isNow ? "border-primary bg-primary/5 ring-2 ring-primary/40" : "border-border hover:bg-secondary/40",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider">Week {week.week_index}</span>
                {isNow && (
                  <Badge className="h-4 border-primary/40 bg-primary/15 px-1 text-[9px] font-bold text-primary hover:bg-primary/20">
                    <Crosshair className="mr-0.5 h-2.5 w-2.5" />Now
                  </Badge>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground">{doneCount} of {days.length} done</div>
              {min && max && (
                <div className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                  <CalendarRange className="h-2.5 w-2.5" />
                  {format(min, "MMM d")} – {format(max, "MMM d")}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* horizontal week columns */}
      <div className="-mx-3 snap-x snap-mandatory overflow-x-auto px-3 pb-3">
        <div className="flex w-max min-w-0 flex-row items-start gap-3">
          {computed.map(({ week, days, isNow }) => (
            <div
              key={week.week_index}
              ref={(el) => { weekRefs.current[week.week_index] = el; }}
              className={cn(
                "w-[88vw] max-w-[420px] shrink-0 snap-start scroll-mt-24 space-y-2 rounded-md border p-3 md:w-[380px] lg:w-[400px]",
                isNow ? "border-primary/50 bg-primary/5" : "border-border bg-card/40",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Week {week.week_index}</div>
                {isNow && (
                  <Badge className="h-4 border-primary/40 bg-primary/15 px-1 text-[9px] font-bold text-primary">
                    <Crosshair className="mr-0.5 h-2.5 w-2.5" />Now
                  </Badge>
                )}
              </div>
              <div className="space-y-2">
                {days.map((d: any) => {
                  const key = `${week.week_index}:${d.day_index}`;
                  const dateStr = dateFor.get(key);
                  const date = dateStr ? startOfDay(parseLocalDate(dateStr)!) : null;
                  const done = doneSet.has(key);
                  const isToday = !!date && date.getTime() === today.getTime();
                  const isPast = !!date && date < today;
                  return (
                    <Card
                      key={d.day_index}
                      className={cn(
                        "overflow-hidden p-0 transition",
                        isToday && !done && "border-primary ring-2 ring-primary/40",
                      )}
                    >
                      <Link
                        to="/m/workouts/$enrollmentId/$week/$day"
                        params={{ enrollmentId, week: String(week.week_index), day: String(d.day_index) }}
                        className="block px-3 pt-3 pb-2 active:bg-secondary/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                              <span className="break-words">{d.title || `Day ${d.day_index}`}</span>
                              {isToday && !done && (
                                <Badge className="h-4 border-primary/40 bg-primary/15 px-1 text-[9px] font-bold text-primary">Today</Badge>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {date ? format(date, "EEEE, MMM d") : "—"}
                              {d.rows?.length ? ` · ${d.rows.length} exercises` : ""}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {done ? (
                              <Badge variant="outline" className="border-green-500/30 bg-green-500/10 px-1.5 text-[10px] text-green-500">
                                <CheckCircle2 className="mr-0.5 h-3 w-3" />Done
                              </Badge>
                            ) : isPast ? (
                              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 px-1.5 text-[10px] text-destructive">Missed</Badge>
                            ) : (
                              <Play className="h-4 w-4 text-primary" />
                            )}
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      </Link>
                      <div className="flex items-center gap-1 border-t bg-muted/30 px-2 py-1.5">
                        <Link
                          to="/m/workouts/$enrollmentId/$week/$day"
                          params={{ enrollmentId, week: String(week.week_index), day: String(d.day_index) }}
                          className="flex-1"
                        >
                          <Button size="sm" variant={isToday && !done ? "default" : "ghost"} className="h-9 w-full text-xs">
                            {done ? "Review" : isToday ? "Start workout" : "Open"}
                          </Button>
                        </Link>
                        <Button
                          size="sm" variant="ghost" className="h-9 px-2 text-xs"
                          onClick={() => {
                            setEditing({ week: week.week_index, day: d.day_index, title: d.title || `Day ${d.day_index}`, date: dateStr ?? format(today, "yyyy-MM-dd") });
                            setPickerDate(date ?? today);
                          }}
                          aria-label="Change date"
                        >
                          <CalendarClock className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-9 px-2 text-xs"
                          onClick={() => setSwapping({ week: week.week_index, day: d.day_index })}
                          aria-label="Swap with another day"
                        >
                          <ArrowLeftRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  );
                })}
                {days.length === 0 && <p className="text-[11px] italic text-muted-foreground">No workouts in this week.</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={handleReset} className="h-9 text-xs text-muted-foreground">
          <RotateCcw className="mr-1 h-3.5 w-3.5" />Reset to default dates
        </Button>
      </div>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="bottom" className="max-h-[90vh]">
          <SheetHeader>
            <SheetTitle>Move {editing?.title}</SheetTitle>
            <SheetDescription>Pick a new date for this workout. Other workouts stay where they are.</SheetDescription>
          </SheetHeader>
          <div className="flex justify-center py-4">
            <Calendar
              mode="single"
              selected={pickerDate}
              onSelect={setPickerDate}
              className={cn("p-3 pointer-events-auto rounded-md border")}
            />
          </div>
          <SheetFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1 h-12" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="flex-1 h-12" disabled={!pickerDate} onClick={handleReschedule}>Move workout</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}