import { parseLocalDate } from "@/lib/today";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Play, CalendarClock } from "lucide-react";
import { format, startOfDay, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { rescheduleDay } from "@/lib/member-plans.functions";
import { toast } from "sonner";

type ScheduleEntry = { week: number; day: number; date: string; isOverride: boolean };

export function MemberPlanCalendar({
  enrollmentId, plan, schedule, doneSet,
}: {
  enrollmentId: string;
  plan: any;
  schedule: ScheduleEntry[];
  doneSet: Set<string>;
}) {
  const qc = useQueryClient();
  const reschedule = useServerFn(rescheduleDay);
  const today = startOfDay(new Date());
  const [month, setMonth] = useState<Date>(today);
  const [selected, setSelected] = useState<Date | undefined>(today);
  const [moving, setMoving] = useState<{ week: number; day: number; title: string } | null>(null);
  const [pickerDate, setPickerDate] = useState<Date | undefined>();

  const byDate = useMemo(() => {
    const m = new Map<string, ScheduleEntry[]>();
    for (const s of schedule) {
      const arr = m.get(s.date) ?? [];
      arr.push(s);
      m.set(s.date, arr);
    }
    return m;
  }, [schedule]);

  const dayTitle = (w: number, d: number) => {
    const week = plan?.published_payload?.weeks_data?.[w - 1];
    const day = week?.days?.[d - 1];
    return day?.title || `Week ${w} · Day ${d}`;
  };

  const selDate = selected ? format(selected, "yyyy-MM-dd") : null;
  const entries = selDate ? (byDate.get(selDate) ?? []) : [];

  const scheduledDays = useMemo(() => Array.from(byDate.keys()).map((s) => parseLocalDate(s)!), [byDate]);
  const doneDays = useMemo(
    () => schedule.filter((s) => doneSet.has(`${s.week}:${s.day}`)).map((s) => parseLocalDate(s.date)!),
    [schedule, doneSet],
  );
  const missedDays = useMemo(
    () => schedule
      .filter((s) => !doneSet.has(`${s.week}:${s.day}`) && parseLocalDate(s.date)! < today)
      .map((s) => parseLocalDate(s.date)!),
    [schedule, doneSet, today],
  );

  const handleMove = async () => {
    if (!moving || !pickerDate) return;
    try {
      await reschedule({ data: { enrollmentId, weekIndex: moving.week, dayIndex: moving.day, scheduledDate: format(pickerDate, "yyyy-MM-dd") } });
      toast.success("Workout moved");
      qc.invalidateQueries({ queryKey: ["m-schedule", enrollmentId] });
      setMoving(null);
      setSelected(pickerDate);
    } catch (e: any) { toast.error(e?.message ?? "Could not move"); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-2 sm:p-4">
        <div className="flex justify-center">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            month={month}
            onMonthChange={setMonth}
            modifiers={{ workout: scheduledDays, done: doneDays, missed: missedDays }}
            modifiersClassNames={{
              workout: "font-bold",
              done: "bg-green-500/15 text-green-600 rounded-md",
              missed: "bg-destructive/15 text-destructive rounded-md",
            }}
            className={cn("p-2 pointer-events-auto")}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-primary/40" />Scheduled</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-green-500/40" />Done</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-destructive/40" />Missed</span>
        </div>
      </Card>

      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {selected ? format(selected, "EEEE, MMM d") : "Select a date"}
        </div>
        {entries.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">No workouts scheduled.</Card>
        ) : (
          entries.map((e) => {
            const done = doneSet.has(`${e.week}:${e.day}`);
            const dateObj = parseLocalDate(e.date)!;
            const isToday = isSameDay(dateObj, today);
            const isPast = dateObj < today && !done;
            return (
              <Card key={`${e.week}:${e.day}`} className="overflow-hidden p-0">
                <Link
                  to="/m/workouts/$enrollmentId/$week/$day"
                  params={{ enrollmentId, week: String(e.week), day: String(e.day) }}
                  className="block px-4 py-3 active:bg-secondary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{dayTitle(e.week, e.day)}</div>
                      <div className="text-xs text-muted-foreground">Week {e.week} · Day {e.day}</div>
                    </div>
                    {done ? (
                      <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-500"><CheckCircle2 className="mr-1 h-3 w-3" />Done</Badge>
                    ) : isPast ? (
                      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">Missed</Badge>
                    ) : isToday ? (
                      <Badge>Today</Badge>
                    ) : null}
                  </div>
                </Link>
                <div className="flex gap-2 border-t bg-muted/30 px-3 py-2">
                  <Link to="/m/workouts/$enrollmentId/$week/$day" params={{ enrollmentId, week: String(e.week), day: String(e.day) }} className="flex-1">
                    <Button size="sm" variant={isToday && !done ? "default" : "outline"} className="h-10 w-full">
                      <Play className="mr-1 h-4 w-4" />{done ? "Review" : "Start workout"}
                    </Button>
                  </Link>
                  <Button
                    size="sm" variant="ghost" className="h-10"
                    onClick={() => {
                      setMoving({ week: e.week, day: e.day, title: dayTitle(e.week, e.day) });
                      setPickerDate(dateObj);
                    }}
                  >
                    <CalendarClock className="mr-1 h-4 w-4" />Move
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Sheet open={!!moving} onOpenChange={(o) => !o && setMoving(null)}>
        <SheetContent side="bottom" className="max-h-[90vh]">
          <SheetHeader>
            <SheetTitle>Move {moving?.title}</SheetTitle>
            <SheetDescription>Pick a new date for this workout.</SheetDescription>
          </SheetHeader>
          <div className="flex justify-center py-4">
            <Calendar mode="single" selected={pickerDate} onSelect={setPickerDate} className={cn("p-3 pointer-events-auto rounded-md border")} />
          </div>
          <SheetFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1 h-12" onClick={() => setMoving(null)}>Cancel</Button>
            <Button className="flex-1 h-12" disabled={!pickerDate} onClick={handleMove}>Move workout</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}