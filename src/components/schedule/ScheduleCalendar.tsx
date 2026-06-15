import { useMemo, useState } from "react";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor,
  useSensor, useSensors, DragOverlay, type DragEndEvent,
} from "@dnd-kit/core";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths,
  format, isSameDay, isSameMonth, isBefore, startOfToday, parseISO,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CheckCircle2, Clock, AlertCircle, GripVertical, Calendar as CalIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type ScheduleDay = {
  id: string; day_index: number; title: string | null; focus: string | null;
  scheduled_date: string | null; schedule_source: string | null;
  schedule_locked: boolean | null; week_id: string;
};
export type ScheduleWeek = { id: string; week_index: number; block_id: string };
export type ScheduleBlock = { id: string; name: string | null; start_date: string | null; end_date: string | null };
export type ScheduleCompletion = { day_id: string; completed_at: string | null; in_progress_at: string | null };

type Status = "completed" | "in-progress" | "overdue" | "rescheduled" | "scheduled";
function statusOf(day: ScheduleDay, comp: ScheduleCompletion | null): Status {
  if (comp?.completed_at) return "completed";
  if (comp?.in_progress_at) return "in-progress";
  if (day.scheduled_date && isBefore(parseISO(day.scheduled_date), startOfToday())) return "overdue";
  if (day.schedule_source === "manual") return "rescheduled";
  return "scheduled";
}
function statusBadge(s: Status) {
  switch (s) {
    case "completed": return <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Done</Badge>;
    case "in-progress": return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> In progress</Badge>;
    case "overdue": return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Overdue</Badge>;
    case "rescheduled": return <Badge variant="outline" className="gap-1"><CalIcon className="h-3 w-3" /> Moved</Badge>;
    default: return <Badge variant="outline">Scheduled</Badge>;
  }
}

function DayChip({ day, comp, week, blockName, draggable }: {
  day: ScheduleDay; comp: ScheduleCompletion | null;
  week?: ScheduleWeek; blockName?: string | null; draggable: boolean;
}) {
  const id = day.id;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id, disabled: !draggable,
  });
  const status = statusOf(day, comp);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "group rounded-md border border-border bg-card p-1.5 text-[11px] leading-tight space-y-0.5 select-none",
        draggable && "cursor-grab active:cursor-grabbing touch-none",
        isDragging && "opacity-50",
        status === "completed" && "opacity-70",
      )}
    >
      <div className="flex items-center gap-1">
        {draggable && <GripVertical className="h-3 w-3 text-muted-foreground" />}
        <span className="font-medium truncate flex-1">
          {day.title?.trim() || `Day ${day.day_index}`}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground truncate">
        {blockName ? `${blockName} · ` : ""}W{week?.week_index ?? "?"} · D{day.day_index}
      </div>
      <div>{statusBadge(status)}</div>
    </div>
  );
}

function DroppableCell({ date, children, dim }: { date: Date; children: React.ReactNode; dim: boolean }) {
  const id = format(date, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({ id });
  const today = isSameDay(date, new Date());
  return (
    <div
      ref={setNodeRef}
      data-cell-date={id}
      className={cn(
        "min-h-[110px] border border-border/60 p-1 space-y-1 transition-colors",
        dim && "bg-muted/40 text-muted-foreground",
        today && "bg-primary/5 ring-1 ring-primary/30",
        isOver && "bg-primary/15 ring-2 ring-primary",
      )}
    >
      <div className="text-[10px] font-semibold flex items-center justify-between">
        <span>{format(date, "d")}</span>
        {today && <span className="text-primary uppercase tracking-wide text-[9px]">Today</span>}
      </div>
      {children}
    </div>
  );
}

export interface ScheduleCalendarProps {
  days: ScheduleDay[];
  weeks: ScheduleWeek[];
  blocks: ScheduleBlock[];
  completions: ScheduleCompletion[];
  canEdit: boolean;
  onMoveDay: (dayId: string, targetDate: Date) => void;
  /** Open the move sheet pre-filled with the workout but no target date. */
  onSelectDay?: (dayId: string) => void;
}

export function ScheduleCalendar(props: ScheduleCalendarProps) {
  const { days, weeks, blocks, completions, canEdit, onMoveDay, onSelectDay } = props;
  const [view, setView] = useState<"month" | "list">("month");
  const [cursor, setCursor] = useState<Date>(startOfMonth(new Date()));
  const [dragId, setDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const weekMap = useMemo(() => new Map(weeks.map((w) => [w.id, w])), [weeks]);
  const blockMap = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const compMap = useMemo(() => {
    const m = new Map<string, ScheduleCompletion>();
    for (const c of completions) m.set(c.day_id, c);
    return m;
  }, [completions]);

  const byDate = useMemo(() => {
    const m = new Map<string, ScheduleDay[]>();
    for (const d of days) {
      if (!d.scheduled_date) continue;
      const list = m.get(d.scheduled_date) ?? [];
      list.push(d);
      m.set(d.scheduled_date, list);
    }
    return m;
  }, [days]);

  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });

  const cells: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) cells.push(d);

  const upcoming = useMemo(() => {
    const today = startOfToday();
    return days
      .filter((d) => d.scheduled_date)
      .map((d) => ({ d, date: parseISO(d.scheduled_date!) }))
      .filter((x) => x.date >= today)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 30);
  }, [days]);

  const handleDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    if (!e.over || !e.active) return;
    const dayId = String(e.active.id);
    const targetDate = parseISO(String(e.over.id));
    onMoveDay(dayId, targetDate);
  };

  const draggedDay = dragId ? days.find((d) => d.id === dragId) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setDragId(String(e.active.id))}
      onDragCancel={() => setDragId(null)}
      onDragEnd={handleDragEnd}
    >
      <Tabs value={view} onValueChange={(v) => setView(v as any)}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>
          {view === "month" && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setCursor(addMonths(cursor, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-sm font-semibold w-32 text-center">
                {format(cursor, "MMMM yyyy")}
              </div>
              <Button size="sm" variant="outline" onClick={() => setCursor(addMonths(cursor, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCursor(startOfMonth(new Date()))}>
                Today
              </Button>
            </div>
          )}
        </div>

        <TabsContent value="month" className="mt-0">
          <div className="grid grid-cols-7 text-[10px] font-medium text-muted-foreground mb-1">
            {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
              <div key={d} className="px-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0">
            {cells.map((date) => {
              const ymd = format(date, "yyyy-MM-dd");
              const list = byDate.get(ymd) ?? [];
              return (
                <DroppableCell key={ymd} date={date} dim={!isSameMonth(date, cursor)}>
                  {list.map((day) => {
                    const wk = weekMap.get(day.week_id);
                    const blk = wk ? blockMap.get(wk.block_id) : null;
                    return (
                      <div key={day.id} onClick={() => onSelectDay?.(day.id)}>
                        <DayChip
                          day={day}
                          week={wk}
                          blockName={blk?.name ?? null}
                          comp={compMap.get(day.id) ?? null}
                          draggable={canEdit}
                        />
                      </div>
                    );
                  })}
                </DroppableCell>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="list" className="mt-0">
          <div className="space-y-2">
            {upcoming.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">No upcoming workouts scheduled.</div>
            )}
            {upcoming.map(({ d, date }) => {
              const wk = weekMap.get(d.week_id);
              const blk = wk ? blockMap.get(wk.block_id) : null;
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 cursor-pointer hover:bg-accent/40"
                  onClick={() => onSelectDay?.(d.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground">{format(date, "EEE, MMM d")}</div>
                    <div className="font-medium truncate">{d.title?.trim() || `Day ${d.day_index}`}</div>
                    <div className="text-xs text-muted-foreground">
                      {blk?.name ?? "Block"} · Week {wk?.week_index ?? "?"} · Day {d.day_index}
                    </div>
                  </div>
                  {statusBadge(statusOf(d, compMap.get(d.id) ?? null))}
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <DragOverlay>
        {draggedDay ? (
          <div className="rounded-md border border-primary bg-card p-2 shadow-lg text-xs font-medium">
            {draggedDay.title?.trim() || `Day ${draggedDay.day_index}`}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
