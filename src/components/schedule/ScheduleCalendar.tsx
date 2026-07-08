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
import { ChevronLeft, ChevronRight, CheckCircle2, Clock, AlertCircle, GripVertical, Calendar as CalIcon, CalendarPlus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { buildScheduleChips } from "@/lib/schedule-calendar-chips";

export type ScheduleDay = {
  id: string; day_index: number; title: string | null; focus: string | null;
  scheduled_date: string | null; schedule_source: string | null;
  schedule_locked: boolean | null; week_id: string;
};
export type ScheduleWeek = { id: string; week_index: number; block_id: string };
export type ScheduleBlock = { id: string; name: string | null; start_date: string | null; end_date: string | null };
export type ScheduleCompletion = {
  day_id: string;
  completed_at: string | null;
  in_progress_at: string | null;
  scheduled_workout_id?: string | null;
};
export type ScheduledInstance = {
  id: string;
  source_day_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  order_index: number;
  schedule_source?: string | null;
};

type Status = "completed" | "in-progress" | "overdue" | "rescheduled" | "scheduled" | "unscheduled";
function statusOf(day: ScheduleDay, comp: ScheduleCompletion | null): Status {
  if (comp?.completed_at) return "completed";
  if (comp?.in_progress_at) return "in-progress";
  if (!day.scheduled_date) return "unscheduled";
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
    case "unscheduled": return <Badge variant="outline" className="gap-1"><CalendarPlus className="h-3 w-3" /> Unscheduled</Badge>;
    default: return <Badge variant="outline">Scheduled</Badge>;
  }
}

function DayChip({ chipId, day, comp, week, blockName, draggable }: {
  chipId: string;
  day: ScheduleDay; comp: ScheduleCompletion | null;
  week?: ScheduleWeek; blockName?: string | null; draggable: boolean;
}) {
  const id = chipId;
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
  /**
   * Slice 2c — when provided, the calendar renders one chip per
   * scheduled instance and drag/select callbacks report the exact
   * `instanceId`. `pl_days.scheduled_date` is used only as the legacy
   * fallback for days with no matching instance.
   */
  scheduledInstances?: ScheduledInstance[];
  canEdit: boolean;
  /**
   * `instanceId` is set whenever the dragged chip corresponds to a
   * scheduled instance. Legacy chips (no instance) leave it null.
   */
  onMoveDay: (
    target: { dayId: string; instanceId: string | null },
    targetDate: Date,
  ) => void;
  /** Open the move sheet pre-filled with the workout but no target date. */
  onSelectDay?: (target: { dayId: string; instanceId: string | null }) => void;
}

export function ScheduleCalendar(props: ScheduleCalendarProps) {
  const { days, weeks, blocks, completions, scheduledInstances, canEdit, onMoveDay, onSelectDay } = props;
  const [view, setView] = useState<"month" | "list">("month");
  const [cursor, setCursor] = useState<Date>(startOfMonth(new Date()));
  const [dragId, setDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const weekMap = useMemo(() => new Map(weeks.map((w) => [w.id, w])), [weeks]);
  const blockMap = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const dayById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days]);
  const daysWithInstance = useMemo(
    () => new Set((scheduledInstances ?? []).map((i) => i.source_day_id)),
    [scheduledInstances],
  );

  // Shared pure builder — tested in src/test/schedule-calendar-chips.test.ts
  // for the "one chip per instance / drag ids = instance ids" invariants.
  type Chip = {
    chipId: string;
    instanceId: string | null;
    day: ScheduleDay;
    scheduled_date: string;
    comp: ScheduleCompletion | null;
  };
  const chips: Chip[] = useMemo(() => {
    const raw = buildScheduleChips({
      days,
      instances: scheduledInstances ?? [],
      completions,
    });
    const out: Chip[] = [];
    for (const r of raw) {
      const d = dayById.get(r.dayId);
      if (!d) continue;
      out.push({
        chipId: r.chipId,
        instanceId: r.instanceId,
        day: { ...d, scheduled_date: r.scheduledDate },
        scheduled_date: r.scheduledDate,
        comp: (r.completion as ScheduleCompletion | null) ?? null,
      });
    }
    return out;
  }, [days, dayById, scheduledInstances, completions]);

  const chipById = useMemo(() => new Map(chips.map((c) => [c.chipId, c])), [chips]);

  const byDate = useMemo(() => {
    const m = new Map<string, Chip[]>();
    for (const c of chips) {
      const list = m.get(c.scheduled_date) ?? [];
      list.push(c);
      m.set(c.scheduled_date, list);
    }
    return m;
  }, [chips]);

  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });

  const cells: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) cells.push(d);

  const upcoming = useMemo(() => {
    const today = startOfToday();
    return chips
      .map((c) => ({ c, date: parseISO(c.scheduled_date) }))
      .filter((x) => x.date >= today)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 30);
  }, [chips]);

  const unscheduled = useMemo(
    () =>
      days
        .filter((d) => !d.scheduled_date && !daysWithInstance.has(d.id))
        .sort((a, b) => a.day_index - b.day_index),
    [days, daysWithInstance],
  );

  const handleDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    if (!e.over || !e.active) return;
    const chipId = String(e.active.id);
    const chip = chipById.get(chipId);
    if (!chip) return;
    const targetDate = parseISO(String(e.over.id));
    onMoveDay({ dayId: chip.day.id, instanceId: chip.instanceId }, targetDate);
  };

  const draggedChip = dragId ? chipById.get(dragId) ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setDragId(String(e.active.id))}
      onDragCancel={() => setDragId(null)}
      onDragEnd={handleDragEnd}
    >
      {unscheduled.length > 0 && (
        <div className="mb-3 space-y-2 rounded-md border border-dashed border-border bg-secondary/20 p-2">
          <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase text-muted-foreground">
            <CalendarPlus className="h-3.5 w-3.5" /> Unscheduled workouts
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unscheduled.map((d) => {
              const wk = weekMap.get(d.week_id);
              const blk = wk ? blockMap.get(wk.block_id) : null;
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => onSelectDay?.({ dayId: d.id, instanceId: null })}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-left text-sm transition hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{d.title?.trim() || `Day ${d.day_index}`}</span>
                    <span className="block text-xs text-muted-foreground">
                      {blk?.name ?? "Block"} · Week {wk?.week_index ?? "?"} · Day {d.day_index}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-semibold">Pick date</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
                  {list.map((chip) => {
                    const day = chip.day;
                    const wk = weekMap.get(day.week_id);
                    const blk = wk ? blockMap.get(wk.block_id) : null;
                    return (
                      <div key={chip.chipId} onClick={() => onSelectDay?.({ dayId: day.id, instanceId: chip.instanceId })}>
                        <DayChip
                          chipId={chip.chipId}
                          day={day}
                          week={wk}
                          blockName={blk?.name ?? null}
                          comp={chip.comp}
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
            {upcoming.map(({ c: chip, date }) => {
              const d = chip.day;
              const wk = weekMap.get(d.week_id);
              const blk = wk ? blockMap.get(wk.block_id) : null;
              return (
                <div
                  key={chip.chipId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 cursor-pointer hover:bg-accent/40"
                  onClick={() => onSelectDay?.({ dayId: d.id, instanceId: chip.instanceId })}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground">{format(date, "EEE, MMM d")}</div>
                    <div className="font-medium truncate">{d.title?.trim() || `Day ${d.day_index}`}</div>
                    <div className="text-xs text-muted-foreground">
                      {blk?.name ?? "Block"} · Week {wk?.week_index ?? "?"} · Day {d.day_index}
                    </div>
                  </div>
                  {statusBadge(statusOf(d, chip.comp))}
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <DragOverlay>
        {draggedChip ? (
          <div className="rounded-md border border-primary bg-card p-2 shadow-lg text-xs font-medium">
            {draggedChip.day.title?.trim() || `Day ${draggedChip.day.day_index}`}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
