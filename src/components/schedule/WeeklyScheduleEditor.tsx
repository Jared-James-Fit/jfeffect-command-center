import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CalendarDays } from "lucide-react";
import { applyBulkScheduleChange } from "@/lib/schedule-bulk.functions";
import type { ScheduleDay, ScheduleWeek } from "./ScheduleCalendar";

const WEEKDAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export interface WeeklyScheduleEditorProps {
  days: ScheduleDay[];
  weeks: ScheduleWeek[];
  weekId: string;
  /** "this" → only this week. "future" → also shift later weeks the same way. */
}

export function WeeklyScheduleEditor({ days, weeks, weekId }: WeeklyScheduleEditorProps) {
  const qc = useQueryClient();
  const apply = useServerFn(applyBulkScheduleChange);

  const week = weeks.find((w) => w.id === weekId)!;
  const weekDays = useMemo(
    () => days.filter((d) => d.week_id === weekId).sort((a,b) => a.day_index - b.day_index),
    [days, weekId],
  );

  // Anchor week start: prefer current scheduled dates of the week's first day,
  // fall back to current week's Monday.
  const anchor = weekDays[0]?.scheduled_date
    ? startOfWeek(parseISO(weekDays[0]!.scheduled_date!), { weekStartsOn: 1 })
    : startOfWeek(new Date(), { weekStartsOn: 1 });

  // dayIndex → weekday offset 0..6 (Mon..Sun)
  const [assignment, setAssignment] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (let i = 0; i < weekDays.length; i++) {
      const d = weekDays[i];
      if (d.scheduled_date) {
        const dt = parseISO(d.scheduled_date);
        const offset = (dt.getDay() + 6) % 7; // Mon=0..Sun=6
        out[d.id] = offset;
      } else {
        out[d.id] = i; // default Mon, Tue, …
      }
    }
    return out;
  });

  const [scope, setScope] = useState<"this" | "future">("this");

  const futureWeekIds = useMemo(() => {
    if (scope === "this") return [week.id];
    return weeks.filter((w) => w.block_id === week.block_id && w.week_index >= week.week_index).map((w) => w.id);
  }, [scope, weeks, week]);

  const moves = useMemo(() => {
    const out: Array<{ dayId: string; newDate: string }> = [];
    for (const wid of futureWeekIds) {
      const target = weeks.find((w) => w.id === wid)!;
      const weekOffset = (target.week_index - week.week_index);
      const targetStart = addDays(anchor, weekOffset * 7);
      const targetWeekDays = days.filter((d) => d.week_id === wid);
      for (const td of targetWeekDays) {
        // Match by day_index → use assignment from anchor
        const anchorDay = weekDays.find((d) => d.day_index === td.day_index);
        if (!anchorDay) continue;
        const off = assignment[anchorDay.id] ?? td.day_index - 1;
        const nd = ymd(addDays(targetStart, off));
        if (td.scheduled_date !== nd) out.push({ dayId: td.id, newDate: nd });
      }
    }
    return out;
  }, [futureWeekIds, weeks, week, anchor, days, weekDays, assignment]);

  const mutation = useMutation({
    mutationFn: async () => apply({
      data: {
        moves,
        scope: scope === "this" ? "week" : "block",
        confirmCompletedMove: true,
      },
    }),
    onSuccess: (res: any) => {
      if (res?.ok) {
        toast.success(`Updated ${res.applied} workout dates.`);
        void qc.invalidateQueries();
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4" /> Weekly schedule — Week {week.week_index}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          Pick which weekday each workout falls on.
        </div>
        <div className="space-y-2">
          {weekDays.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{d.title?.trim() || `Day ${d.day_index}`}</div>
                <div className="text-xs text-muted-foreground">Day {d.day_index}</div>
              </div>
              <Select
                value={String(assignment[d.id] ?? d.day_index - 1)}
                onValueChange={(v) => setAssignment((p) => ({ ...p, [d.id]: parseInt(v, 10) }))}
              >
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((w, i) => (
                    <SelectItem key={i} value={String(i)}>{w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground w-24 text-right">
                → {format(addDays(anchor, assignment[d.id] ?? 0), "MMM d")}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <Select value={scope} onValueChange={(v) => setScope(v as any)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="this">This week only</SelectItem>
              <SelectItem value="future">This + future weeks in block</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => mutation.mutate()} disabled={moves.length === 0 || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Apply {moves.length} change{moves.length === 1 ? "" : "s"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
