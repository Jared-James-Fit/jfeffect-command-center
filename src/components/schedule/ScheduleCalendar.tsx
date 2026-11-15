/**
 * The coach's schedule calendar (the client's Training tab), in two views of
 * the same chips (buildScheduleChips: one per scheduled instance, legacy
 * days as a fallback):
 *
 *   week   the default: Mon–Sun, one row per day, each workout a full-width
 *          row (its status mark, its name, the status word when it's news),
 *          rest days one quiet line, "This week" with where it sits in the
 *          program and "2 of 4 done · 1 missed";
 *   month  the grid: on a phone a cell is its date and a mark per workout
 *          (names don't fit in a seventh of a phone), on a wider screen a
 *          line per workout; a tap on a day lists its workouts under the
 *          grid, with the month's tally that doubles as the key.
 *
 * Every status, word and mark comes from coach-schedule.ts (the athlete's
 * own rules). Drag a workout (press and hold on a touch screen) onto another
 * day in either view; a tap opens it (the move sheet). Nothing here writes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, useDraggable, useDroppable, MouseSensor, TouchSensor,
  useSensor, useSensors, DragOverlay, type DragEndEvent,
} from "@dnd-kit/core";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, addWeeks,
  format, isSameDay, isSameMonth,
} from "date-fns";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildScheduleChips } from "@/lib/schedule-calendar-chips";
import { useIsMobileNow } from "@/hooks/use-mobile";
import { WorkoutStatusMark } from "@/components/workouts/workout-status-mark";
import {
  coachMark, coachStatus, isoDate, STATUS_TONE, STATUS_WORD, tally, tallyLine, weekPlace, weekRange, weekTitle,
  workoutName, type CoachStatus,
} from "@/lib/coach-schedule";

export type ScheduleDay = {
  id: string; day_index: number; title: string | null; subtitle?: string | null; focus: string | null;
  scheduled_date: string | null; schedule_source: string | null;
  schedule_locked: boolean | null; week_id: string; is_optional?: boolean | null;
};
export type ScheduleWeek = { id: string; week_index: number; block_id: string };
export type ScheduleBlock = { id: string; name: string | null; start_date: string | null; end_date: string | null; status?: string | null };
export type ScheduleCompletion = {
  day_id: string;
  completed_at: string | null;
  in_progress_at: string | null;
  started_at?: string | null;
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

export type CalendarView = "week" | "month";

type Chip = {
  chipId: string;
  instanceId: string | null;
  day: ScheduleDay;
  scheduled_date: string;
  comp: ScheduleCompletion | null;
  status: CoachStatus;
  name: string;
  blockId: string | null;
  weekIndex: number | null;
};

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** The status word beside a workout, never "Today" where the date already says it. */
function wordFor(status: CoachStatus, dateShown: boolean): string {
  if (status === "today" && dateShown) return "";
  return STATUS_WORD[status];
}

/**
 * One workout. `row`: full width, name and status (week view, the month's day
 * list); `cell`: one line in a wide month cell; `dot`: just the mark, in a
 * phone's month cell. Draggable unless it's done, and each is also a drop
 * target so a drag can land "onto this workout" (same-day reorder).
 */
function DayChip({ chip, variant, draggable, canReorderUp, canReorderDown, onNudge, onOpen }: {
  chip: Chip;
  variant: "row" | "cell" | "dot";
  draggable: boolean;
  canReorderUp?: boolean;
  canReorderDown?: boolean;
  onNudge?: (direction: -1 | 1) => void;
  onOpen?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: chip.chipId, disabled: !draggable });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `chip:${chip.chipId}`, disabled: !draggable });
  const status = chip.status;
  const done = status === "done";
  const mark = <WorkoutStatusMark mark={coachMark(status)} />;
  const ref = (el: HTMLElement | null) => { setNodeRef(el); setDropRef(el); };
  const dragProps = draggable ? { ...listeners, ...attributes } : {};
  const label = `${chip.name}${STATUS_WORD[status] ? `, ${STATUS_WORD[status]}` : ""}`;

  if (variant === "dot") {
    return (
      <span
        ref={ref}
        {...dragProps}
        aria-label={label}
        title={label}
        data-schedule-chip={chip.chipId}
        className={cn("inline-grid h-4 w-4 select-none place-items-center rounded-full [-webkit-touch-callout:none]", isDragging && "opacity-40", isOver && "ring-2 ring-ring")}
      >
        {mark}
      </span>
    );
  }

  if (variant === "cell") {
    return (
      <button
        type="button"
        ref={ref}
        {...dragProps}
        onClick={onOpen}
        title={label}
        data-schedule-chip={chip.chipId}
        className={cn(
          "flex w-full min-w-0 items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1 text-left text-[11px] leading-tight transition hover:bg-muted",
          draggable && "cursor-grab select-none active:cursor-grabbing",
          done && "text-muted-foreground",
          isDragging && "opacity-40",
          isOver && "ring-2 ring-ring",
        )}
      >
        {mark}
        <span className="min-w-0 flex-1 truncate font-medium">{chip.name}</span>
      </button>
    );
  }

  const word = wordFor(status, true);
  return (
    <div
      ref={ref}
      {...dragProps}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(); } }}
      data-schedule-chip={chip.chipId}
      className={cn(
        "group flex min-h-[44px] w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        draggable && "cursor-grab select-none [-webkit-touch-callout:none] active:cursor-grabbing",
        isDragging && "opacity-40",
        isOver && "ring-2 ring-ring",
      )}
    >
      {mark}
      <span className={cn("min-w-0 flex-1 truncate text-[14px] font-medium", done && "text-muted-foreground")}>
        {chip.name}
        {chip.day.is_optional && <span className="font-normal text-muted-foreground"> · Optional</span>}
      </span>
      {word && <span className={cn("shrink-0 text-xs font-medium", STATUS_TONE[status])}>{word}</span>}
      {onNudge && !done && (canReorderUp || canReorderDown) && (
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="Move up"
            disabled={!canReorderUp}
            onClick={(e) => { e.stopPropagation(); onNudge(-1); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="grid h-8 w-7 place-items-center rounded hover:bg-secondary disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={!canReorderDown}
            onClick={(e) => { e.stopPropagation(); onNudge(1); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="grid h-8 w-7 place-items-center rounded hover:bg-secondary disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

/** A day (or a month cell) a workout can be dropped on. */
function DropDay({ date, className, children, onClick, selected }: {
  date: Date; className?: string; children: React.ReactNode; onClick?: () => void; selected?: boolean;
}) {
  const id = ymd(date);
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-cell-date={id}
      data-selected={selected || undefined}
      onClick={onClick}
      className={cn(className, isOver && "bg-muted ring-2 ring-inset ring-ring")}
    >
      {children}
    </div>
  );
}

function DragHint({ phone }: { phone: boolean }) {
  return (
    <p className="mt-2 px-1 text-xs text-muted-foreground">
      {phone ? "Tap a workout to open it, or press and hold to drag it to another day." : "Click a workout to open it, or drag it onto another day."}
    </p>
  );
}

export interface ScheduleCalendarProps {
  days: ScheduleDay[];
  weeks: ScheduleWeek[];
  blocks: ScheduleBlock[];
  completions: ScheduleCompletion[];
  /**
   * When provided, the calendar renders one chip per scheduled instance and
   * drag/select callbacks report the exact `instanceId`.
   * `pl_days.scheduled_date` is used only as the legacy fallback for days
   * with no matching instance.
   */
  scheduledInstances?: ScheduledInstance[];
  canEdit: boolean;
  /** Week (the default on the Training tab) or Month. */
  view: CalendarView;
  /**
   * `instanceId` is set whenever the dragged chip corresponds to a
   * scheduled instance. Legacy chips (no instance) leave it null.
   */
  onMoveDay: (
    target: { dayId: string; instanceId: string | null },
    targetDate: Date,
  ) => void;
  /** Open the workout's sheet (move, view what was logged, edit in the program). */
  onSelectDay?: (target: { dayId: string; instanceId: string | null }) => void;
  /**
   * Persist same-day ordering: a drag within a day or Move up / Move down on
   * a workout. `orderedInstanceIds` is the FULL ordered list of scheduled
   * instance ids for that date; legacy chips (no instance) can't be ordered.
   */
  onReorder?: (date: string, orderedInstanceIds: string[]) => void;
  /** today, for tests (yyyy-mm-dd) */
  todayISO?: string;
}

export function ScheduleCalendar(props: ScheduleCalendarProps) {
  const { days, weeks, blocks, completions, scheduledInstances, canEdit, view, onMoveDay, onSelectDay, onReorder } = props;
  const todayIso = props.todayISO ?? ymd(new Date());
  const today = isoDate(todayIso);
  const phone = useIsMobileNow();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(today, { weekStartsOn: 1 }));
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(today));
  const [selected, setSelected] = useState<string>(todayIso);
  const [dragId, setDragId] = useState<string | null>(null);
  const suppressNextSelectRef = useRef(false);
  const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });

  // A mouse drags at once; a finger (or a pencil) presses and holds first, so
  // a swipe that starts on a workout still scrolls the page (dnd-kit's
  // MouseSensor + TouchSensor: a PointerSensor would claim the touch too).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const weekMap = useMemo(() => new Map(weeks.map((w) => [w.id, w])), [weeks]);
  const blockMap = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const dayById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days]);
  const daysWithInstance = useMemo(
    () => new Set((scheduledInstances ?? []).map((i) => i.source_day_id)),
    [scheduledInstances],
  );

  // Shared pure builder (src/test/schedule-calendar-chips.test.ts: one chip
  // per instance, drag ids = instance ids).
  const chips: Chip[] = useMemo(() => {
    const raw = buildScheduleChips({ days, instances: scheduledInstances ?? [], completions });
    const out: Chip[] = [];
    for (const r of raw) {
      const d = dayById.get(r.dayId);
      if (!d) continue;
      const comp = (r.completion as ScheduleCompletion | null) ?? null;
      const wk = weekMap.get(d.week_id);
      out.push({
        chipId: r.chipId,
        instanceId: r.instanceId,
        day: { ...d, scheduled_date: r.scheduledDate },
        scheduled_date: r.scheduledDate,
        comp,
        status: coachStatus({ date: r.scheduledDate, completion: comp, optional: d.is_optional, todayISO: todayIso }),
        name: workoutName(d),
        blockId: wk?.block_id ?? null,
        weekIndex: wk?.week_index ?? null,
      });
    }
    return out;
  }, [days, dayById, weekMap, scheduledInstances, completions, todayIso]);

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

  // Workouts still waiting for a date: never one already done, or one in a
  // block that's over (it would only put an old workout back on the calendar).
  const unscheduled = useMemo(() => {
    const done = new Set(completions.filter((c) => c.completed_at).map((c) => c.day_id));
    return days
      .filter((d) => {
        if (d.scheduled_date || daysWithInstance.has(d.id) || done.has(d.id)) return false;
        const blk = blockMap.get(weekMap.get(d.week_id)?.block_id ?? "");
        if (!blk) return true;
        return blk.status !== "Completed" && !(blk.end_date && blk.end_date < todayIso);
      })
      .sort((a, b) => a.day_index - b.day_index);
  }, [days, daysWithInstance, completions, blockMap, weekMap, todayIso]);

  // a month moved to on its own selects a day in it, so the list under it is never another month's
  useEffect(() => {
    if (isSameMonth(isoDate(selected), cursor)) return;
    setSelected(isSameMonth(today, cursor) ? todayIso : ymd(cursor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  const handleDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    // A successful drag must not also open the workout on the click that ends it.
    suppressNextSelectRef.current = true;
    setTimeout(() => { suppressNextSelectRef.current = false; }, 0);
    if (!e.over || !e.active) return;
    const chip = chipById.get(String(e.active.id));
    if (!chip) return;
    const overId = String(e.over.id);
    // Two drop targets: `<yyyy-MM-dd>` (a day) and `chip:<chipId>` (a workout on a day).
    let targetDateStr: string;
    let anchorChipId: string | null = null;
    if (overId.startsWith("chip:")) {
      const target = chipById.get(overId.slice(5));
      if (!target) return;
      targetDateStr = target.scheduled_date;
      anchorChipId = target.chipId;
    } else {
      targetDateStr = overId;
    }
    const sameDate = targetDateStr === chip.scheduled_date;
    // Let go over itself, or on its own day: nothing to do.
    if (anchorChipId === chip.chipId) return;
    if (sameDate && anchorChipId && chip.instanceId && onReorder) {
      // Same-date reorder: `chip` goes before the one it was dropped onto.
      const dayChips = (byDate.get(targetDateStr) ?? []).filter((c) => c.instanceId);
      const without = dayChips.filter((c) => c.chipId !== chip.chipId);
      const anchorIdx = without.findIndex((c) => c.chipId === anchorChipId);
      const insertAt = anchorIdx < 0 ? without.length : anchorIdx;
      const reordered = [...without.slice(0, insertAt), chip, ...without.slice(insertAt)];
      const ids = reordered.map((c) => c.instanceId!).filter(Boolean);
      if (ids.join() !== dayChips.map((c) => c.instanceId).join()) onReorder(targetDateStr, ids);
      return;
    }
    if (sameDate) return; // a legacy chip dropped on its own day does nothing
    onMoveDay({ dayId: chip.day.id, instanceId: chip.instanceId }, isoDate(targetDateStr));
  };

  const handleReorderNudge = (chipId: string, direction: -1 | 1) => {
    const chip = chipById.get(chipId);
    if (!chip || !chip.instanceId || !onReorder) return;
    const dayChips = (byDate.get(chip.scheduled_date) ?? []).filter((c) => c.instanceId);
    const idx = dayChips.findIndex((c) => c.chipId === chip.chipId);
    const next = idx + direction;
    if (idx < 0 || next < 0 || next >= dayChips.length) return;
    const swapped = dayChips.slice();
    [swapped[idx], swapped[next]] = [swapped[next], swapped[idx]];
    onReorder(chip.scheduled_date, swapped.map((c) => c.instanceId!));
  };

  const open = (chip: Chip) => {
    if (suppressNextSelectRef.current) return;
    onSelectDay?.({ dayId: chip.day.id, instanceId: chip.instanceId });
  };

  /** A day's workouts as full rows (the week view, the month's chosen day). */
  const rows = (list: Chip[]) => {
    const inst = list.filter((c) => c.instanceId);
    return list.map((chip) => {
      const i = chip.instanceId ? inst.findIndex((c) => c.chipId === chip.chipId) : -1;
      const canReorder = canEdit && !!chip.instanceId && !!onReorder && inst.length > 1;
      return (
        <DayChip
          key={chip.chipId}
          chip={chip}
          variant="row"
          draggable={canEdit && !chip.comp?.completed_at}
          canReorderUp={canReorder && i > 0}
          canReorderDown={canReorder && i >= 0 && i < inst.length - 1}
          onNudge={canReorder ? (dir) => handleReorderNudge(chip.chipId, dir) : undefined}
          onOpen={() => open(chip)}
        />
      );
    });
  };

  const draggedChip = dragId ? chipById.get(dragId) ?? null : null;
  const blockName = (id: string) => blockMap.get(id)?.name ?? null;

  // ── week ──────────────────────────────────────────────────────────────
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekChips = weekDays.flatMap((d) => byDate.get(ymd(d)) ?? []);
  const weekTally = tally(weekChips.map((c) => ({ date: c.scheduled_date, status: c.status })));
  const weekLine = tallyLine(weekChips.map((c) => ({ date: c.scheduled_date, status: c.status })));
  const place = weekPlace(weekChips.map((c) => ({ blockId: c.blockId, weekIndex: c.weekIndex, date: c.scheduled_date })), blockName);
  const onThisWeek = isSameDay(weekStart, thisWeekStart);

  // ── month ─────────────────────────────────────────────────────────────
  const monthStart = startOfMonth(cursor);
  const cells: Date[] = [];
  for (let d = startOfWeek(monthStart, { weekStartsOn: 1 }); d <= endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }); d = addDays(d, 1)) cells.push(d);
  const monthChips = chips.filter((c) => isSameMonth(isoDate(c.scheduled_date), cursor));
  const monthTally = tally(monthChips.map((c) => ({ date: c.scheduled_date, status: c.status })));
  const selectedList = byDate.get(selected) ?? [];

  const navButton = "grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground";

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => {
        suppressNextSelectRef.current = true;
        setDragId(String(e.active.id));
      }}
      onDragCancel={() => {
        setDragId(null);
        setTimeout(() => { suppressNextSelectRef.current = false; }, 0);
      }}
      onDragEnd={handleDragEnd}
    >
      {view === "week" ? (
        <div data-schedule-week>
          <div className="flex items-center justify-between gap-1">
            <button type="button" className={navButton} aria-label="Previous week" onClick={() => setWeekStart(addWeeks(weekStart, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 text-center">
              <div className="text-[15px] font-semibold">{weekTitle(weekStart, thisWeekStart)}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {weekRange(weekStart)}
                {!onThisWeek && (
                  <button type="button" onClick={() => setWeekStart(thisWeekStart)} className="ml-2 font-semibold text-foreground underline-offset-2 hover:underline">
                    This week
                  </button>
                )}
              </div>
            </div>
            <button type="button" className={navButton} aria-label="Next week" onClick={() => setWeekStart(addWeeks(weekStart, 1))}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {(place || weekLine) && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-1 text-[13px]" data-schedule-week-summary>
              <span className="min-w-0 truncate text-muted-foreground">{place}</span>
              {weekLine && (
                <span className="shrink-0 font-medium tabular-nums">
                  {weekTally.done} of {weekTally.total} done
                  {weekTally.missed > 0 && <span className={STATUS_TONE.missed}> · {weekTally.missed} missed</span>}
                  {weekTally.inProgress > 0 && <span className="text-muted-foreground"> · {weekTally.inProgress} in progress</span>}
                </span>
              )}
            </div>
          )}
          <div className="mt-2 divide-y divide-border/60">
            {weekDays.map((d) => {
              const iso = ymd(d);
              const list = byDate.get(iso) ?? [];
              const isToday = iso === todayIso;
              return (
                <DropDay key={iso} date={d} className="flex items-start gap-3 py-2">
                  <div className="w-10 shrink-0 pt-0.5 text-center" aria-label={format(d, "EEEE, MMMM d")}>
                    <div className={cn("text-[11px] font-medium", isToday ? "text-foreground" : "text-muted-foreground")}>{format(d, "EEE")}</div>
                    <div className={cn("mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-[14px] font-semibold tabular-nums", isToday && "bg-foreground text-background")}>
                      {format(d, "d")}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5 self-center">
                    {list.length ? rows(list) : <div className="py-1.5 text-[13px] text-muted-foreground">Rest</div>}
                  </div>
                </DropDay>
              );
            })}
          </div>
          {canEdit && <DragHint phone={phone} />}
        </div>
      ) : (
        <div data-schedule-month>
          {unscheduled.length > 0 && (
            <div className="mb-3 rounded-lg border border-dashed border-border p-2" data-schedule-unscheduled>
              <div className="flex items-center gap-2 px-1 pb-1.5 text-[13px] font-medium">
                <CalendarPlus className="h-4 w-4 text-warning" />
                {unscheduled.length} workout{unscheduled.length === 1 ? " has" : "s have"} no date
              </div>
              <div className="space-y-1.5">
                {unscheduled.map((d) => {
                  const wk = weekMap.get(d.week_id);
                  const blk = wk ? blockMap.get(wk.block_id) : null;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => onSelectDay?.({ dayId: d.id, instanceId: null })}
                      className="flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{workoutName(d)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{blk?.name ?? "Block"} · Week {wk?.week_index ?? "?"}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold">Pick a date</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-2 flex items-center justify-between gap-1">
            <button type="button" className={navButton} aria-label="Previous month" onClick={() => setCursor(addMonths(cursor, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-center">
              <div className="text-[15px] font-semibold">{format(cursor, "MMMM yyyy")}</div>
              {!isSameMonth(cursor, today) && (
                <button type="button" onClick={() => setCursor(startOfMonth(today))} className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  This month
                </button>
              )}
            </div>
            <button type="button" className={navButton} aria-label="Next month" onClick={() => setCursor(addMonths(cursor, 1))}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 pb-1 text-center text-[11px] font-medium text-muted-foreground">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{phone ? d.slice(0, 1) : d}</div>)}
          </div>
          <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-border/70">
            {cells.map((date, i) => {
              const iso = ymd(date);
              const list = byDate.get(iso) ?? [];
              const inMonth = isSameMonth(date, cursor);
              const isToday = iso === todayIso;
              const isSelected = iso === selected;
              return (
                <DropDay
                  key={iso}
                  date={date}
                  selected={isSelected}
                  onClick={() => { if (!suppressNextSelectRef.current) setSelected(iso); }}
                  className={cn(
                    "min-w-0 cursor-pointer space-y-1 border-border/50 p-1 transition-colors",
                    i % 7 !== 0 && "border-l",
                    i >= 7 && "border-t",
                    phone ? "min-h-[52px]" : "min-h-[96px]",
                    !inMonth && "bg-muted/40 text-muted-foreground",
                    isSelected && "bg-muted",
                  )}
                >
                  <div className={cn("grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold tabular-nums", isToday && "bg-foreground text-background", phone && "mx-auto")}>
                    {format(date, "d")}
                  </div>
                  {phone ? (
                    <div className="flex flex-wrap justify-center gap-0.5">
                      {list.map((chip) => (
                        <DayChip key={chip.chipId} chip={chip} variant="dot" draggable={canEdit && !chip.comp?.completed_at} />
                      ))}
                    </div>
                  ) : (
                    list.map((chip) => (
                      <DayChip
                        key={chip.chipId}
                        chip={chip}
                        variant="cell"
                        draggable={canEdit && !chip.comp?.completed_at}
                        onOpen={() => open(chip)}
                      />
                    ))
                  )}
                </DropDay>
              );
            })}
          </div>

          {monthTally.total > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] text-muted-foreground" data-schedule-month-tally>
              <span className="inline-flex items-center gap-1"><WorkoutStatusMark mark={coachMark("done")} /> {monthTally.done} done</span>
              {monthTally.missed > 0 && <span className="inline-flex items-center gap-1"><WorkoutStatusMark mark={coachMark("missed")} /> {monthTally.missed} missed</span>}
              {monthTally.inProgress > 0 && <span className="inline-flex items-center gap-1"><WorkoutStatusMark mark={coachMark("in_progress")} /> {monthTally.inProgress} in progress</span>}
              {monthTally.optional > 0 && <span className="inline-flex items-center gap-1"><WorkoutStatusMark mark={coachMark("optional")} /> {monthTally.optional} optional skipped</span>}
              {monthTally.ahead > 0 && <span className="inline-flex items-center gap-1"><WorkoutStatusMark mark={coachMark("upcoming")} /> {monthTally.ahead} ahead</span>}
            </div>
          )}

          <div className="mt-3" data-schedule-selected-day>
            <div className="px-1 pb-1.5 text-[13px] font-semibold">
              {format(isoDate(selected), "EEEE, MMM d")}
              {selected === todayIso && <span className="font-normal text-muted-foreground"> · Today</span>}
            </div>
            <div className="space-y-1.5">
              {selectedList.length ? rows(selectedList) : <div className="px-1 text-[13px] text-muted-foreground">Rest</div>}
            </div>
            {canEdit && <DragHint phone={phone} />}
          </div>
        </div>
      )}

      <DragOverlay dropAnimation={null}>
        {draggedChip ? (
          <div className="pointer-events-none rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium shadow-lg">
            {draggedChip.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
